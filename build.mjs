// 本番ビルド：必要なファイルを dist/ にまとめ、Service Worker にキャッシュ一覧を埋め込む。
// すべて相対パスなので、dist/ をそのまま GitHub Pages（ルートでもサブパスでも）に置ける。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkDir } from './check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const COPY = ['index.html', 'screens.html', 'manifest.json', 'sw.js', 'src', 'icons'];

function copyRec(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) copyRec(path.join(src, n), path.join(dst, n));
  } else {
    fs.copyFileSync(src, dst);
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const item of COPY) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) {
    console.error(`ビルドに必要なファイルがありません: ${item}`);
    process.exit(1);
  }
  copyRec(src, path.join(dist, item));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), ''); // GitHub Pages の Jekyll 処理を無効化

// ビルドID = 全ファイル内容のハッシュ（変更があるとキャッシュが更新される）
const files = walk(dist).filter((f) => path.basename(f) !== 'sw.js' && path.basename(f) !== '.nojekyll').sort();
const hash = crypto.createHash('sha1');
for (const f of files) {
  hash.update(path.relative(dist, f));
  hash.update(fs.readFileSync(f));
}
const buildId = hash.digest('hex').slice(0, 10);

const precache = ['./', ...files.map((f) => './' + path.relative(dist, f).split(path.sep).join('/'))];
const swPath = path.join(dist, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace('__BUILD_ID__', buildId).replace('/*__PRECACHE__*/ []', JSON.stringify(precache, null, 2));
fs.writeFileSync(swPath, sw);

console.log(`ビルド完了: dist/（${files.length + 1} ファイル, build ${buildId}）`);

const { errors, ok } = checkDir(dist);
ok.forEach((l) => console.log('✔', l));
if (errors.length) {
  errors.forEach((l) => console.error('✖', l));
  process.exit(1);
}
console.log('✔ GitHub Pages 向けの検査に合格（相対パス・manifest・Service Worker・アイコン）');
