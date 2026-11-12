// 単体テスト（依存なし）：ISBN検証・EAN-13デコーダー・PDFレイアウト/生成
// ブラウザ向けの IIFE スクリプトを、最小限のダミー window 上で読み込んで検査する。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { Ehon: {}, addEventListener() {} };
win.window = win;
const ctx = vm.createContext({
  window: win, document: { createElement: () => ({ setAttribute() {}, append() {}, addEventListener() {} }), createTextNode: (t) => t },
  console, TextEncoder, atob: (s) => Buffer.from(s, 'base64').toString('binary'), navigator: {},
});
for (const f of ['dom', 'isbn', 'barcode', 'pdf']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}
const E = win.Ehon;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✔', name); };

t('ISBN-13 検証', () => {
  assert.ok(E.isbn.isbn13Valid('9784834000825'));
  assert.ok(!E.isbn.isbn13Valid('9784834000826'));
});
t('ISBN-10 → 13 変換 / ハイフン除去', () => {
  assert.equal(E.isbn.normalize('4-8340-0082-6'), '9784834000825');
  assert.equal(E.isbn.normalize('978-4-8340-0082-5'), '9784834000825');
  assert.equal(E.isbn.normalize('1234567890'), null);
  assert.equal(E.isbn.normalize('9780306406157'), '9780306406157');
});

// ---- EAN-13 を合成してデコーダーに通す ----
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13Bits(code) {
  const d = [...code].map(Number);
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (P[d[0]][i] === 'L' ? L : G)[d[i + 1]];
  bits += '01010';
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]];
  return bits + '101';
}
function row(code, module, quiet = 12, noise = 0) {
  const bits = '0'.repeat(quiet) + ean13Bits(code) + '0'.repeat(quiet);
  const out = [];
  let seed = 7;
  for (const b of bits) for (let i = 0; i < module; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const nz = noise ? ((seed % 1000) / 1000 - 0.5) * noise : 0;
    out.push(Math.max(0, Math.min(255, (b === '1' ? 30 : 225) + nz)));
  }
  return Uint8Array.from(out);
}
t('EAN-13 デコード（各モジュール幅・ノイズ）', () => {
  for (const m of [1, 2, 3, 5]) assert.equal(E.barcode.decodeRow(row('9784834000825', m, 12 * m, m > 1 ? 40 : 0)), '9784834000825');
});
t('EAN-13 デコード（左右反転 = 上下逆さ）', () => {
  assert.equal(E.barcode.decodeRow(row('9784834000825', 3, 36, 30).reverse()), '9784834000825');
});
t('ISBN以外の EAN（978/979 以外）は拒否', () => {
  assert.equal(E.barcode.decodeRow(row('4901234567894', 3, 36)), null);
});
t('2次元画像（縦向きバーコード）のスキャン', () => {
  const w = 300, h = 400, g = new Uint8Array(w * h).fill(235);
  const bars = row('9784834000825', 3, 6);
  for (let y = 0; y < h; y++) for (let x = 0; x < 80 && x < w; x++) g[y * w + 100 + x] = 235;
  // 縦に描く（y 方向にバーを並べる）
  const vh = Math.min(h, bars.length);
  for (let y = 0; y < vh; y++) for (let x = 60; x < 240; x++) g[y * w + x] = bars[y];
  assert.equal(E.barcode.scanGray(g, w, h), '9784834000825');
});

// ---- PDF ----
t('A4 レイアウト（25mm・7列×10行）', () => {
  const L2 = E.pdf.layout();
  assert.equal(L2.size, 25);
  assert.equal(L2.cols, 7);
  assert.equal(L2.rows, 10);
  assert.equal(L2.perPage, 70);
  const right = L2.left + L2.cols * L2.size + (L2.cols - 1) * L2.gap;
  assert.ok(L2.left >= 10 && 210 - right >= 10, '左右余白 10mm 以上');
  assert.ok(L2.top >= 10 && 297 - (L2.top + L2.rows * L2.size + (L2.rows - 1) * L2.gap) >= 10, '上下余白 10mm 以上');
});

t('PDF 生成：25mm = 70.866pt の画像が配置される', () => {
  // 最小の有効 JPEG（SOF0 のみ解析できれば十分な 480x480 / 3成分のヘッダ）
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x01, 0xe0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.from([0xff, 0xd9])]);
  const url = 'data:image/jpeg;base64,' + jpeg.toString('base64');
  const books = Array.from({ length: 75 }, () => ({ image: url }));
  const { bytes, pageCount } = E.pdf.build(books, { cutLines: true });
  assert.equal(pageCount, 2);
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.includes('/MediaBox [0 0 595.276 841.890]'));
  const cms = [...s.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im\d+ Do Q/g)];
  assert.equal(cms.length, 75);
  for (const m of cms) {
    assert.ok(Math.abs(Number(m[1]) - 70.866) < 0.001 && Math.abs(Number(m[2]) - 70.866) < 0.001, '1辺 70.866pt');
  }
  assert.ok(s.includes('/Width 480 /Height 480'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
});

console.log(`\n${n} 件すべて合格`);
