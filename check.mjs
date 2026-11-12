// ビルド成果物（dist）の検査：
//  - 必須ファイルの存在
//  - HTML / CSS / manifest / Service Worker 内のパスがすべて「相対パス」で、参照先が実在する
//    → GitHub Pages のサブパス（/リポジトリ名/）で 404 にならないことを保証する
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const external = /^(https?:|data:|blob:|mailto:|tel:|#|javascript:)/i;

export function checkDir(dir) {
  const errors = [];
  const ok = [];
  const exists = (p) => fs.existsSync(p);

  for (const f of ['index.html', 'screens.html', 'manifest.json', 'sw.js', '.nojekyll']) {
    if (!exists(path.join(dir, f))) errors.push(`必須ファイルがありません: ${f}`);
  }
  if (errors.length) return { errors, ok };

  function checkRef(fromFile, ref, kind) {
    if (!ref || external.test(ref)) return;
    if (ref.startsWith('//')) return;
    if (ref.startsWith('/')) {
      errors.push(`${path.relative(dir, fromFile)}: ${kind} が絶対パスです（サブパスで壊れます）: ${ref}`);
      return;
    }
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) return;
    const target = path.resolve(path.dirname(fromFile), clean);
    if (!exists(target)) errors.push(`${path.relative(dir, fromFile)}: ${kind} の参照先がありません: ${ref}`);
  }

  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      const html = fs.readFileSync(file, 'utf8');
      for (const m of html.matchAll(/\b(?:href|src)=["']([^"']*)["']/g)) checkRef(file, m[1], 'HTML');
      ok.push(`${rel}: パス検査OK`);
    } else if (ext === '.css') {
      const css = fs.readFileSync(file, 'utf8');
      for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) checkRef(file, m[1], 'CSS');
    } else if (ext === '.js') {
      const js = fs.readFileSync(file, 'utf8');
      // ルート起点の fetch / register は GitHub Pages のサブパスで壊れる
      for (const m of js.matchAll(/(?:fetch|register)\(\s*['"`](\/[^'"`]*)['"`]/g)) {
        errors.push(`${rel}: ルート起点のパスを使っています: ${m[1]}`);
      }
    }
  }

  // manifest
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const mfFile = path.join(dir, 'manifest.json');
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
    if (!mf[k]) errors.push(`manifest.json に ${k} がありません`);
  }
  if (mf.display !== 'standalone') errors.push('manifest.json: display は standalone にしてください');
  for (const k of ['start_url', 'scope', 'id']) if (mf[k]) checkRef(mfFile, mf[k], 'manifest.' + k);
  const sizes = new Set();
  for (const ic of mf.icons || []) {
    checkRef(mfFile, ic.src, 'manifest icon');
    sizes.add(ic.sizes);
  }
  if (!sizes.has('192x192') || !sizes.has('512x512')) errors.push('manifest.json: 192x192 と 512x512 のアイコンが必要です');
  ok.push('manifest.json: 検査OK');

  // Service Worker
  const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  if (sw.includes('__BUILD_ID__')) errors.push('sw.js: BUILD_ID が置換されていません');
  const m = sw.match(/const PRECACHE = (\[[\s\S]*?\]);/);
  if (!m) errors.push('sw.js: PRECACHE が見つかりません');
  else {
    const list = JSON.parse(m[1]);
    if (list.length < 5) errors.push('sw.js: PRECACHE が空に近いです');
    for (const p of list) checkRef(path.join(dir, 'sw.js'), p, 'PRECACHE');
    ok.push(`sw.js: PRECACHE ${list.length} 件が実在`);
  }

  // iPhone 向けメタ
  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const needle of ['rel="manifest"', 'apple-touch-icon', 'apple-mobile-web-app-capable', 'viewport-fit=cover']) {
    if (!idx.includes(needle)) errors.push(`index.html に ${needle} がありません`);
  }
  return { errors, ok };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = path.resolve(root, process.argv[2] || 'dist');
  if (!fs.existsSync(dir)) {
    console.error(`${dir} がありません。先に npm run build を実行してください。`);
    process.exit(1);
  }
  const { errors, ok } = checkDir(dir);
  ok.forEach((l) => console.log('✔', l));
  if (errors.length) {
    errors.forEach((l) => console.error('✖', l));
    process.exit(1);
  }
  console.log('すべての検査に合格しました。');
}
