/* アプリ本体：ハッシュルーティングと各画面の操作フロー */
(function (E) {
  'use strict';

  const { h, toast } = E.dom;
  const V = E.views;
  const app = document.getElementById('app');

  let draft = null; // 編集中の絵本（未保存）
  let status = { text: '', kind: '' };
  let cleanup = null;
  let routeSeq = 0;
  let pdfState = { page: 0, result: null, busy: false };

  // ---------------------------------------------------------------- 小物
  const CUT_KEY = 'ehon.cutLines';
  const HINT_KEY = 'ehon.hintDismissed';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const getCut = () => lsGet(CUT_KEY) !== '0';

  function installHint() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return ios && !navigator.standalone && lsGet(HINT_KEY) !== '1';
  }

  function mount(el) {
    app.replaceChildren(el);
    window.scrollTo(0, 0);
  }

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function setStatus(text, kind) {
    status = { text, kind: kind || '' };
    if (location.hash === '#/detail' && draft) showDetail();
  }

  function newDraft(isbn) {
    draft = { id: null, isbn: isbn || '', title: '', author: '', publisher: '', original: null, image: null, createdAt: Date.now() };
    status = { text: '', kind: '' };
  }

  // ---------------------------------------------------------------- ルーティング
  async function route() {
    const seq = ++routeSeq;
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    const path = (location.hash || '#/').slice(1) || '/';
    if (path === '/add') return showAdd();
    if (path === '/detail') return draft ? showDetail() : go('#/');
    if (path === '/crop') return showCrop(seq);
    if (path === '/pdf') return showPdf(seq);
    return showHome(seq);
  }

  // ---------------------------------------------------------------- ホーム
  async function showHome(seq) {
    let books = [];
    try { books = await E.store.list(); } catch (e) { toast('保存領域を開けませんでした'); }
    if (seq !== routeSeq) return;
    mount(V.home({
      books,
      installHint: installHint(),
      onDismissHint: () => { lsSet(HINT_KEY, '1'); showHome(routeSeq); },
      onAdd: () => go('#/add'),
      onPdf: () => { pdfState = { page: 0, result: null, busy: false }; go('#/pdf'); },
      onOpen: (b) => { draft = Object.assign({}, b); status = { text: '', kind: '' }; go('#/detail'); },
      onDelete: async (b) => {
        if (!confirm('「' + (b.title || '無題') + '」を削除しますか？')) return;
        await E.store.remove(b.id);
        showHome(routeSeq);
      },
    }));
  }

  // ---------------------------------------------------------------- 絵本登録
  function cameraMessage(err) {
    if (err && err.name === 'NotAllowedError') return 'カメラの使用が許可されていません。Safariの設定で許可するか、「写真から選択」を使ってください。';
    if (err && err.name === 'NotFoundError') return 'カメラが見つかりません。「写真から選択」を使ってください。';
    if (!window.isSecureContext || (err && err.name === 'NoMediaError')) return 'この環境ではカメラを使えません（HTTPS または localhost で開いてください）。「写真から選択」は使えます。';
    return 'カメラを起動できませんでした。「写真から選択」を使ってください。';
  }

  function showAdd() {
    const scanArea = h('div', { class: 'scan-area', 'data-testid': 'scan-area' });
    const el = V.add({
      scanArea,
      onBack: () => go('#/'),
      onPhoto: handleBarcodePhoto,
      onManual: (v) => {
        const isbn = E.isbn.normalize(v);
        if (!isbn) return toast('正しいISBN（10桁または13桁）を入力してください');
        onIsbn(isbn);
      },
      onSkip: () => { newDraft(''); go('#/detail'); },
    });
    mount(el);
    const hint = el.querySelector('.hint');

    let alive = true;
    let scanner = null;
    cleanup = () => { alive = false; if (scanner) scanner.stop(); };

    async function startScan() {
      scanArea.replaceChildren(V.scanPlaceholder('カメラを起動しています…'));
      try {
        const s = await E.barcode.startCamera(scanArea, {
          onResult: (code) => {
            scanner = null;
            if (navigator.vibrate) navigator.vibrate(60);
            if (alive) onIsbn(code);
          },
        });
        if (!alive) s.stop(); else scanner = s;
      } catch (e) {
        if (alive) scanArea.replaceChildren(V.scanPlaceholder(cameraMessage(e), startScan));
      }
    }
    startScan();

    async function handleBarcodePhoto(file) {
      hint.textContent = '写真を読み取っています…';
      try {
        const img = await E.imaging.fileToImage(file);
        const code = await E.barcode.scanImage(img);
        if (code) { if (scanner) { scanner.stop(); scanner = null; } return onIsbn(code); }
        hint.textContent = 'バーコードを枠内に合わせてください';
        if (confirm('バーコードを読み取れませんでした。\nこの写真を表紙画像として登録しますか？\n（キャンセルで別の写真を選べます）')) {
          newDraft('');
          draft.original = E.imaging.imageToDataUrl(img, 1200);
          draft.image = E.imaging.renderContain(img);
          status = { text: '写真を表紙として設定しました。タイトルなどを入力してください。', kind: 'ok' };
          go('#/detail');
        }
      } catch (e) {
        hint.textContent = 'バーコードを枠内に合わせてください';
        toast('写真を読み込めませんでした');
      }
    }
  }

  async function onIsbn(isbn) {
    let exist = null;
    try { exist = (await E.store.list()).find((b) => b.isbn === isbn); } catch (e) { /* ignore */ }
    if (exist && confirm('この絵本は登録済みです（' + (exist.title || isbn) + '）。\n編集しますか？')) {
      draft = Object.assign({}, exist);
      status = { text: '', kind: '' };
      return go('#/detail');
    }
    newDraft(isbn);
    go('#/detail');
    lookup(isbn);
  }

  /** 書誌情報と表紙の取得。取得中に別の絵本へ移っていたら結果は捨てる。 */
  async function lookup(isbn) {
    const mine = draft;
    setStatus('書誌情報と表紙を取得しています…', 'info');
    const info = await E.cover.lookupInfo(isbn);
    if (draft !== mine) return;
    for (const k of ['title', 'author', 'publisher']) if (!mine[k] && info[k]) mine[k] = info[k];
    setStatus('表紙画像を探しています…', 'info');
    const found = await E.cover.fetchCover(isbn, info);
    if (draft !== mine) return;
    if (found) {
      mine.original = E.imaging.imageToDataUrl(found.img, 1200);
      mine.image = E.imaging.renderContain(found.img);
      setStatus('表紙を取得しました。必要ならトリミングしてください。', 'ok');
    } else if (!info.networkOk) {
      setStatus('ネットワークに接続できませんでした。通信状況を確認するか、「写真から選択」で表紙を登録してください。', 'warn');
    } else {
      setStatus('表紙画像が見つかりませんでした。「写真から選択」で表紙を登録してください。', 'warn');
    }
  }

  // ---------------------------------------------------------------- 絵本詳細
  function showDetail() {
    mount(V.detail({
      draft,
      status,
      onBack: () => go('#/'),
      onKeep: async () => {
        if (!draft.original) return toast('表紙画像がありません');
        const img = await E.imaging.loadImage(draft.original);
        draft.image = E.imaging.renderContain(img);
        setStatus('表紙全体をそのまま正方形に収めました', 'ok');
        showDetail();
      },
      onCrop: () => (draft.original ? go('#/crop') : toast('先に表紙画像を取得するか、写真を選択してください')),
      onRefetch: () => {
        const isbn = E.isbn.normalize(draft.isbn);
        if (!isbn) return toast('正しいISBN（10桁または13桁）を入力してください');
        draft.isbn = isbn;
        lookup(isbn);
      },
      onPickPhoto: async (file) => {
        try {
          const img = await E.imaging.fileToImage(file);
          draft.original = E.imaging.imageToDataUrl(img, 1200);
          draft.image = E.imaging.renderContain(img);
          setStatus('写真を表紙に設定しました', 'ok');
          showDetail();
        } catch (e) { toast('写真を読み込めませんでした'); }
      },
      onSave: save,
    }));
  }

  async function save() {
    if (!draft.image) return toast('表紙画像がありません。「写真から選択」で登録してください');
    const norm = E.isbn.normalize(draft.isbn);
    const book = {
      id: draft.id,
      isbn: norm || E.isbn.digits(draft.isbn),
      title: (draft.title || '').trim() || '（無題）',
      author: (draft.author || '').trim(),
      publisher: (draft.publisher || '').trim(),
      original: draft.original,
      image: draft.image,
      createdAt: draft.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    try {
      const all = await E.store.list();
      const dup = book.isbn && all.find((b) => b.isbn === book.isbn && b.id !== book.id);
      if (dup) {
        if (!confirm('同じISBNの絵本が登録済みです。上書きしますか？')) return;
        book.id = dup.id;
        book.createdAt = dup.createdAt;
      }
      if (!book.id) book.id = E.store.uid();
      await E.store.put(book);
    } catch (e) {
      return toast('保存できませんでした（端末の保存領域を確認してください）');
    }
    draft = null;
    toast('保存しました');
    go('#/');
  }

  // ---------------------------------------------------------------- トリミング
  async function showCrop(seq) {
    if (!draft || !draft.original) return go('#/');
    const img = await E.imaging.loadImage(draft.original);
    if (seq !== routeSeq) return;
    const cropper = E.cropper.create(img);
    mount(V.crop({
      cropper,
      onCancel: () => go('#/detail'),
      onApply: () => {
        draft.image = cropper.getResult();
        status = { text: 'トリミングを反映しました', kind: 'ok' };
        go('#/detail');
      },
    }));
  }

  // ---------------------------------------------------------------- PDF
  async function showPdf(seq) {
    let books = [];
    try { books = await E.store.list(); } catch (e) { toast('保存領域を開けませんでした'); }
    if (seq !== routeSeq) return;
    if (books.length === 0) { toast('絵本が登録されていません'); return go('#/'); }
    const cutLines = getCut();

    const draw = () => mount(V.pdf({
      books,
      cutLines,
      page: pdfState.page,
      busy: pdfState.busy,
      result: pdfState.result,
      onBack: () => go('#/'),
      onPage: (p) => { pdfState.page = p; draw(); },
      onToggleCut: (v) => { lsSet(CUT_KEY, v ? '1' : '0'); pdfState.result = null; showPdf(routeSeq); },
      onCreate: async () => {
        pdfState.busy = true;
        draw();
        await new Promise((r) => setTimeout(r, 30)); // 「作成中」を描画させる
        try {
          const { bytes, pageCount } = E.pdf.build(books, { cutLines });
          const blob = new Blob([bytes], { type: 'application/pdf' });
          if (pdfState.result) URL.revokeObjectURL(pdfState.result.url);
          pdfState.result = { url: URL.createObjectURL(blob), blob, pages: pageCount, size: bytes.length, filename: 'ehon-labels-25mm.pdf' };
        } catch (e) {
          toast('PDFを作成できませんでした: ' + e.message);
        }
        pdfState.busy = false;
        draw();
      },
      onShare: async () => {
        const r = pdfState.result;
        if (!r) return;
        const file = new File([r.blob], r.filename, { type: 'application/pdf' });
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: '絵本ラベル' });
            return;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
        const a = h('a', { href: r.url, download: r.filename });
        document.body.append(a);
        a.click();
        a.remove();
      },
    }));
    draw();
  }

  // ---------------------------------------------------------------- 起動
  window.addEventListener('hashchange', route);
  route();

  // Service Worker（HTTPS / localhost のみ）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* オフライン機能なしで続行 */ });
    });
  }

  E.app = { go };
})((window.Ehon = window.Ehon || {}));
