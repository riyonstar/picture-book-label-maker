/* 絵本データの保存（IndexedDB）。端末内にのみ保存され、外部へは送信しない。 */
(function (E) {
  'use strict';

  const DB_NAME = 'ehon-label-maker';
  const STORE = 'books';
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      // iOS Safari による自動削除を避けるため、永続化を要求する（失敗しても無視）
      try {
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      } catch (e) { /* ignore */ }
    }
    return dbPromise;
  }

  function run(mode, fn) {
    return db().then(
      (d) =>
        new Promise((resolve, reject) => {
          const tx = d.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        })
    );
  }

  function uid() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 登録順（古い順）で返す。印刷順もこの順。 */
  async function list() {
    const all = (await run('readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  function get(id) {
    return run('readonly', (s) => s.get(id));
  }

  function put(book) {
    return run('readwrite', (s) => s.put(book));
  }

  function remove(id) {
    return run('readwrite', (s) => s.delete(id));
  }

  E.store = { list, get, put, remove, uid };
})((window.Ehon = window.Ehon || {}));
