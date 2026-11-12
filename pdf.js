/*
 * A4 縦 PDF の生成（外部ライブラリなし）。
 *  - 表紙画像は JPEG のまま埋め込み、1 辺をちょうど 25mm（=70.866pt）で配置する
 *  - 用紙サイズは 595.276 × 841.890 pt（210 × 297mm）
 * HTMLプレビューも同じ layout() の値を使うので、見た目と PDF は一致する。
 */
(function (E) {
  'use strict';

  const MM = 72 / 25.4; // 1mm = 2.8346pt
  const PAGE = { w: 210, h: 297 }; // mm
  const SIZE = 25; // ラベル 1 辺 (mm)
  const GAP = 2; // ラベル間 (mm)。切り取り線が見えるぶんの余白
  const MARGIN = 10; // 最低余白 (mm)

  function layout() {
    const cols = Math.floor((PAGE.w - MARGIN * 2 + GAP) / (SIZE + GAP));
    const rows = Math.floor((PAGE.h - MARGIN * 2 + GAP) / (SIZE + GAP));
    const gridW = cols * SIZE + (cols - 1) * GAP;
    const gridH = rows * SIZE + (rows - 1) * GAP;
    return {
      size: SIZE, gap: GAP, cols, rows, perPage: cols * rows,
      left: (PAGE.w - gridW) / 2, top: (PAGE.h - gridH) / 2,
      pageW: PAGE.w, pageH: PAGE.h,
    };
  }

  function dataUrlToBytes(u) {
    const bin = atob(u.slice(u.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** JPEG の SOF マーカーから幅・高さ・コンポーネント数を読む */
  function jpegInfo(b) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    throw new Error('JPEG として解釈できませんでした');
  }

  const f3 = (n) => n.toFixed(3);
  const pad10 = (n) => String(n).padStart(10, '0');

  function utf16Hex(s) {
    let out = 'FEFF';
    for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(4, '0');
    return '<' + out + '>';
  }

  /**
   * @param {{image:string}[]} books image は正方形 JPEG(dataURL)
   * @param {{cutLines?:boolean}} opts
   * @returns {{bytes:Uint8Array, pageCount:number}}
   */
  function build(books, opts = {}) {
    const lay = layout();
    const n = books.length;
    const pageCount = Math.max(1, Math.ceil(n / lay.perPage));
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let offset = 0;
    const push = (u8) => { chunks.push(u8); offset += u8.length; };
    const str = (s) => push(enc.encode(s));
    const begin = (id) => { offsets[id] = offset; str(id + ' 0 obj\n'); };
    const end = () => str('endobj\n');

    // オブジェクト番号: 1=Catalog 2=Pages 3=Info 4..=画像 その後=ページ/コンテンツ
    const imgId = (i) => 4 + i;
    const pageId = (p) => 4 + n + p * 2;
    const contId = (p) => 5 + n + p * 2;

    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    begin(1); str('<< /Type /Catalog /Pages 2 0 R >>\n'); end();
    begin(2);
    str('<< /Type /Pages /Count ' + pageCount + ' /Kids [' +
      Array.from({ length: pageCount }, (_, p) => pageId(p) + ' 0 R').join(' ') + '] >>\n');
    end();
    begin(3);
    str('<< /Title ' + utf16Hex('絵本ラベル 25mm') + ' /Creator (Ehon Label Maker) >>\n');
    end();

    for (let i = 0; i < n; i++) {
      const bytes = dataUrlToBytes(books[i].image);
      const info = jpegInfo(bytes);
      const cs = info.comps === 1 ? 'DeviceGray' : info.comps === 4 ? 'DeviceCMYK' : 'DeviceRGB';
      begin(imgId(i));
      str('<< /Type /XObject /Subtype /Image /Width ' + info.w + ' /Height ' + info.h +
        ' /ColorSpace /' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode' +
        (info.comps === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '') +
        ' /Length ' + bytes.length + ' >>\nstream\n');
      push(bytes);
      str('\nendstream\n');
      end();
    }

    const sizePt = SIZE * MM;
    for (let p = 0; p < pageCount; p++) {
      const slice = books.slice(p * lay.perPage, (p + 1) * lay.perPage);
      const cells = slice.map((_, k) => {
        const col = k % lay.cols;
        const row = Math.floor(k / lay.cols);
        const x = (lay.left + col * (SIZE + GAP)) * MM;
        const y = (lay.pageH - (lay.top + row * (SIZE + GAP)) - SIZE) * MM;
        return { x, y, idx: p * lay.perPage + k, k };
      });
      let c = '';
      if (opts.cutLines) {
        // 線は画像の外側に出す（線幅 0.25pt の半分だけ外へ）。画像の 25mm は変えない。
        c += 'q 0.55 G 0.25 w\n';
        for (const t of cells) {
          c += f3(t.x - 0.125) + ' ' + f3(t.y - 0.125) + ' ' + f3(sizePt + 0.25) + ' ' + f3(sizePt + 0.25) + ' re S\n';
        }
        c += 'Q\n';
      }
      for (const t of cells) {
        c += 'q ' + f3(sizePt) + ' 0 0 ' + f3(sizePt) + ' ' + f3(t.x) + ' ' + f3(t.y) + ' cm /Im' + t.k + ' Do Q\n';
      }
      const content = enc.encode(c);
      begin(pageId(p));
      str('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f3(PAGE.w * MM) + ' ' + f3(PAGE.h * MM) +
        '] /Resources << /XObject << ' +
        cells.map((t) => '/Im' + t.k + ' ' + imgId(t.idx) + ' 0 R').join(' ') +
        ' >> >> /Contents ' + contId(p) + ' 0 R >>\n');
      end();
      begin(contId(p));
      str('<< /Length ' + content.length + ' >>\nstream\n');
      push(content);
      str('\nendstream\n');
      end();
    }

    const total = 4 + n + pageCount * 2;
    const xref = offset;
    str('xref\n0 ' + total + '\n0000000000 65535 f \n');
    for (let id = 1; id < total; id++) str(pad10(offsets[id]) + ' 00000 n \n');
    str('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

    const out = new Uint8Array(offset);
    let pos = 0;
    for (const ch of chunks) { out.set(ch, pos); pos += ch.length; }
    return { bytes: out, pageCount };
  }

  E.pdf = { MM, layout, build, jpegInfo };
})((window.Ehon = window.Ehon || {}));
