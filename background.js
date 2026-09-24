/* Relatórios ficam somente na memória e são descartados ao fechar a aba. */
"use strict";

const domains = globalThis.PrivacyDomains;
const reports = new Map();
const pendingNavigations = new Map();
const requests = new Map();
let trackerDomains = new Set();
let trackerStatus = "loading";
let generation = 0;

function createReport(tabId, url) {
  return {
    tabId, url, generation: ++generation, startedAt: Date.now(),
    thirdParties: Object.create(null), cookiesReceived: 0, frames: Object.create(null)
  };
}

function ensureReport(tabId, url) {
  if (!reports.has(tabId)) reports.set(tabId, createReport(tabId, url || ""));
  return reports.get(tabId);
}

function recordThirdParty(report, details) {
  if (!domains.isThirdParty(details.url, report.url)) return;
  const host = domains.hostname(details.url);
  const entry = report.thirdParties[host] ||= {
    domain: host, baseDomain: domains.baseDomain(host), requests: 0,
    types: Object.create(null), knownTracker: domains.isTracker(host, trackerDomains)
  };
  entry.requests += 1;
  entry.types[details.type] = (entry.types[details.type] || 0) + 1;
}

function onBeforeRequest(details) {
  if (details.tabId < 0) return;
  let report;
  if (details.type === "main_frame") {
    let pending = pendingNavigations.get(details.tabId);
    if (!pending || pending.requestId !== details.requestId) {
      pending = { requestId: details.requestId, report: createReport(details.tabId, details.url) };
      pendingNavigations.set(details.tabId, pending);
    }
    report = pending.report;
    report.url = details.url;
  } else {
    report = ensureReport(details.tabId, details.frameId === 0 ? details.documentUrl : "");
    recordThirdParty(report, details);
  }
  // A referência impede respostas atrasadas de contaminarem outra navegação.
  requests.set(details.requestId, { tabId: details.tabId, report });
}

function onHeadersReceived(details) {
  const request = requests.get(details.requestId);
  if (!request) return;
  for (const header of details.responseHeaders || []) {
    if (header.name.toLowerCase() !== "set-cookie") continue;
    // Firefox pode representar vários Set-Cookie separados por quebras de linha.
    request.report.cookiesReceived += typeof header.value === "string"
      ? header.value.split(/\r?\n/).filter(line => line.trim()).length : 1;
  }
}

function onCommitted(details) {
  if (details.frameId !== 0) {
    const report = reports.get(details.tabId);
    if (report) delete report.frames[details.frameId];
    return;
  }
  const pending = pendingNavigations.get(details.tabId);
  const report = createReport(details.tabId, details.url);
  // Headers do documento chegam antes do commit; preserva apenas os da navegação nova.
  if (pending && pending.report.url.split("#")[0] === details.url.split("#")[0]) {
    report.cookiesReceived = pending.report.cookiesReceived;
    const request = requests.get(pending.requestId);
    if (request) request.report = report;
  }
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

function onMessage(message, sender) {
  if (sender.id !== browser.runtime.id || !message) return undefined;
  if (message.type === "getReport" && !sender.tab) {
    return Promise.resolve({ report: reports.get(message.tabId) || null, trackerStatus });
  }
  if (!sender.tab || sender.tab.id < 0) return undefined;
  const report = ensureReport(sender.tab.id, sender.tab.url);
  if (message.type === "registerFrame") {
    const token = `${report.generation}:${++generation}`;
    report.frames[sender.frameId] = {
      frameId: sender.frameId, url: sender.url, token,
      thirdParty: domains.isThirdParty(sender.origin || sender.url, report.url), samples: {}
    };
    return Promise.resolve({ token });
  }
  const frame = report.frames[sender.frameId];
  if (message.type === "storageSnapshot" && frame?.token === message.token &&
      ["load", "after3s"].includes(message.phase)) {
    // Cada amostra substitui sua fase; não somamos o mesmo estoque duas vezes.
    frame.samples[message.phase] = message.snapshot;
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
browser.webRequest.onCompleted.addListener(finishRequest, { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener(onRequestError, { urls: ["<all_urls>"] });
browser.webNavigation.onCommitted.addListener(onCommitted);
browser.runtime.onMessage.addListener(onMessage);
browser.tabs.onRemoved.addListener(tabId => {
  reports.delete(tabId);
  pendingNavigations.delete(tabId);
  for (const [id, request] of requests) if (request.tabId === tabId) requests.delete(id);
});
loadTrackers();
