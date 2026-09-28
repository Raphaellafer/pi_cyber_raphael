/* Textos vindos de páginas são inseridos somente com textContent. */
"use strict";

const element = id => document.getElementById(id);

function cell(row, value) {
  const result = document.createElement("td");
  result.textContent = String(value);
  row.append(result);
  return result;
}

function renderThirdParties(report, trackerStatus) {
  const entries = Object.values(report?.thirdParties || {})
    .sort((a, b) => b.requests - a.requests || a.domain.localeCompare(b.domain));
  element("third-count").textContent = entries.length;
  element("tracker-count").textContent = trackerStatus === "ready"
    ? entries.filter(entry => entry.knownTracker).length : "—";
  element("cookie-count").textContent = report?.cookies?.length || 0;
  element("third-empty").hidden = entries.length > 0;
  element("third-table").hidden = entries.length === 0;
  const body = element("third-body");
  body.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("tr");
    const domain = cell(row, entry.domain);
    const types = document.createElement("small");
    types.textContent = Object.entries(entry.types)
      .map(([type, count]) => `${type}: ${count}`).join(" · ");
    domain.append(types);
    cell(row, entry.requests);
    const known = cell(row, trackerStatus === "ready"
      ? (entry.knownTracker ? "Sim" : "Não listado") : "—");
    if (entry.knownTracker) known.className = "tracker";
    body.append(row);
  }
}

function renderCookies(report) {
  const cookies = report?.cookies || [];
  const groups = {
    "1ª|sessão": "first-session",
    "1ª|persistente": "first-persistent",
    "3ª|sessão": "third-session",
    "3ª|persistente": "third-persistent"
  };
  for (const id of Object.values(groups)) element(id).textContent = "0";
  for (const cookie of cookies) {
    const id = groups[`${cookie.parte}|${cookie.tipo}`];
    if (id) element(id).textContent = Number(element(id).textContent) + 1;
  }
  element("cookie-empty").hidden = cookies.length > 0;
  element("cookie-table").hidden = cookies.length === 0;
  const body = element("cookie-body");
  body.replaceChildren();
  for (const cookie of cookies) {
    const row = document.createElement("tr");
    cell(row, cookie.nome);
    cell(row, cookie.dominio);
    cell(row, cookie.parte);
    cell(row, cookie.tipo);
    cell(row, cookie.origem);
    body.append(row);
  }
}

function renderSample(table, phase, sample) {
  const row = document.createElement("tr");
  cell(row, phase === "load" ? "Load" : "+3 s");
  cell(row, sample.localStorage.items ?? "—");
  cell(row, sample.sessionStorage.items ?? "—");
  cell(row, sample.indexedDB.databases ?? "—");
  cell(row, sample.indexedDB.hooksAvailable
    ? `${sample.indexedDB.calls.open} / ${sample.indexedDB.calls.deleteDatabase}` : "—");
  table.append(row);
}

function renderStorage(report) {
  const frames = Object.values(report?.frames || {}).sort((a, b) => a.frameId - b.frameId);
  element("storage-empty").hidden = frames.some(frame => Object.keys(frame.samples).length);
  const container = element("storage-frames");
  container.replaceChildren();
  for (const frame of frames) {
    const section = document.createElement("div");
    section.className = "frame";
    const title = document.createElement("h3");
    title.textContent = `Frame ${frame.frameId} · ${frame.thirdParty ? "3ª parte" : "1ª parte"} · ${frame.url}`;
    section.append(title);
    const table = document.createElement("table");
    const header = document.createElement("tr");
    for (const label of ["Amostra", "Local: itens", "Sessão: itens", "IDB: bancos", "IDB: abrir / excluir"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      header.append(th);
    }
    table.append(header);
    for (const phase of ["load", "after3s"]) {
      if (frame.samples[phase]) renderSample(table, phase, frame.samples[phase]);
    }
    section.append(table);
    container.append(section);
  }
}

function renderAlertList(id, messages) {
  const list = element(id);
  list.replaceChildren();
  if (!messages.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "Nenhum alerta.";
    list.append(item);
    return;
  }
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
}

function renderAlerts(report) {
  const canvas = (report?.canvasFingerprints || []).map(alert =>
    `Frame ${alert.frameId}: ${alert.api}, script ${alert.script}`);
  const bounces = (report?.bounces || []).map(bounce =>
    `${bounce.dominio} · gravidade ${bounce.gravidade}${bounce.enviouCookie ? " · enviou cookie" : ""} · cadeia ${bounce.cadeia.join(" → ")}`);
  const syncs = (report?.cookieSyncs || []).map(sync =>
    `${sync.de} → ${sync.para}, parâmetro ${sync.parametro}`);
  const parameters = (report?.trackingParameters || []).map(name => `Parâmetro ${name}`);
  renderAlertList("canvas-alerts", canvas);
  renderAlertList("bounce-alerts", bounces);
  renderAlertList("sync-alerts", syncs);
  renderAlertList("parameter-alerts", parameters);
}

async function refresh() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("Aba indisponível");
    const result = await browser.runtime.sendMessage({ type: "getReport", tabId: tab.id });
    const { report, trackerStatus } = result;
    element("page").textContent = report?.url || tab.url || "Aba atual";
    element("status").textContent = !report
      ? "Sem relatório. Abra um site HTTP(S) e recarregue a página."
      : trackerStatus === "error"
        ? "Lista de rastreadores indisponível; terceiros continuam sendo contados."
        : trackerStatus === "loading" ? "Carregando lista local de rastreadores…" : "";
    renderThirdParties(report, trackerStatus);
    renderCookies(report);
    renderStorage(report);
    renderAlerts(report);
  } catch {
    element("status").textContent = "Não foi possível consultar a aba. Reabra o popup ou recarregue a extensão.";
  }
}

element("refresh").addEventListener("click", refresh);
void refresh();
// Atualiza quando a medição de +3 s chega com o popup aberto.
setInterval(refresh, 1000);
