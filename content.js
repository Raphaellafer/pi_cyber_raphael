/* Executado em cada frame; não injeta scripts e não lê valores armazenados. */
"use strict";

(() => {
  const indexedDBCalls = { open: 0, deleteDatabase: 0 };
  let hooksAvailable = true;
  const registration = browser.runtime.sendMessage({ type: "registerFrame" }).catch(() => null);

  function installIndexedDBHooks() {
    try {
      const page = window.wrappedJSObject;
      const prototype = page.IDBFactory.prototype;
      for (const method of Object.keys(indexedDBCalls)) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
        const native = descriptor.value;
        // Mantém this, argumentos, retorno e exceções originais da API da página.
        const wrapper = exportFunction(function (...args) {
          indexedDBCalls[method] += 1;
          return Reflect.apply(native, this, args);
        }, page);
        Object.defineProperty(prototype, method, { ...descriptor, value: wrapper });
      }
    } catch {
      hooksAvailable = false;
    }
  }

  function storageCount(name) {
    try {
      return { status: "available", items: window[name].length };
    } catch {
      return { status: "unavailable", items: null };
    }
  }

  async function databaseCount() {
    let timer;
    try {
      if (typeof window.indexedDB.databases !== "function") {
        return { status: "unsupported", databases: null };
      }
      // Uma API que não responde não deve impedir as outras medições.
      const databases = await Promise.race([
        window.indexedDB.databases(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 1500); })
      ]);
      return { status: "available", databases: databases.length };
    } catch {
      return { status: "unavailable", databases: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function takeSnapshot(phase) {
    const snapshot = {
      measuredAt: Date.now(),
      localStorage: storageCount("localStorage"),
      sessionStorage: storageCount("sessionStorage"),
      indexedDB: { calls: { ...indexedDBCalls }, hooksAvailable }
    };
    Object.assign(snapshot.indexedDB, await databaseCount());
    const document = await registration;
    if (!document) return;
    try {
      await browser.runtime.sendMessage({ type: "storageSnapshot", token: document.token, phase, snapshot });
    } catch {
      // A extensão pode ser recarregada enquanto a página continua aberta.
    }
  }

  function onLoad() {
    void takeSnapshot("load");
    setTimeout(() => { void takeSnapshot("after3s"); }, 3000);
  }

  installIndexedDBHooks();
  if (document.readyState === "complete") onLoad();
  else window.addEventListener("load", onLoad, { once: true });
})();
