/*
 * 画面（View）。状態を持たない描画関数の集まりで、
 * 実アプリ（main.js）と画面確認ページ（screens.html）の両方から使う。
 * → 確認ページの見た目と実アプリが乖離しない。
 */
(function (E) {
  'use strict';

  const { h } = E.dom;
  const noop = () => {};

  function topbar(title, onBack) {
    return h('header', { class: 'topbar' },
      onBack ? h('button', { class: 'back', type: 'button', onClick: onBack }, '‹ 戻る') : h('span', { class: 'back-spacer' }),
      h('h1', {}, title),
      h('span', { class: 'back-spacer' })
    );
  }

  function btn(label, onClick, cls = '', extra = {}) {
    return h('button', { type: 'button', class: 'btn ' + cls, onClick: onClick || noop, ...extra }, label);
  }

  /** 写真選択ボタン（非表示の file input を押す） */
  function photoButton(label, onFile, cls = '') {
    const input = h('input', {
      type: 'file', accept: 'image/*', class: 'hidden', 'data-testid': 'photo-input',
      onChange: (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f && onFile) onFile(f);
      },
    });
    return h('span', { class: 'photo-btn-wrap' }, input, btn(label, () => input.click(), cls));
  }

  // ------------------------------------------------------------ ホーム
  function home(c) {
    const books = c.books || [];
    const n = books.length;
    return h('main', { class: 'screen home', 'data-screen': 'home' },
      h('div', { class: 'hero' },
        h('div', { class: 'logo', 'aria-hidden': 'true' }, '📚'),
        h('h1', {}, '絵本ラベルメーカー'),
        h('p', { class: 'sub' }, '絵本の表紙を 25mm 角のラベルにして A4 に印刷')
      ),
      c.installHint ? h('div', { class: 'install-hint' },
        h('span', {}, 'Safariの共有ボタン →「ホーム画面に追加」で、アプリとして使えます。'),
        btn('×', c.onDismissHint, 'small ghost', { 'aria-label': '閉じる' })) : null,
      btn('＋ 絵本を追加', c.onAdd, 'primary big'),
      h('p', { class: 'count' }, '登録済み ', h('strong', { 'data-testid': 'count' }, String(n)), '冊'),
      btn('PDFを作成', c.onPdf, 'big', { disabled: n === 0 }),
      h('section', { class: 'list-section', 'data-screen': 'list' },
        h('h2', {}, '絵本一覧'),
        n === 0
          ? h('p', { class: 'empty' }, 'まだ絵本がありません。「＋ 絵本を追加」からバーコードを読み取って登録しましょう。')
          : h('ul', { class: 'book-list' },
              books.map((b) =>
                h('li', { class: 'book-card' },
                  h('button', { type: 'button', class: 'book-open', onClick: () => (c.onOpen || noop)(b) },
                    h('img', { class: 'thumb', src: b.image, alt: '' }),
                    h('span', { class: 'meta' },
                      h('span', { class: 'title' }, b.title || '（無題）'),
                      h('span', { class: 'author' }, b.author || '著者未設定'),
                      h('span', { class: 'isbn' }, b.isbn ? 'ISBN ' + b.isbn : 'ISBNなし')
                    )),
                  btn('削除', () => (c.onDelete || noop)(b), 'small danger-text', { 'aria-label': (b.title || '絵本') + 'を削除' })
                )
              ))
      )
    );
  }

  // ------------------------------------------------------------ 絵本登録（バーコード）
  function scanPlaceholder(message, onRetry) {
    return h('div', { class: 'scan-placeholder' },
      h('div', { class: 'scan-frame' }, h('div', {}, 'バーコード'), h('div', {}, 'スキャンエリア')),
      message ? h('p', { class: 'scan-msg' }, message) : null,
      onRetry ? btn('カメラを再開', onRetry, 'small') : null
    );
  }

  function add(c) {
    const scanArea = c.scanArea || h('div', { class: 'scan-area' }, scanPlaceholder());
    let manual;
    return h('main', { class: 'screen add', 'data-screen': 'add' },
      topbar('絵本を追加', c.onBack),
      scanArea,
      h('p', { class: 'hint', 'aria-live': 'polite' }, 'バーコードを枠内に合わせてください'),
      h('div', { class: 'stack' },
        photoButton('写真から選択', c.onPhoto, ''),
        h('p', { class: 'note' }, 'バーコードの写真を読み取ります。読み取れない場合は、その写真を表紙として登録できます。')
      ),
      h('details', { class: 'manual' },
        h('summary', {}, 'ISBNを手入力する / バーコードなしで登録'),
        h('div', { class: 'manual-row' },
          (manual = h('input', { type: 'text', inputmode: 'numeric', placeholder: '例: 9784000000000', 'aria-label': 'ISBN', 'data-testid': 'isbn-input' })),
          btn('検索', () => (c.onManual || noop)(manual.value), 'small primary')
        ),
        btn('バーコードなしで登録', c.onSkip, 'link')
      )
    );
  }

  // ------------------------------------------------------------ 絵本詳細
  function detail(c) {
    const d = c.draft;
    const field = (label, key, attrs = {}) =>
      h('label', { class: 'field' }, h('span', {}, label),
        h('input', { type: 'text', value: d[key] || '', 'data-field': key, ...attrs, onInput: (e) => { d[key] = e.target.value; } }));
    return h('main', { class: 'screen detail', 'data-screen': 'detail' },
      topbar('絵本の詳細', c.onBack),
      h('div', { class: 'cover-box', 'data-testid': 'cover-box' },
        d.image ? h('img', { src: d.image, alt: '表紙画像' }) : h('div', { class: 'cover-empty' }, '表紙画像なし')),
      h('p', { class: 'cover-caption' }, 'ラベルは正方形（25mm × 25mm）で印刷されます'),
      c.status && c.status.text ? h('p', { class: 'status ' + (c.status.kind || ''), 'data-testid': 'status', 'aria-live': 'polite' }, c.status.text) : null,
      h('div', { class: 'form' },
        field('タイトル', 'title', { placeholder: '例: ぐりとぐら' }),
        field('著者', 'author'),
        field('出版社', 'publisher'),
        field('ISBN', 'isbn', { inputmode: 'numeric', maxlength: '17', placeholder: '978…' })
      ),
      h('div', { class: 'btn-grid' },
        btn('そのまま使用', c.onKeep),
        btn('トリミング', c.onCrop),
        btn('表紙を再取得', c.onRefetch),
        photoButton('写真から選択', c.onPickPhoto)
      ),
      btn('保存', c.onSave, 'primary big')
    );
  }

  // ------------------------------------------------------------ トリミング
  function crop(c) {
    return h('main', { class: 'screen crop', 'data-screen': 'crop' },
      topbar('トリミング', c.onCancel),
      h('p', { class: 'hint' }, '枠が印刷される範囲です。ドラッグで移動、ピンチで拡大・縮小できます。'),
      c.cropper.el,
      h('div', { class: 'btn-grid' },
        btn('キャンセル', c.onCancel),
        btn('決定', c.onApply, 'primary')
      )
    );
  }

  // ------------------------------------------------------------ PDFプレビュー
  function fitSheet(wrap) {
    const sheet = wrap.firstChild;
    const W = wrap.clientWidth;
    if (!W) return;
    const pxW = (210 * 96) / 25.4;
    const pxH = (297 * 96) / 25.4;
    const s = W / pxW;
    sheet.style.transform = 'scale(' + s + ')';
    wrap.style.height = pxH * s + 'px';
  }

  function pdf(c) {
    const books = c.books || [];
    const L = E.pdf.layout();
    const pages = Math.max(1, Math.ceil(books.length / L.perPage));
    const page = Math.min(Math.max(0, c.page || 0), pages - 1);
    const slice = books.slice(page * L.perPage, (page + 1) * L.perPage);

    const sheet = h('div', { class: 'sheet', 'data-testid': 'sheet' },
      slice.map((b, k) =>
        h('div', {
          class: 'cell' + (c.cutLines ? ' cut' : ''),
          'data-testid': 'cell',
          style: 'left:' + (L.left + (k % L.cols) * (L.size + L.gap)) + 'mm;top:' +
            (L.top + Math.floor(k / L.cols) * (L.size + L.gap)) + 'mm;width:' + L.size + 'mm;height:' + L.size + 'mm',
        }, h('img', { src: b.image, alt: b.title || '' }))
      ),
      // 実寸の目安
      h('div', { class: 'dim dim-h', style: 'left:' + L.left + 'mm;top:' + (L.top - 6) + 'mm;width:' + L.size + 'mm' }, '25mm'),
      h('div', { class: 'dim dim-v', style: 'left:' + (L.left - 8) + 'mm;top:' + L.top + 'mm;height:' + L.size + 'mm' }, h('span', {}, '25mm'))
    );
    const wrap = h('div', { class: 'sheet-wrap' }, sheet);
    requestAnimationFrame(() => fitSheet(wrap));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitSheet(wrap)).observe(wrap);

    const r = c.result;
    return h('main', { class: 'screen pdf', 'data-screen': 'pdf' },
      topbar('PDFプレビュー', c.onBack),
      h('p', { class: 'summary' }, 'A4 縦 ・ ', h('strong', {}, String(books.length)), '冊 ・ ', h('strong', {}, String(pages)), 'ページ'),
      wrap,
      h('p', { class: 'cover-caption' }, '■ 1枚 = 25mm × 25mm（実寸）／ 1ページ最大 ' + L.perPage + ' 枚'),
      pages > 1 ? h('div', { class: 'pager' },
        btn('‹ 前', () => c.onPage(page - 1), 'small', { disabled: page === 0 }),
        h('span', {}, (page + 1) + ' / ' + pages),
        btn('次 ›', () => c.onPage(page + 1), 'small', { disabled: page >= pages - 1 })) : null,
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: c.cutLines ? true : null, 'data-testid': 'cut-toggle', onChange: (e) => (c.onToggleCut || noop)(e.target.checked) }),
        h('span', {}, '切り取り線を入れる')),
      btn(c.busy ? '作成中…' : 'PDFを作成', c.onCreate, 'primary big', { disabled: books.length === 0 || c.busy, 'data-testid': 'make-pdf' }),
      r ? h('div', { class: 'result', 'data-testid': 'pdf-result' },
        h('p', {}, '✅ PDFを作成しました（' + r.pages + 'ページ・' + Math.max(1, Math.round(r.size / 1024)) + 'KB）'),
        h('a', { class: 'btn big', href: r.url, target: '_blank', rel: 'noopener', 'data-testid': 'pdf-link' }, 'PDFを開く'),
        btn('共有・保存', c.onShare, 'big')) : null,
      h('div', { class: 'print-note' },
        h('strong', {}, '印刷するとき'),
        h('p', {}, '「100% / 実際のサイズ」を選んでください。「用紙に合わせる」「拡大/縮小」だと 25mm になりません。'))
    );
  }

  E.views = { home, add, detail, crop, pdf, scanPlaceholder, fitSheet };
})((window.Ehon = window.Ehon || {}));
