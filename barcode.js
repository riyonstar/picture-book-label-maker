/*
 * バーコード読み取り（EAN-13 / ISBN-13）
 *
 * iPhone Safari には BarcodeDetector が無いため、ライブラリ無しで動く
 * 自前の EAN-13 デコーダーを持つ。BarcodeDetector がある環境ではそちらも併用する。
 *  - カメラ映像のスキャン（startCamera）
 *  - 写真からの読み取り（scanImage）
 */
(function (E) {
  'use strict';

  const { h } = E.dom;

  // ---- EAN-13 パターン（1=バー, 0=スペース）----
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  function toRuns(bits) {
    const runs = [];
    let cur = bits[0];
    let n = 0;
    for (const b of bits) {
      if (b === cur) n++;
      else { runs.push(n); cur = b; n = 1; }
    }
    runs.push(n);
    return runs;
  }

  const TABLE_LG = [];
  const TABLE_R = [];
  L.forEach((b, d) => TABLE_LG.push({ digit: d, set: 'L', pat: toRuns(b) }));
  G.forEach((b, d) => TABLE_LG.push({ digit: d, set: 'G', pat: toRuns(b) }));
  R.forEach((b, d) => TABLE_R.push({ digit: d, set: 'R', pat: toRuns(b) }));

  function matchDigit(w, table) {
    const total = w[0] + w[1] + w[2] + w[3];
    if (total <= 0) return null;
    const m = total / 7;
    let best = null;
    let bestErr = Infinity;
    for (const c of table) {
      let err = 0;
      for (let i = 0; i < 4; i++) err += Math.abs(w[i] / m - c.pat[i]);
      if (err < bestErr) { bestErr = err; best = c; }
    }
    return bestErr < 1.4 ? best : null;
  }

  function guardOk(lens, start, count) {
    let sum = 0;
    for (let k = 0; k < count; k++) sum += lens[start + k];
    const u = sum / count;
    for (let k = 0; k < count; k++) {
      if (lens[start + k] < u * 0.5 || lens[start + k] > u * 1.8) return 0;
    }
    return u;
  }

  /** lens[i] が開始ガード（バー）の先頭となる位置から 13 桁を読む。 */
  function decodeAt(lens, i) {
    if (i + 58 >= lens.length) return null;
    const u = guardOk(lens, i, 3);
    if (!u) return null;
    if (i > 0 && lens[i - 1] < u * 3) return null; // 静かなゾーン
    if (!guardOk(lens, i + 27, 5)) return null; // 中央ガード
    const left = [];
    let parity = '';
    for (let k = 0; k < 6; k++) {
      const p = i + 3 + 4 * k;
      const c = matchDigit(lens.slice(p, p + 4), TABLE_LG);
      if (!c) return null;
      left.push(c.digit);
      parity += c.set;
    }
    const first = PARITY.indexOf(parity);
    if (first < 0) return null;
    const right = [];
    for (let k = 0; k < 6; k++) {
      const p = i + 32 + 4 * k;
      const c = matchDigit(lens.slice(p, p + 4), TABLE_R);
      if (!c) return null;
      right.push(c.digit);
    }
    return [first, ...left, ...right].join('');
  }

  function accept(code) {
    return typeof code === 'string' && /^97[89]\d{10}$/.test(code) && E.isbn.isbn13Valid(code);
  }

  function decodeLens(lens, darkFirst) {
    const n = lens.length;
    for (let i = darkFirst ? 0 : 1; i < n; i += 2) {
      const code = decodeAt(lens, i);
      if (code && accept(code)) return code;
    }
    return null;
  }

  function decodeBoth(lens, darkFirst) {
    const f = decodeLens(lens, darkFirst);
    if (f) return f;
    const rev = lens.slice().reverse();
    const lastDark = (lens.length - 1) % 2 === 0 ? darkFirst : !darkFirst;
    return decodeLens(rev, lastDark); // 上下逆さ（右から左）
  }

  function blur(src, r) {
    if (r <= 0) return src;
    const n = src.length;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - r);
      const hi = Math.min(n, i + r + 1);
      out[i] = (pre[hi] - pre[lo]) / (hi - lo);
    }
    return out;
  }

  function runsFromBits(bits) {
    const lens = [];
    let cur = bits[0];
    let n = 0;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === cur) n++;
      else { lens.push(n); cur = bits[i]; n = 1; }
    }
    lens.push(n);
    return { lens, darkFirst: bits[0] === 1 };
  }

  function binarize(row, mode) {
    const n = row.length;
    const g = blur(row, n > 1000 ? Math.floor(n / 1000) + 1 : n > 500 ? 1 : 0);
    const bits = new Uint8Array(n);
    if (mode === 'local') {
      const W = Math.max(16, Math.floor(n / 10));
      const pre = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + g[i];
      for (let x = 0; x < n; x++) {
        const lo = Math.max(0, x - W);
        const hi = Math.min(n, x + W + 1);
        const mean = (pre[hi] - pre[lo]) / (hi - lo);
        bits[x] = g[x] < mean - 4 ? 1 : 0;
      }
    } else {
      const sorted = Float32Array.from(g).sort();
      const p5 = sorted[Math.floor(n * 0.05)];
      const p95 = sorted[Math.floor(n * 0.95)];
      if (p95 - p5 < 40) return null;
      const th = (p5 + p95) / 2;
      for (let x = 0; x < n; x++) bits[x] = g[x] < th ? 1 : 0;
    }
    return runsFromBits(bits);
  }

  function decodeRow(row) {
    for (const mode of ['local', 'global']) {
      const r = binarize(row, mode);
      if (!r || r.lens.length < 59) continue;
      const code = decodeBoth(r.lens, r.darkFirst);
      if (code) return code;
    }
    return null;
  }

  function positions(len, count) {
    const out = [];
    for (let j = 0; j < count; j++) {
      const frac = 0.5 + ((j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.9) / (count + 1);
      out.push(Math.min(len - 1, Math.max(0, Math.floor(frac * len))));
    }
    return out;
  }

  /** グレースケール画像（w×h）から横方向 → 縦方向の順にスキャンする。 */
  function scanGray(gray, w, h) {
    const N = 40;
    for (const y of positions(h, N)) {
      const code = decodeRow(gray.subarray(y * w, (y + 1) * w));
      if (code) return code;
    }
    const col = new Uint8Array(h);
    for (const x of positions(w, N)) {
      for (let y = 0; y < h; y++) col[y] = gray[y * w + x];
      const code = decodeRow(col);
      if (code) return code;
    }
    return null;
  }

  function toGray(rgba, w, h) {
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
    }
    return gray;
  }

  function nativeDetector() {
    try {
      if ('BarcodeDetector' in window) return new window.BarcodeDetector({ formats: ['ean_13'] });
    } catch (e) { /* ignore */ }
    return null;
  }

  /** 写真（HTMLImageElement）から ISBN を読む。見つからなければ null。 */
  async function scanImage(img) {
    const nd = nativeDetector();
    if (nd) {
      try {
        const res = await nd.detect(img);
        for (const b of res) if (accept(b.rawValue)) return b.rawValue;
      } catch (e) { /* フォールバック */ }
    }
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (const maxDim of [1600, 900, 2400, 600]) {
      const s = Math.min(1, maxDim / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * s));
      const h = Math.max(1, Math.round(h0 * s));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const code = scanGray(toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h);
      if (code) return code;
      await new Promise((r) => setTimeout(r, 0)); // UI を固めない
    }
    return null;
  }

  /** カメラを開始して container に映像を表示。2回同じ値を読めたら onResult。 */
  async function startCamera(container, { onResult }) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('NO_MEDIA');
      err.name = 'NoMediaError';
      throw err;
    }
    let stopped = false;
    let timer = null;
    const video = h('video', { class: 'scan-video', autoplay: true, muted: true, playsinline: true });
    video.muted = true;
    video.setAttribute('playsinline', '');
    container.replaceChildren(video, h('div', { class: 'scan-guide' }, h('div', { class: 'scan-line' })));

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const stopStream = () => stream.getTracks().forEach((t) => t.stop());
    if (stopped) { stopStream(); return { stop() {} }; }

    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* 自動再生は muted+playsinline で通る */ }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const nd = nativeDetector();
    let last = null;
    let hits = 0;

    async function tick() {
      if (stopped) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          const s = Math.min(1, 1280 / video.videoWidth);
          const w = Math.round(video.videoWidth * s);
          const h2 = Math.round(video.videoHeight * s);
          canvas.width = w;
          canvas.height = h2;
          ctx.drawImage(video, 0, 0, w, h2);
          let code = null;
          if (nd) {
            try {
              for (const b of await nd.detect(canvas)) if (accept(b.rawValue)) { code = b.rawValue; break; }
            } catch (e) { /* ignore */ }
          }
          if (!code) code = scanGray(toGray(ctx.getImageData(0, 0, w, h2).data, w, h2), w, h2);
          if (code) {
            if (code === last) hits++; else { last = code; hits = 1; }
            if (hits >= 2) {
              stop();
              onResult(code);
              return;
            }
          }
        }
      } catch (e) { /* 次のフレームで再試行 */ }
      timer = setTimeout(tick, 90);
    }

    function stop() {
      stopped = true;
      clearTimeout(timer);
      stopStream();
      video.srcObject = null;
    }

    tick();
    return { stop };
  }

  E.barcode = { startCamera, scanImage, scanGray, toGray, accept, decodeRow };
})((window.Ehon = window.Ehon || {}));
