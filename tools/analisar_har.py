#!/usr/bin/env python3
"""Resume um arquivo HAR em Markdown para o relatório.

Uso:
    python tools/analisar_har.py evidencias/nike/nike.har https://www.nike.com.br > evidencias/nike/har-resumo.md

Usa a mesma regra de domínio base de lib/domains.js e a mesma lista de
rastreadores (lib/trackers.json), para o resultado ser comparável ao plugin.
Só biblioteca padrão.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

SUFIXOS = {"com", "com.br", "edu.br", "gov.br", "org.br", "net.br"}
PARAMETROS_RASTREIO = {"gclid", "fbclid", "msclkid", "dclid", "mc_eid", "_hsenc", "igshid"}
RAIZ = Path(__file__).resolve().parent.parent


def hostname(url):
    try:
        parts = urlsplit(url if "://" in url else f"https://{url}")
    except ValueError:
        return ""
    if parts.scheme not in {"http", "https", "ws", "wss"}:
        return ""
    return (parts.hostname or "").lower().rstrip(".")


def base_domain(value):
    """Mesma simplificação de lib/domains.js: sufixos brasileiros de duas partes."""
    host = hostname(value)
    if not host or ":" in host or all(p.isdigit() for p in host.split(".")):
        return host
    labels = host.split(".")
    partes = 3 if ".".join(labels[-2:]) in SUFIXOS else 2
    return ".".join(labels[-min(partes, len(labels)):])


def is_tracker(host, trackers):
    """Compara por fronteira de rótulo: eviltracker.com não casa com tracker.com."""
    labels = host.split(".")
    while labels:
        if ".".join(labels) in trackers:
            return True
        labels.pop(0)
    return False


def resource_type(entry):
    """O HAR do Firefox não guarda o tipo da requisição; inferimos pelo MIME."""
    if entry.get("_resourceType"):
        return entry["_resourceType"]
    url = entry["request"]["url"]
    if urlsplit(url).scheme in {"ws", "wss"} or entry["response"].get("status") == 101:
        return "websocket"
    # Status 0: a requisição não recebeu resposta (bloqueada pelo navegador ou cancelada).
    if entry["response"].get("status") == 0:
        return "sem resposta (status 0)"
    mime = (entry["response"].get("content", {}).get("mimeType") or "").split(";")[0].lower()
    if "javascript" in mime or "ecmascript" in mime:
        return "script"
    if mime == "text/css":
        return "stylesheet"
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("font/") or "font" in mime:
        return "font"
    if mime == "text/html":
        return "document"
    if "json" in mime or mime in {"text/plain", "application/x-www-form-urlencoded"}:
        return "xhr/fetch"
    if mime.startswith(("video/", "audio/")):
        return "media"
    if entry["request"].get("method") == "POST":
        return "post/beacon"
    return mime or "outro"


def parse_set_cookie(raw, response_url):
    parts = raw.split(";")
    if "=" not in parts[0]:
        return None
    nome, valor = parts[0].split("=", 1)
    dominio = hostname(response_url)
    persistente = False
    for attribute in parts[1:]:
        key, _, value = attribute.strip().partition("=")
        key = key.strip().lower()
        if key == "domain" and value.strip():
            dominio = value.strip().lstrip(".").lower()
        if key in {"expires", "max-age"}:
            persistente = True
    return {"nome": nome.strip(), "valor": valor.strip().strip('"'), "dominio": dominio, "persistente": persistente}


def set_cookies(entry):
    for header in entry["response"].get("headers", []):
        if header.get("name", "").lower() != "set-cookie":
            continue
        for line in str(header.get("value", "")).splitlines():
            cookie = parse_set_cookie(line, entry["request"]["url"])
            if cookie:
                yield cookie


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    har_path, site_url = sys.argv[1], sys.argv[2]
    with open(har_path, encoding="utf-8") as file:
        entries = json.load(file)["log"]["entries"]
    with open(RAIZ / "lib" / "trackers.json", encoding="utf-8") as file:
        trackers = set(json.load(file)["domains"])

    site_base = base_domain(site_url)
    entries.sort(key=lambda e: e.get("startedDateTime", ""))
    inicio = entries[0]["startedDateTime"] if entries else ""

    terceiros = defaultdict(lambda: {"req": 0, "tipos": defaultdict(int), "primeira": None})
    cookies_3p = {}
    cookies_1p = {}
    segredos = []
    websockets = defaultdict(int)
    parametros = set()

    for entry in entries:
        url = entry["request"]["url"]
        host = hostname(url)
        if not host:
            continue
        base = base_domain(url)
        tipo = resource_type(entry)
        for name, _ in parse_qsl(urlsplit(url).query, keep_blank_values=True):
            if tipo == "document" and base == site_base and (
                    name.lower().startswith("utm_") or name.lower() in PARAMETROS_RASTREIO):
                parametros.add(name)
        for cookie in set_cookies(entry):
            chave = (cookie["nome"], cookie["dominio"])
            destino = cookies_1p if base_domain(cookie["dominio"]) == site_base else cookies_3p
            destino[chave] = cookie
            # Valores só numéricos costumam ser timestamps e casam com qualquer parâmetro de tempo.
            if len(cookie["valor"]) >= 8 and not cookie["valor"].isdigit():
                segredos.append(cookie)
        if base == site_base:
            continue
        info = terceiros[host]
        info["base"] = base
        info["req"] += 1
        info["tipos"][tipo] += 1
        info["primeira"] = info["primeira"] or entry.get("startedDateTime", "")
        if tipo == "websocket":
            websockets[host] += 1

    # Cookie sync: valor de cookie (8+ caracteres) aparecendo num parâmetro enviado a outro domínio.
    syncs = set()
    for entry in entries:
        url = entry["request"]["url"]
        destino = base_domain(url)
        if destino == site_base:
            continue
        for parametro, valor in parse_qsl(urlsplit(url).query, keep_blank_values=True):
            for cookie in segredos:
                origem = base_domain(cookie["dominio"])
                if origem != destino and cookie["valor"] in valor:
                    syncs.add((origem, destino, parametro))

    def tempo(iso):
        return iso[11:23] if iso else "—"

    linhas = []
    add = linhas.append
    add(f"## Resumo do HAR: {site_url}\n")
    add(f"- Arquivo: `{har_path}`")
    add(f"- Requisições no HAR: {len(entries)} (primeira em {inicio})")
    rastreadores = [h for h in terceiros if is_tracker(h, trackers)]
    bases_terceiras = {info["base"] for info in terceiros.values()}
    add(f"- Hosts de terceiros: {len(terceiros)} ({len(bases_terceiras)} domínios base)")
    add(f"- Hosts na lista Disconnect: {len(rastreadores)}")
    add(f"- Cookies via Set-Cookie: {len(cookies_1p)} de 1ª parte, {len(cookies_3p)} de 3ª parte")
    add(f"- WebSockets para terceiros: {sum(websockets.values())}")
    add(f"- Possíveis cookie syncs: {len(syncs)}")
    add(f"- Parâmetros de rastreio na URL da página: {', '.join(sorted(parametros)) or 'nenhum'}\n")

    add("### Terceiros\n")
    add("| Host | Domínio base | Req. | Tipos | Disconnect | 1ª requisição (horário do HAR) |")
    add("| --- | --- | --- | --- | --- | --- |")
    for host, info in sorted(terceiros.items(), key=lambda item: (-item[1]["req"], item[0])):
        tipos = ", ".join(f"{t}: {n}" for t, n in sorted(info["tipos"].items()))
        add(f"| {host} | {info['base']} | {info['req']} | {tipos} | "
            f"{'Sim' if is_tracker(host, trackers) else 'Não'} | {tempo(info['primeira'])} |")

    add("\n### Cookies de 3ª parte via Set-Cookie\n")
    if cookies_3p:
        add("| Nome | Domínio | Tipo |")
        add("| --- | --- | --- |")
        for (nome, dominio), cookie in sorted(cookies_3p.items()):
            add(f"| {nome} | {dominio} | {'persistente' if cookie['persistente'] else 'sessão'} |")
    else:
        add("Nenhum.")

    add("\n### WebSockets para terceiros\n")
    add("\n".join(f"- {host} ({n}×)" for host, n in sorted(websockets.items())) or "Nenhum.")

    add("\n### Possíveis cookie syncs\n")
    add("\n".join(f"- {o} → {d}, parâmetro `{p}`" for o, d, p in sorted(syncs)) or "Nenhum.")

    add("\nObservação: o HAR só contém cookies de headers `Set-Cookie`; cookies criados por "
        "`document.cookie` e requisições bloqueadas antes de sair do navegador não aparecem aqui.")
    sys.stdout.reconfigure(encoding="utf-8")
    print("\n".join(linhas))


if __name__ == "__main__":
    main()
