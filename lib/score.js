/* Pontuação de privacidade de 0 a 100. Metodologia em docs/metodologia-score.md. */
"use strict";

globalThis.PrivacyScore = (() => {
  // score = 100 − Σ min(peso × ocorrências, teto). Os tetos somam 100.
  const CRITERIOS = [
    { id: "rastreadores", rotulo: "Domínio rastreador conhecido (Disconnect)", peso: 4, teto: 20,
      justificativa: "Coleta comportamental confirmada por lista pública." },
    { id: "canvas", rotulo: "Canvas fingerprint", peso: 15, teto: 15,
      justificativa: "Identifica o navegador sem cookie e sobrevive à limpeza." },
    { id: "hijack", rotulo: "Indicador de hijacking/hook", peso: 5, teto: 15,
      justificativa: "Pode interceptar dados ou controlar o navegador." },
    { id: "cookies3p", rotulo: "Cookie de 3ª parte persistente", peso: 2, teto: 15,
      justificativa: "Permite rastreamento entre sites ao longo do tempo." },
    { id: "sync", rotulo: "Cookie sync ou bounce", peso: 5, teto: 10,
      justificativa: "Troca de identificadores entre empresas." },
    { id: "terceiros", rotulo: "3ª parte não rastreadora", peso: 1, teto: 10,
      justificativa: "Expõe IP e Referer a outra empresa." },
    { id: "storage3p", rotulo: "Storage HTML5 em frame de 3ª parte", peso: 2, teto: 10,
      justificativa: "Identificador persistente fora dos cookies." },
    { id: "parametros", rotulo: "Parâmetro de rastreio na URL", peso: 1, teto: 5,
      justificativa: "Identificador de campanha ou clique na própria URL." }
  ];

  const NOTAS = [[85, "A"], [70, "B"], [50, "C"], [30, "D"], [0, "F"]];

  // Lista única de indicadores, usada pelo score e pelos alertas do popup.
  function hijackIndicators(report) {
    const found = new Set();
    const hijack = report?.hijack || {};
    for (const [host, count] of Object.entries(hijack.websockets || {})) {
      found.add(`WebSocket para terceiro: ${host} (${count}×)`);
    }
    for (const poll of hijack.polling || []) {
      found.add(`Polling persistente: ${poll.url} (${poll.maximo} pedidos em 30 s, ${poll.tipo})`);
    }
    for (const signal of hijack.beef || []) found.add(`Assinatura BeEF: ${signal}`);
    for (const frame of Object.values(report?.frames || {})) {
      const hooks = frame.hooks;
      if (!hooks) continue;
      const where = `frame ${frame.frameId} (${frame.thirdParty ? "3ª parte" : "1ª parte"})`;
      for (const name of hooks.overridden) found.add(`${name} substituído no ${where}`);
      if (hooks.beefGlobal) found.add(`Assinatura BeEF: global beef no ${where}`);
      if (hooks.beefCookie) found.add("Assinatura BeEF: cookie BEEFHOOK");
    }
    return [...found];
  }

  function hasStorage(frame) {
    const sample = frame.samples?.after3s || frame.samples?.load;
    if (!sample) return false;
    return (sample.localStorage.items || 0) + (sample.sessionStorage.items || 0) +
      (sample.indexedDB.databases || 0) > 0;
  }

  function occurrences(report) {
    const entries = Object.values(report?.thirdParties || {});
    const trackerBases = new Set(entries.filter(e => e.knownTracker).map(e => e.baseDomain));
    const otherBases = new Set(entries.map(e => e.baseDomain).filter(base => !trackerBases.has(base)));
    // O mesmo cookie pode ser gravado várias vezes; conta nome + domínio uma vez.
    const persistent3p = new Set((report?.cookies || [])
      .filter(c => c.parte === "3ª" && c.tipo === "persistente")
      .map(c => `${c.nome}|${c.dominio}`));
    const frames = Object.values(report?.frames || {});
    return {
      rastreadores: trackerBases.size,
      canvas: (report?.canvasFingerprints || []).length,
      hijack: hijackIndicators(report).length,
      cookies3p: persistent3p.size,
      sync: (report?.cookieSyncs || []).length + (report?.bounces || []).length,
      terceiros: otherBases.size,
      storage3p: frames.filter(frame => frame.thirdParty && hasStorage(frame)).length,
      parametros: (report?.trackingParameters || []).length
    };
  }

  function computeScore(report) {
    const counts = occurrences(report);
    const criterios = CRITERIOS.map(criterio => ({
      ...criterio,
      ocorrencias: counts[criterio.id],
      penalidade: Math.min(criterio.peso * counts[criterio.id], criterio.teto)
    }));
    const score = Math.max(0, 100 - criterios.reduce((sum, c) => sum + c.penalidade, 0));
    const nota = NOTAS.find(([minimo]) => score >= minimo)[1];
    return { score, nota, criterios };
  }

  return { CRITERIOS, computeScore, hijackIndicators };
})();
