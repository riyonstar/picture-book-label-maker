# 絵本ラベルメーカー（GitHub 用ファイル一式・フラット版）

このzipはフォルダ分けなしです。**別配布の `index.html`（単一ファイル版アプリ）と一緒に** GitHub のリポジトリ直下へ置いてください。

## 公開方法（GitHub Pages）
1. リポジトリ直下に `index.html` と、このzipの中身を置いて push
2. Settings → Pages → Source を「Deploy from a branch」、`main` / `/(root)` にする
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` で開く（HTTPS なのでカメラが使えます）
4. iPhone Safari で開き、共有ボタン →「ホーム画面に追加」

`index.html` は CSS・JS・アイコンをすべて埋め込んだ1ファイルなので、他のファイルがなくても動きます。このzipは、ソースの管理と `index.html` の再生成のためのものです。

## index.html の作り直し方
ソース（`dom.js` `views.js` `styles.css` など）を直したあと、同じ場所で実行します。

```
python3 build-single.py
```

`index.html` が再生成されます（Python 3 と Pillow 不要、標準ライブラリのみ）。

## ファイル一覧
| ファイル | 役割 |
|---|---|
| `dom.js` `isbn.js` `store.js` `imaging.js` `barcode.js` `cover.js` `cropper.js` `pdf.js` `views.js` `main.js` `styles.css` | アプリのソース（元は `src/`） |
| `icon-192.png` `icon-512.png` `icon-maskable-512.png` `apple-touch-icon.png` `favicon-32.png` | アイコン（元は `icons/`） |
| `build-single.py` | 上記から `index.html` を生成 |
| `serve.mjs` `build.mjs` `check.mjs` `unit.mjs` | フォルダ版用の開発サーバー・ビルド・検査・単体テスト（元は `scripts/`）。**元のフォルダ構成に戻したときのみ動作** |
| `screens.html` `manifest.json` `sw.js` `package.json` `e2e.py` | フォルダ版用（画面確認ページ・PWA設定・Service Worker・ブラウザテスト）。単一ファイル版では `index.html` に内蔵 |

## 印刷時の注意
**印刷時は「100% / 実際のサイズ」を選択してください。** 「用紙に合わせる」では 25mm になりません。

## 外部APIについて
書誌情報は openBD / Google Books / Open Library、表紙は openBD / 国立国会図書館 / Google Books / Open Library から取得します（無料・APIキー不要）。

## 補足
- 単一ファイル版は Service Worker を持たないため、オフライン起動はできません。
- `.github/workflows/deploy.yml` はフォルダ構成が前提のため、このzipには含めていません。
