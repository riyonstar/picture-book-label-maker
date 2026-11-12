/*
 * 書誌情報・表紙画像の取得（すべて無料・APIキー不要）
 *   書誌情報: openBD → Google Books → Open Library
 *   表紙画像: openBD / 国立国会図書館サーチ / Google Books / Open Library
 *
 * 画像は canvas に描いて正方形に加工するため CORS が必要。
 * 直接取得できない場合のみ、画像プロキシ（images.weserv.nl）経由で再試行する。
 * 送信されるのは ISBN と表紙画像の URL のみ。
 */
(function (E) {
  'use strict';

  async function fetchTimeout(url, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    } finally {
      clearTimeout(t);
    }
  }

  async function getJson(url) {
    const r = await fetchTimeout(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function joinAuthors(a) {
    return Array.isArray(a) ? a.join('、') : a || '';
  }

  /**
   * 書誌情報を取得する。
   * @returns {{title,author,publisher,covers:string[],networkOk:boolean}}
   */
  async function lookupInfo(isbn) {
    const info = { title: '', author: '', publisher: '', covers: [], networkOk: false };
    const fill = (k, v) => { if (!info[k] && v) info[k] = String(v).trim(); };

    try {
      const j = await getJson('https://api.openbd.jp/v1/get?isbn=' + isbn);
      info.networkOk = true;
      const s = j && j[0] && j[0].summary;
      if (s) {
        fill('title', s.title);
        fill('author', s.author);
        fill('publisher', s.publisher);
        if (s.cover) info.covers.push(s.cover);
      }
    } catch (e) { /* 次へ */ }

    try {
      const j = await getJson('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&maxResults=1');
      info.networkOk = true;
      const it = j && j.items && j.items[0];
      if (it && it.volumeInfo) {
        const v = it.volumeInfo;
        fill('title', v.title);
        fill('author', joinAuthors(v.authors));
        fill('publisher', v.publisher);
        if (it.id) {
          for (const z of [3, 2, 1]) {
            info.covers.push('https://books.google.com/books/content?id=' + it.id + '&printsec=frontcover&img=1&zoom=' + z);
          }
        }
        if (v.imageLinks && v.imageLinks.thumbnail) {
          info.covers.push(v.imageLinks.thumbnail.replace(/^http:/, 'https:'));
        }
      }
    } catch (e) { /* 次へ */ }

    if (!info.title) {
      try {
        const j = await getJson('https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&format=json&jscmd=data');
        info.networkOk = true;
        const b = j && j['ISBN:' + isbn];
        if (b) {
          fill('title', b.title);
          fill('author', (b.authors || []).map((a) => a.name).join('、'));
          fill('publisher', (b.publishers || []).map((p) => p.name).join('、'));
        }
      } catch (e) { /* 次へ */ }
    }
    return info;
  }

  function blobToImage(blob) {
    const url = URL.createObjectURL(blob);
    return E.imaging.loadImage(url).finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
  }

  function proxied(url) {
    return 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));
  }

  async function tryLoad(url) {
    for (const u of [url, proxied(url)]) {
      try {
        const r = await fetchTimeout(u, 10000);
        if (!r.ok) continue;
        const blob = await r.blob();
        if (blob.size < 800) continue;
        const img = await blobToImage(blob);
        // 「画像なし」のプレースホルダーなど極端に小さい画像は除外
        if (Math.min(img.naturalWidth, img.naturalHeight) < 120) continue;
        return img;
      } catch (e) { /* 次の経路へ */ }
    }
    return null;
  }

  /** 表紙画像を探す。見つからなければ null。 */
  async function fetchCover(isbn, info) {
    const urls = [
      ...((info && info.covers) || []),
      'https://cover.openbd.jp/' + isbn + '.jpg',
      'https://ndlsearch.ndl.go.jp/thumbnail/' + isbn + '.jpg',
      'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false',
    ];
    const seen = new Set();
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      const img = await tryLoad(u);
      if (img) return { img, url: u };
    }
    return null;
  }

  E.cover = { lookupInfo, fetchCover };
})((window.Ehon = window.Ehon || {}));
