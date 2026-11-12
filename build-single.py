import re, base64, json
import os
S=os.path.dirname(os.path.abspath(__file__))+'/'
r=lambda p:open(S+p,encoding='utf-8').read()
def b64(p): return 'data:image/png;base64,'+base64.b64encode(open(S+p,'rb').read()).decode()
icon192,icon512,maskable,apple,fav=[b64(n) for n in ['icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon-32.png']]

css=r('styles.css')
shtml=r('screens.html')
extra=re.search(r'<style>(.*?)</style>',shtml,re.S).group(1)
extra=extra.replace('body { background: #efe6d8; }','')
extra=extra.replace('.page {','.gallery .page {').replace('.page >','.gallery .page >').replace('figure {','.gallery figure {').replace('figcaption','.gallery figcaption').replace('.grid {','.gallery .grid {').replace('.phone','.gallery .phone')
css+='\n'+extra+'\n.gallery{background:#efe6d8;min-height:100vh}\n'

inline=re.search(r'<script>\s*\(function \(E\) \{(.*?)\}\)\(window\.Ehon\);\s*</script>',shtml,re.S).group(1)
inline=inline.replace("const grid = document.getElementById('grid');","""const page = h('div', { class: 'page' },
        h('header', {}, h('h1', {}, '📚 絵本ラベルメーカー ― 画面確認ページ'),
          h('p', {}, 'アプリ本体と同じ画面コードで描画しています。サンプルデータのため、保存やカメラは動きません。'),
          h('p', {}, 'トリミング画面は実際に操作できます。'),
          h('div', { class: 'links' }, h('a', { class: 'btn primary', href: '#/' }, 'アプリを開く'))),
        h('div', { class: 'grid' }));
      const grid = page.querySelector('.grid');
      container.className = 'gallery';
      container.replaceChildren(page);""")
gallery='(function (E) {\n  E.gallery = function (container) {'+inline+'};\n})(window.Ehon = window.Ehon || {});'

main=r('main.js')
# 画面確認ルート
main=main.replace("if (path === '/pdf') return showPdf(seq);","if (path === '/pdf') return showPdf(seq);\n    if (path === '/screens') { const c = h('div', {}); mount(c); return E.gallery(c); }")
main=main.replace("app.replaceChildren(el);","""app.replaceChildren(el);
    app.style.maxWidth = el.className === 'gallery' || el.firstChild === null ? 'none' : '';
    if (el.getAttribute && el.getAttribute('data-screen') === 'home') {
      el.append(h('p', { class: 'note', style: 'text-align:center' }, h('a', { href: '#/screens' }, '画面確認ページを開く')));
    }""")
# Service Worker は単一ファイルでは持てないので削除
main=re.sub(r"\n  // Service Worker.*?\n  \}\n\n  E\.app","\n  E.app",main,flags=re.S)
assert 'serviceWorker' not in main
# マニフェストを実行時に生成
manifest_js='''
(function () {
  try {
    var base = location.href.split('#')[0];
    var m = { name: '絵本ラベルメーカー', short_name: '絵本ラベル', lang: 'ja', display: 'standalone', start_url: base, scope: base,
      background_color: '#fff8ef', theme_color: '#f08a3c',
      icons: [{ src: %s, sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: %s, sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: %s, sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
    var l = document.createElement('link'); l.rel = 'manifest';
    l.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
    document.head.appendChild(l);
  } catch (e) { /* マニフェストなしでも動作する */ }
})();
''' % (json.dumps(icon192),json.dumps(icon512),json.dumps(maskable))

order=['dom','isbn','store','imaging','barcode','cover','cropper','pdf','views']
js=''.join(f'/* ==== {n}.js ==== */\n{r(n+".js")}\n' for n in order)+gallery+'\n/* ==== main.js ==== */\n'+main
assert '</script' not in js

html=f'''<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>絵本ラベルメーカー</title>
<meta name="description" content="絵本の表紙を25mm角のラベルにしてA4に印刷するアプリ（単一ファイル版）">
<meta name="theme-color" content="#f08a3c">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="絵本ラベル">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="icon" type="image/png" href="{fav}">
<link rel="apple-touch-icon" href="{apple}">
<style>
{css}
</style>
</head>
<body>
<div id="app"></div>
<noscript>このアプリは JavaScript が必要です。</noscript>
<script>
{manifest_js}
</script>
<script>
{js}
</script>
</body>
</html>
'''
open(S+'index.html','w',encoding='utf-8').write(html)
print(len(html)//1024,'KB')
