/* Relatórios ficam somente na memória e são descartados ao fechar a aba. */
"use strict";

const domains = globalThis.PrivacyDomains;
const reports = new Map();
const pendingNavigations = new Map();
const navigationJourneys = new Map();
const replacedReports = new Map();
const requests = new Map();
const privateReportState = new WeakMap();
let trackerDomains = new Set();
let trackerStatus = "loading";
let generation = 0;

function createReport(tabId, url) {
  const report = {
    tabId, url, generation: ++generation, startedAt: Date.now(),
    thirdParties: Object.create(null), cookies: [], frames: Object.create(null),
    canvasFingerprints: [], bounces: [], cookieSyncs: [], trackingParameters: []
  };
  // Valores de cookies nunca fazem parte do relatório devolvido ao popup.
  privateReportState.set(report, { cookieSecrets: [], cookieSyncKeys: new Set() });
  return report;
}

function reportState(report) {
  return privateReportState.get(report);
}

function ensureReport(tabId, url) {
  if (!reports.has(tabId)) reports.set(tabId, createReport(tabId, url || ""));
  return reports.get(tabId);
}

function appendUnique(list, value) {
  if (!value || list[list.length - 1] === value) return;
  list.push(value);
}

function ensurePendingNavigation(details) {
  let pending = pendingNavigations.get(details.tabId);
  if (!pending || pending.requestId !== details.requestId) {
    pending = {
      requestId: details.requestId,
      report: createReport(details.tabId, details.url),
      chain: [details.url]
    };
    pendingNavigations.set(details.tabId, pending);
  }
  appendUnique(pending.chain, details.url);
  pending.report.url = details.url;
  return pending;
}

function isThirdPartyRequest(report, url) {
  return domains.isThirdParty(url, report.url);
}

function detectCookieSync(report, requestUrl) {
  if (!isThirdPartyRequest(report, requestUrl)) return;
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return;
  }
  const destination = domains.baseDomain(url.hostname);
  const state = reportState(report);
  for (const [parameter, parameterValue] of url.searchParams) {
    for (const cookie of state.cookieSecrets) {
      if (cookie.value.length < 8 || cookie.baseDomain === destination ||
          !parameterValue.includes(cookie.value)) continue;
      const key = `${cookie.baseDomain}|${destination}|${parameter}`;
      if (state.cookieSyncKeys.has(key)) continue;
      state.cookieSyncKeys.add(key);
      report.cookieSyncs.push({ de: cookie.baseDomain, para: destination, parametro: parameter });
    }
  }
}

function recordThirdParty(report, details) {
  if (!isThirdPartyRequest(report, details.url)) return;
  const host = domains.hostname(details.url);
  const entry = report.thirdParties[host] ||= {
    domain: host, baseDomain: domains.baseDomain(host), requests: 0,
    types: Object.create(null), knownTracker: domains.isTracker(host, trackerDomains)
  };
  entry.requests += 1;
  entry.types[details.type] = (entry.types[details.type] || 0) + 1;
  detectCookieSync(report, details.url);
}

function onBeforeRequest(details) {
  if (details.tabId < 0) return;
  let report;
  if (details.type === "main_frame") {
    report = ensurePendingNavigation(details).report;
  } else {
    report = ensureReport(details.tabId, details.frameId === 0 ? details.documentUrl : "");
    recordThirdParty(report, details);
  }
  // A referência impede respostas atrasadas de contaminarem outra navegação.
  requests.set(details.requestId, { tabId: details.tabId, report });
}

function parseCookie(rawCookie, responseUrl, pageUrl, origem) {
  if (typeof rawCookie !== "string" || !rawCookie.trim()) return null;
  const parts = rawCookie.split(";");
  const separator = parts[0].indexOf("=");
  if (separator <= 0) return null;
  const nome = parts[0].slice(0, separator).trim();
  let value = parts[0].slice(separator + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  let dominio = domains.hostname(responseUrl);
  let persistent = false;
  for (const attribute of parts.slice(1)) {
    const attributeSeparator = attribute.indexOf("=");
    const key = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator))
      .trim().toLowerCase();
    const attributeValue = attributeSeparator < 0 ? "" : attribute.slice(attributeSeparator + 1).trim();
    if (key === "domain" && attributeValue) {
      dominio = attributeValue.replace(/^\./, "").toLowerCase().replace(/\.$/, "");
    }
    if (key === "expires" || key === "max-age") persistent = true;
  }
  if (!nome || !dominio) return null;
  const cookieBase = domains.baseDomain(dominio);
  return {
    publicRecord: {
      nome, dominio,
      parte: cookieBase === domains.baseDomain(pageUrl) ? "1ª" : "3ª",
      tipo: persistent ? "persistente" : "sessão",
      origem
    },
    secret: { value, baseDomain: cookieBase }
  };
}

