/* ISBN の検証・正規化 */
(function (E) {
  'use strict';

  function digits(s) {
    return String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  }

  function isbn13Valid(s) {
    if (!/^\d{13}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }

  function isbn10Valid(s) {
    if (!/^\d{9}[\dX]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0;
  }

  function isbn10to13(s) {
    const core = '978' + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }

  /** ISBN-10 / ISBN-13（ハイフン可）を 13桁の文字列へ。無効なら null。 */
  function normalize(input) {
    const d = digits(input);
    if (d.length === 13 && isbn13Valid(d) && /^97[89]/.test(d)) return d;
    if (d.length === 10 && isbn10Valid(d)) return isbn10to13(d);
    return null;
  }

  E.isbn = { digits, isbn13Valid, isbn10Valid, isbn10to13, normalize };
})((window.Ehon = window.Ehon || {}));
