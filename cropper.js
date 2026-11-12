/* 正方形トリミングUI：ドラッグ移動・ピンチ/ホイール/ボタン/スライダーで拡大縮小 */
(function (E) {
  'use strict';

  const { h } = E.dom;
  const MAX_ZOOM = 5;

  /** @param {HTMLImageElement} img 読み込み済みの画像 */
  function create(img) {
    const w = img.naturalWidth;
    const hh = img.naturalHeight;
    const minZoom = Math.min(w, hh) / Math.max(w, hh); // 全体が収まる倍率
    const st = { zoom: 1, ox: 0, oy: 0 };

    img.className = 'crop-img';
    img.alt = '';
    img.draggable = false;
    img.style.width = w + 'px';
    img.style.height = hh + 'px';

    const view = h('div', { class: 'crop-viewport', 'data-testid': 'crop-viewport' }, img, h('div', { class: 'crop-grid' }));

    const slider = h('input', {
      type: 'range', class: 'zoom-slider', min: String(minZoom), max: String(MAX_ZOOM), step: '0.01', value: '1',
      'aria-label': '拡大率',
      onInput: (e) => { st.zoom = Number(e.target.value); update(); },
    });

    function V() { return view.clientWidth || 300; }

    function update() {
      st.zoom = Math.min(MAX_ZOOM, Math.max(minZoom, st.zoom));
      const v = V();
      const sc = (v / Math.min(w, hh)) * st.zoom;
      const maxX = (w * sc) / v / 2;
      const maxY = (hh * sc) / v / 2;
      st.ox = Math.min(maxX, Math.max(-maxX, st.ox));
      st.oy = Math.min(maxY, Math.max(-maxY, st.oy));
      img.style.transform =
        'translate(-50%, -50%) translate(' + st.ox * v + 'px, ' + st.oy * v + 'px) scale(' + sc + ')';
      slider.value = String(st.zoom);
    }

    // ---- ポインター操作（1本=移動 / 2本=ピンチ）----
    const pointers = new Map();
    let pinchDist = 0;
    view.addEventListener('pointerdown', (e) => {
      view.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    view.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const prev = { x: p.x, y: p.y };
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) {
        st.ox += (p.x - prev.x) / V();
        st.oy += (p.y - prev.y) / V();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) st.zoom *= d / pinchDist;
        pinchDist = d;
      }
      update();
    });
    const endPointer = (e) => { pointers.delete(e.pointerId); pinchDist = 0; };
    view.addEventListener('pointerup', endPointer);
    view.addEventListener('pointercancel', endPointer);
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      st.zoom *= Math.exp(-e.deltaY * 0.0015);
      update();
    }, { passive: false });

    // ---- ボタン ----
    const STEP = 0.04;
    const btn = (label, aria, fn, cls = '') =>
      h('button', { type: 'button', class: 'btn small ' + cls, 'aria-label': aria, onClick: fn }, label);
    const zoomBy = (f) => () => { st.zoom *= f; update(); };
    const move = (dx, dy) => () => { st.ox += dx; st.oy += dy; update(); };

    const controls = h('div', { class: 'crop-controls' },
      h('div', { class: 'zoom-row' },
        btn('－ 縮小', '縮小', zoomBy(1 / 1.1)),
        slider,
        btn('＋ 拡大', '拡大', zoomBy(1.1))
      ),
      h('div', { class: 'move-pad', role: 'group', 'aria-label': '移動' },
        btn('↑', '上へ移動', move(0, -STEP), 'up'),
        btn('←', '左へ移動', move(-STEP, 0), 'left'),
        btn('リセット', 'リセット', () => { st.zoom = 1; st.ox = 0; st.oy = 0; update(); }, 'reset'),
        btn('→', '右へ移動', move(STEP, 0), 'right'),
        btn('↓', '下へ移動', move(0, STEP), 'down')
      )
    );

    const el = h('div', { class: 'cropper' }, view, controls);

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(view);
    else window.addEventListener('resize', update);
    requestAnimationFrame(update);

    return {
      el,
      state: st,
      update,
      /** 現在の見た目のとおりに正方形 JPEG(dataURL) を書き出す */
      getResult: (size) => E.imaging.renderSquare(img, st.zoom, st.ox, st.oy, size),
    };
  }

  E.cropper = { create };
})((window.Ehon = window.Ehon || {}));