function recordCookie(report, rawCookie, responseUrl, origem) {
  const parsed = parseCookie(rawCookie, responseUrl, report.url, origem);
  if (!parsed) return;
  report.cookies.push(parsed.publicRecord);
  if (parsed.secret.value.length >= 8) reportState(report).cookieSecrets.push(parsed.secret);
  const journey = reportState(report).journey;
  if (!journey || journey.cookieDomains.has(parsed.secret.baseDomain)) return;
  journey.cookieDomains.add(parsed.secret.baseDomain);
  // O cookie pode chegar depois que a próxima etapa já foi confirmada.
  const current = reports.get(report.tabId);
  const currentJourney = navigationJourneys.get(report.tabId);
  if (current && currentJourney) {
    current.bounces = detectBounces(currentJourney);
    console.debug("[bounce] cookie de", parsed.secret.baseDomain, "(" + parsed.publicRecord.origem + ")",
      "→ bounces:", current.bounces);
  }
}

function onHeadersReceived(details) {
  const request = requests.get(details.requestId);
  if (!request) return;
  for (const header of details.responseHeaders || []) {
    if (header.name.toLowerCase() !== "set-cookie") continue;
    // Firefox pode representar vários Set-Cookie separados por quebras de linha.
    const cookies = typeof header.value === "string"
      ? header.value.split(/\r?\n/).filter(line => line.trim()) : [];
    for (const cookie of cookies) recordCookie(request.report, cookie, details.url, "header");
  }
}

function onBeforeRedirect(details) {
  if (details.tabId < 0) return;
  const pending = ensurePendingNavigation(details);
  appendUnique(pending.chain, details.redirectUrl);
}

function copyNavigationData(source, target) {
  target.cookies = source.cookies.slice();
  target.cookieSyncs = source.cookieSyncs.slice();
  target.canvasFingerprints = source.canvasFingerprints.slice();
  const sourceState = reportState(source);
  const targetState = reportState(target);
  targetState.cookieSecrets = sourceState.cookieSecrets.slice();
  targetState.cookieSyncKeys = new Set(sourceState.cookieSyncKeys);
}

function reclassifyCookies(report) {
  const pageBase = domains.baseDomain(report.url);
  for (const cookie of report.cookies) {
    cookie.parte = domains.baseDomain(cookie.dominio) === pageBase ? "1ª" : "3ª";
  }
}

function detectTrackingParameters(urlValue) {
  try {
    const found = new Set();
    for (const name of new URL(urlValue).searchParams.keys()) {
      const normalized = name.toLowerCase();
      if (normalized.startsWith("utm_") ||
          ["gclid", "fbclid", "msclkid", "dclid", "mc_eid", "_hsenc", "igshid"].includes(normalized)) {
        found.add(name);
      }
    }
    return [...found];
  } catch {
    return [];
  }
}

function cookieDomains(report) {
  return new Set(report.cookies.map(cookie => domains.baseDomain(cookie.dominio)));
}

// Firefox nem sempre marca location.href como client_redirect; uma página que
// sai em menos desse tempo após o commit é tratada como etapa de redirecionamento.
const REDIRECT_CONTINUATION_MS = 5000;

function buildJourney(details, pending, report) {
  const currentChain = pending ? pending.chain.slice() : [details.url];
  appendUnique(currentChain, details.url);
  const isClientRedirect = (details.transitionQualifiers || []).includes("client_redirect");
  const previous = navigationJourneys.get(details.tabId);
  const isContinuation = Boolean(previous) &&
    (isClientRedirect || Date.now() - previous.committedAt < REDIRECT_CONTINUATION_MS);
  let chain;
  if (isContinuation) {
    chain = previous.chain.slice();
  } else {
    // A página onde o usuário clicou é a origem da cadeia.
    const originUrl = reports.get(details.tabId)?.url;
    chain = originUrl ? [originUrl] : [];
  }
  for (const url of currentChain) appendUnique(chain, url);
  // Na continuação o Set é compartilhado: cookies gravados por JS que cheguem
  // depois do commit seguinte ainda contam para a jornada atual.
  const cookies = isContinuation ? previous.cookieDomains : new Set();
  for (const domain of cookieDomains(report)) cookies.add(domain);
  return { chain, cookieDomains: cookies, committedAt: Date.now(), isContinuation };
}

function detectBounces(journey) {
  const bases = journey.chain.map(url => domains.baseDomain(url)).filter(Boolean);
  if (bases.length < 3) return [];
  const origin = bases[0];
  const destination = bases[bases.length - 1];
  const found = new Set();
  const bounces = [];
  for (const domain of bases.slice(1, -1)) {
    if (domain === origin || domain === destination || found.has(domain)) continue;
    found.add(domain);
    bounces.push({
      dominio: domain,
      gravidade: journey.cookieDomains.has(domain) ? "maior" : "normal",
      enviouCookie: journey.cookieDomains.has(domain),
      cadeia: bases
    });
  }
  return bounces;
}

