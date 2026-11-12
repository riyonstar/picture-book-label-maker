/* 画像の読み込み・正方形への書き出し */
(function (E) {
  'use strict';

  const OUT_SIZE = 480; // 25mm 角に対して約 490dpi

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = src;
    });
  }

  async function fileToImage(file) {
    const url = URL.createObjectURL(file);
    try {
      // 画像は <img> 経由で読み込むため、EXIF の向きはブラウザが自動補正する
      return await loadImage(url);
    } finally {
      // onload 後は破棄してよい（デコード済み）
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  /** 画像を最大辺 maxDim の JPEG(dataURL) にする（保存用の原本）。 */
  function imageToDataUrl(img, maxDim = 1200, quality = 0.9) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const s = Math.min(1, maxDim / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  /** 全体が収まるときのズーム値（zoom=1 は短辺基準の「切り抜き」）。 */
  function containZoom(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    return Math.min(w, h) / Math.max(w, h);
  }

  /**
   * 正方形に書き出す。
   * zoom=1 → 短辺が枠にぴったり（長辺側は切り抜き）
   * ox, oy → 枠の大きさを 1 とした画像中心のずれ
   */
  function renderSquare(img, zoom, ox, oy, size = OUT_SIZE) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = (size / Math.min(w, h)) * zoom;
    const dw = w * scale;
    const dh = h * scale;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, size / 2 + ox * size - dw / 2, size / 2 + oy * size - dh / 2, dw, dh);
    return c.toDataURL('image/jpeg', 0.92);
  }

  /** 「そのまま使用」：表紙全体を欠けなく正方形（余白は白）に収める。 */
  function renderContain(img, size = OUT_SIZE) {
    return renderSquare(img, containZoom(img), 0, 0, size);
  }

  E.imaging = { OUT_SIZE, loadImage, fileToImage, imageToDataUrl, containZoom, renderSquare, renderContain };
})((window.Ehon = window.Ehon || {}));
