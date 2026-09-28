/* Executado em cada frame; não injeta scripts nem expõe valores ao popup. */
"use strict";

(() => {
  const indexedDBCalls = { open: 0, deleteDatabase: 0 };
  let hooksAvailable = true;
  const registration = browser.runtime.sendMessage({ type: "registerFrame" }).catch(() => null);

  async function sendFrameMessage(message) {
    const documentRegistration = await registration;
    if (!documentRegistration) return;
    try {
      await browser.runtime.sendMessage({ ...message, token: documentRegistration.token });
    } catch {
      // A extensão pode ser recarregada enquanto a página continua aberta.
    }
  }

  function installIndexedDBHooks(page) {
    try {
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

  function scriptFromStack() {
    const stack = String(new Error().stack || "");
    const urls = stack.match(/(?:https?|file):\/\/[^\s)]+/g) || [];
    for (const url of urls) {
      const clean = url.replace(/:\d+:\d+$/, "");
      if (!clean.startsWith("moz-extension://")) return clean;
    }
    return "Origem desconhecida";
  }

  function installMethodHook(page, prototype, method, api) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    if (!descriptor || typeof descriptor.value !== "function") return;
    const native = descriptor.value;
    const wrapper = exportFunction(function (...args) {
      const script = scriptFromStack();
      const result = Reflect.apply(native, this, args);
      void sendFrameMessage({ type: "canvasCall", api, script });
      return result;
    }, page);
    Object.defineProperty(prototype, method, { ...descriptor, value: wrapper });
  }

  function installCanvasHooks(page) {
    try {
      installMethodHook(page, page.HTMLCanvasElement.prototype, "toDataURL", "toDataURL");
      installMethodHook(page, page.HTMLCanvasElement.prototype, "toBlob", "toBlob");
      installMethodHook(page, page.CanvasRenderingContext2D.prototype, "getImageData", "getImageData");
      installMethodHook(page, page.CanvasRenderingContext2D.prototype, "fillText", "fillText");
    } catch {
      // Um construtor ausente neste frame não deve impedir as outras medições.
    }
  }

  function findCookieDescriptor(page) {
    let prototype = page.Document.prototype;
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "cookie");
      if (descriptor?.set) return { prototype, descriptor };
      prototype = Object.getPrototypeOf(prototype);
    }
    return null;
  }

  function installCookieHook(page) {
    try {
      const found = findCookieDescriptor(page);
      if (!found) return;
      const nativeSetter = found.descriptor.set;
      const setter = exportFunction(function (value) {
        // Converte uma única vez, como faria o setter nativo de DOMString.
        const serialized = String(value);
        const result = Reflect.apply(nativeSetter, this, [serialized]);
        void sendFrameMessage({ type: "jsCookie", cookie: serialized });
        return result;
      }, page);
      Object.defineProperty(found.prototype, "cookie", { ...found.descriptor, set: setter });
    } catch {
      // Alguns documentos especiais não permitem alterar o descritor.
    }
  }

  function installPageHooks() {
    try {
      const page = window.wrappedJSObject;
      installIndexedDBHooks(page);
      installCanvasHooks(page);
      installCookieHook(page);
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
    await sendFrameMessage({ type: "storageSnapshot", phase, snapshot });
  }

  function onLoad() {
    void takeSnapshot("load");
    setTimeout(() => { void takeSnapshot("after3s"); }, 3000);
  }

  installPageHooks();
  if (document.readyState === "complete") onLoad();
  else window.addEventListener("load", onLoad, { once: true });
})();