function onCommitted(details) {
  if (details.frameId !== 0) {
    const report = reports.get(details.tabId);
    if (report) delete report.frames[details.frameId];
    return;
  }
  const pending = pendingNavigations.get(details.tabId);
  const report = createReport(details.tabId, details.url);
  if (pending) {
    copyNavigationData(pending.report, report);
    const request = requests.get(pending.requestId);
    if (request) request.report = report;
  }
  reclassifyCookies(report);
  report.trackingParameters = detectTrackingParameters(details.url);
  const journey = buildJourney(details, pending, report);
  report.bounces = detectBounces(journey);
  reportState(report).journey = journey;
  console.debug("[bounce] aba", details.tabId, "continuação:", journey.isContinuation,
    "qualifiers:", details.transitionQualifiers, "cadeia:", journey.chain,
    "cookies:", [...journey.cookieDomains], "bounces:", report.bounces);
  const replaced = reports.get(details.tabId);
  if (replaced) replacedReports.set(details.tabId, replaced);
  navigationJourneys.set(details.tabId, journey);
  reports.set(details.tabId, report);
  pendingNavigations.delete(details.tabId);
}

function finishRequest(details) {
  requests.delete(details.requestId);
}

function onRequestError(details) {
  finishRequest(details);
  if (pendingNavigations.get(details.tabId)?.requestId === details.requestId) {
    pendingNavigations.delete(details.tabId);
  }
}

function registerFrame(report, sender) {
  const token = `${report.generation}:${++generation}`;
  report.frames[sender.frameId] = {
    frameId: sender.frameId, url: sender.url, token,
    thirdParty: domains.isThirdParty(sender.url, report.url), samples: {}
  };
  return { token };
}

function recordCanvasCall(report, frame, message) {
  frame.canvasCalls ||= [];
  frame.canvasCalls.push({
    api: message.api,
    script: message.script || "Origem desconhecida"
  });
  if (message.api === "fillText") {
    frame.canvasDrawn = true;
    return;
  }
  if (!frame.canvasDrawn || !["toDataURL", "toBlob", "getImageData"].includes(message.api)) return;
  const key = `${frame.frameId}|${message.api}|${message.script}`;
  if (report.canvasFingerprints.some(alert => alert.key === key)) return;
  report.canvasFingerprints.push({
    key, frameId: frame.frameId, api: message.api,
    script: message.script || "Origem desconhecida"
  });
}

function onMessage(message, sender) {
  if (sender.id !== browser.runtime.id || !message) return undefined;
  if (message.type === "getReport" && !sender.tab) {
    return Promise.resolve({ report: reports.get(message.tabId) || null, trackerStatus });
  }
  if (!sender.tab || sender.tab.id < 0) return undefined;
  let report = ensureReport(sender.tab.id, sender.tab.url);
  if (message.type === "registerFrame") return Promise.resolve(registerFrame(report, sender));
  let frame = report.frames[sender.frameId];
  if ((!frame || frame.token !== message.token) && message.type === "jsCookie") {
    // A página de bounce grava o cookie e sai logo; a mensagem pode chegar
    // depois que o destino já substituiu o relatório da aba.
    const replaced = replacedReports.get(sender.tab.id);
    const replacedFrame = replaced?.frames[sender.frameId];
    if (replacedFrame && replacedFrame.token === message.token) {
      report = replaced;
      frame = replacedFrame;
    }
  }
  if (!frame || frame.token !== message.token) return undefined;
  if (message.type === "storageSnapshot" && ["load", "after3s"].includes(message.phase)) {
    // Cada amostra substitui sua fase; não somamos o mesmo estoque duas vezes.
    frame.samples[message.phase] = message.snapshot;
  } else if (message.type === "jsCookie" && typeof message.cookie === "string") {
    recordCookie(report, message.cookie, sender.url, "js");
  } else if (message.type === "canvasCall") {
    recordCanvasCall(report, frame, message);
  }
  return undefined;
}

async function loadTrackers() {
  try {
    const response = await fetch(browser.runtime.getURL("lib/trackers.json"));
    if (!response.ok) throw new Error("Lista indisponível");
    const data = await response.json();
    trackerDomains = new Set(data.domains);
    trackerStatus = "ready";
    for (const report of reports.values()) {
      for (const entry of Object.values(report.thirdParties)) {
        entry.knownTracker = domains.isTracker(entry.domain, trackerDomains);
      }
    }
  } catch {
    trackerStatus = "error";
  }
}

browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ["<all_urls>"] });
browser.webRequest.onHeadersReceived.addListener(onHeadersReceived, { urls: ["<all_urls>"] }, ["responseHeaders"]);
browser.webRequest.onBeforeRedirect.addListener(onBeforeRedirect, { urls: ["<all_urls>"], types: ["main_frame"] });
browser.webRequest.onCompleted.addListener(finishRequest, { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener(onRequestError, { urls: ["<all_urls>"] });
browser.webNavigation.onCommitted.addListener(onCommitted);
browser.runtime.onMessage.addListener(onMessage);
browser.tabs.onRemoved.addListener(tabId => {
  reports.delete(tabId);
  pendingNavigations.delete(tabId);
  navigationJourneys.delete(tabId);
  replacedReports.delete(tabId);
  for (const [id, request] of requests) if (request.tabId === tabId) requests.delete(id);
});
loadTrackers();
