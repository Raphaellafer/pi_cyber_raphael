/* Cálculo simplificado de domínio base para sites brasileiros. */
"use strict";

globalThis.PrivacyDomains = (() => {
  const SUFIXOS = ["com", "com.br", "edu.br", "gov.br", "org.br", "net.br"];

  function hostname(value) {
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return "";
      return url.hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      return "";
    }
  }

  function baseDomain(value) {
    const host = hostname(value);
    if (!host || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
    const labels = host.split(".");
    const suffixoDuasPartes = labels.slice(-2).join(".");

    // Simplificação intencional: sufixos estrangeiros de duas partes, como
    // co.uk, não são tratados porque a análise está focada em sites brasileiros.
    const partesDoDominio = SUFIXOS.includes(suffixoDuasPartes) ? 3 : 2;
    return labels.slice(-Math.min(partesDoDominio, labels.length)).join(".");
  }

  function isThirdParty(resource, page) {
    const resourceBase = baseDomain(resource);
    const pageBase = baseDomain(page);
    return Boolean(resourceBase && pageBase && resourceBase !== pageBase);
  }

  // Compara por fronteira de rótulo: eviltracker.com não corresponde a tracker.com.
  function isTracker(value, trackers) {
    const labels = hostname(value).split(".");
    while (labels.length) {
      if (trackers.has(labels.join("."))) return true;
      labels.shift();
    }
    return false;
  }

  return { hostname, baseDomain, isThirdParty, isTracker };
})();
