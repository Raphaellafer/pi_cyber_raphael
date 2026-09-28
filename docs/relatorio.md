# Relatório: plugin "Análise de Raphael" para detecção de rastreadores no Firefox

**Aluno:** Raphael Cimerman Lafer

**Repositório:** https://github.com/Raphaellafer/pi_cyber_raphael

---

## 1. Introdução e arquitetura

### 1.1 Objetivo

O "Análise de Raphael" é uma extensão para Firefox que observa, por aba, o que uma página faz com a privacidade do usuário. Ela detecta:

- conexões a domínios de terceira parte e quais deles são rastreadores conhecidos;
- cookies gravados no carregamento, separados em 1ª/3ª parte e sessão/persistente;
- uso de armazenamento HTML5 (localStorage, sessionStorage e IndexedDB);
- sincronismo de cookies (cookie sync) e bounce tracking;
- canvas fingerprint;
- indicadores de sequestro de navegador (hijacking e hook);
- parâmetros de rastreio na URL (`utm_*`, `gclid`, `fbclid` etc.).

Com esses dados, a extensão calcula um score de privacidade de 0 a 100 e permite bloquear domínios de uma lista pessoal.

### 1.2 Instalação

1. Abrir `about:debugging#/runtime/this-firefox`.
2. Clicar em **Carregar extensão temporária…** e selecionar o `manifest.json` do repositório.
3. Abrir um site e clicar no ícone da extensão.

A extensão é Manifest V2, sem build nem dependências externas: todo o código é JavaScript puro.

### 1.3 Arquitetura

| Componente | Arquivo | Papel |
| --- | --- | --- |
| Background | `background.js` | Mantém um relatório por aba, reiniciado a cada navegação principal (`webNavigation.onCommitted`). Observa todas as requisições com `webRequest`, lê os headers `Set-Cookie`, monta a cadeia de redirecionamentos para detectar bounce, detecta cookie sync, WebSocket e polling, e cancela as requisições da lista de bloqueio. |
| Content script | `content.js` | Roda em todos os frames desde `document_start`, antes de qualquer script da página. Instala hooks em IndexedDB, canvas e no setter de `document.cookie`, mede o storage HTML5 no `load` e 3 s depois, e compara as APIs globais nativas 2 s e 10 s depois do `load`. |
| Domínios | `lib/domains.js` | Calcula o domínio base (eTLD+1) e decide se um recurso é de terceira parte. |
| Lista de rastreadores | `lib/trackers.json` | 4.454 domínios da lista Disconnect Tracking Protection (CC BY-NC-SA 4.0). |
| Score | `lib/score.js` | Calcula o score e lista os indicadores de hijacking. |
| Interface | `popup/` | Mostra o relatório da aba em abas: Rastreadores, Cookies, Storage, Alertas, Score e Minha lista. O ícone da extensão mostra o número de rastreadores conhecidos. |

Os hooks do content script são instalados com `window.wrappedJSObject` e `exportFunction`, sem injetar `<script>` na página, para funcionar mesmo em sites com Content Security Policy restritiva. Os valores de cookies ficam só na memória do background, usados para detectar cookie sync, e nunca chegam ao popup.

### 1.4 Como cada detecção funciona

| Detecção | Técnica |
| --- | --- |
| Terceiros | `webRequest.onBeforeRequest`: todo recurso cujo domínio base difere do da página. |
| Rastreador conhecido | Hostname do terceiro comparado à lista Disconnect, respeitando a fronteira de rótulo (`eviltracker.com` não casa com `tracker.com`). |
| Cookies | Header `Set-Cookie` (`webRequest.onHeadersReceived`) e setter de `document.cookie`. 3ª parte = domínio do cookie diferente do da página; persistente = tem `Expires` ou `Max-Age`. |
| Storage HTML5 | Contagem de itens de `localStorage`/`sessionStorage` e de bancos (`indexedDB.databases()`), por frame, no `load` e 3 s depois, mais chamadas a `indexedDB.open`/`deleteDatabase`. |
| Cookie sync | Valor de cookie (8+ caracteres) aparecendo num parâmetro de URL enviado a outro domínio. |
| Bounce tracking | Cadeia de navegação montada com redirects de servidor (`onBeforeRedirect`) e de cliente (`client_redirect` ou página que sai em menos de 5 s). Domínio intermediário diferente da origem e do destino é bounce; se esse domínio tem cookie no navegador, a gravidade é "maior". |
| Canvas fingerprint | Leitura do canvas (`toDataURL`, `toBlob`, `getImageData`) depois de desenhar texto (`fillText`) no mesmo frame. |
| Hijacking/hook | WebSocket para terceiro; polling (mesma URL de terceiro 5+ vezes em 30 s); substituição de `fetch`, `XMLHttpRequest.open/send`, `WebSocket`, `addEventListener`, `document.write`, `sendBeacon` ou `window.open`; assinaturas do BeEF (`hook.js`, cookie `BEEFHOOK`, global `beef`). |
| Bloqueio | `webRequest.onBeforeRequest` com `blocking` devolve `{cancel: true}` para requisições de terceiros cujo domínio base está na lista pessoal. |

### 1.5 Ambiente dos testes

- Firefox 156.0.1, Windows 11.
- Proteção aprimorada contra rastreamento: **Padrão**.
- Testes do DuckDuckGo e dos sites reais em **janela privada** limpa, com a extensão carregada e a lista de bloqueio vazia (exceto no teste de Tracker Blocking).
- Banner de cookies dos sites reais: **nem aceito nem rejeitado**, para comparar os três sites na mesma condição.

---

## 2. DuckDuckGo Privacy Test Pages

Páginas em https://privacy-test-pages.site/. Prints em `evidencias/ddg/`.

| # | Teste | Resultado esperado (da página) | Resultado do plugin | Divergência e explicação técnica | Print |
| --- | --- | --- | --- | --- | --- |
| 1 | Tracker Reporting: 1 major tracker via script (`tracker-reporting/1major-via-script.html`) | A página carrega 1 rastreador grande por `<script src>`; a proteção deve reportá-lo. | 1 domínio terceiro, **`doubleclick.net`**, tipo `script: 1`, **Rastreador: Sim**. Score 96 A (−4 por 1 rastreador conhecido). | Sem divergência. O plugin vê a requisição em `webRequest.onBeforeRequest`, antes de qualquer bloqueio, e a classifica pela lista Disconnect. | `tracker-reporting-01-script.png` |
| 2 | Tracker Reporting: 1 major tracker com surrogate (`1major-with-surrogate.html`) | Mesmo rastreador, mas num caso em que proteções como a do DuckDuckGo substituem o script bloqueado por um "surrogate" (versão falsa e inofensiva) para a página não quebrar. | **`doubleclick.net`**, `script: 1`, **Rastreador: Sim**. Score 96 A. | Detecção correta. Divergência de função: o plugin **não fornece surrogates**, porque não bloqueia o script (a não ser que ele esteja na lista pessoal). Mesmo se bloqueasse, a página ficaria sem o substituto. | `tracker-reporting-02-surrogate.png` |
| 3 | Tracker Reporting: via img (`1major-via-img.html`) | 1 rastreador grande carregado como imagem (`<img src>`, típico de pixel de rastreamento). | **`facebook.com`**, tipo `image: 1`, **Rastreador: Sim**. Score 96 A. A imagem aparece quebrada na página. | Detecção correta. A imagem quebrada indica que o **Firefox bloqueou** o pixel (Proteção contra rastreamento, ativa em janela privada). O plugin mesmo assim reporta a tentativa, porque o `onBeforeRequest` dispara antes do bloqueio do navegador. | `tracker-reporting-03-img.png` |
| 4 | Tracker Reporting: via document fragment [Delay 5s] (`document-fragment.html`) | Rastreador criado dinamicamente por JavaScript dentro de um `DocumentFragment` e inserido depois de 5 s, técnica para escapar de detecções que só olham o HTML inicial. | **`facebook.com`**, tipo `image: 1`, **Rastreador: Sim**. Score 96 A. Imagem quebrada. | Detecção correta: o plugin observa a rede, não o HTML, então não importa como ou quando o elemento foi criado. A imagem quebrada de novo indica bloqueio pelo Firefox. | `tracker-reporting-04-fragment.png` |
| 5 | Tracker Reporting: via fetch [Delay 5s] (`1major-via-fetch.html`) | Rastreador chamado por `fetch()` depois de 5 s. A página mostra "Tracker loaded" ou "Tracker not loaded". | **`facebook.com`**, tipo `xmlhttprequest: 1` (tipo que o `webRequest` usa para `fetch`), **Rastreador: Sim**. Score 96 A. A página mostrou **"Tracker not loaded"**. | Detecção correta. "Tracker not loaded" confirma que o **Firefox bloqueou** a requisição; o plugin a reporta porque registra a tentativa antes do bloqueio. Diferença de papel: o Firefox bloqueia, o plugin reporta. | `tracker-reporting-05-fetch.png` |
| 6 | Storage blocking (`storage-blocking/`, botão "Store data") | A página grava um número aleatório ("914") em 23 mecanismos na 1ª parte (cookies por header e por JS, localStorage, sessionStorage, IndexedDB, Cache API, CookieStore, WebSQL, service worker, `window.name` etc.) e em 3 iframes de terceiros: "safe" (`good.third-party.site`), "tracking" (`broken.third-party.site`) e "ad" (`convert.ad-company.site`). Uma proteção deveria bloquear o storage dos iframes de rastreamento e anúncio. Resultado: 22 OK e 1 falha (WebSQL: `openDatabase is not defined`). | Logo após o clique: 23 cookies, 3 domínios terceiros e os **3 iframes de 3ª parte**, cada um com **1 item em localStorage e 1 em sessionStorage**; IndexedDB aberto no safe e no tracking (`1 / 0`), mas não no ad (`0 / 0`). Score 77 B, com −6 por "storage em frame de 3ª parte". Depois de F5: frame 0 (1ª parte) com 1 item em localStorage, 1 em sessionStorage e 1 banco IndexedDB. | **Detectar não é bloquear:** o plugin mostra que os três iframes de terceiros gravaram storage, mas não impede a gravação; a página relata tudo OK nos iframes porque nada bloqueou. **Falha de WebSQL:** o Firefox nunca implementou `openDatabase`, então essa falha vem do navegador. **Iframe de anúncio:** a página registra "IndexedDB – DB is not defined" nele, e o plugin, coerente com isso, não viu abertura de IndexedDB nesse frame (`0 / 0`). **Frame 0 em zero antes do F5:** o plugin mede o storage no `load` e 3 s depois; o clique em "Store data" aconteceu depois dessas medições. Os iframes aparecem porque são criados no clique e têm o próprio `load`. Após F5 os dados persistidos aparecem no frame 0. É uma limitação do método: storage gravado só após interação não entra no relatório até o próximo carregamento. | `storage-blocking-01-pagina.png`, `storage-blocking-02-popup.png`, `storage-blocking-03-popup-frames.png`, `storage-blocking-04-popup-apos-f5.png` |
| 7 | Fingerprinting / canvas (`fingerprinting/canvas.html`) | A página verifica se o navegador tem proteção contra canvas fingerprinting que **embaralha** o canvas ("resistance": mais de 20% dos pixels devem mudar entre leituras do mesmo desenho) sem prejudicar desempenho ("performance") nem a renderização ("correctness"). | 2 alertas de **canvas fingerprint** no frame 0: `getImageData` e `toDataURL`, ambos atribuídos ao script `.../fingerprinting/canvas.js`. Na página: resistance com 2 fail, performance toda pass, correctness com 2 fail ("Output conversion has expected values" e "Generated code should return expected response"). | **Resistance (fail):** esperado, porque o plugin **detecta mas não protege**: ele não adiciona ruído ao canvas, só observa as chamadas. A página espera uma proteção que altere os pixels, e nenhuma estava ativa. **Performance (pass):** os hooks de `getImageData`/`toDataURL`/`fillText` apenas repassam a chamada à função nativa, sem custo perceptível (por exemplo, 100 leituras em 52 ms, com limite de 645,5 ms). **Correctness:** as leituras de pixels conhecidos passaram (18, 18, 255, 255), o que mostra que o plugin não altera os dados; os 2 fail comparam a string exata de `toDataURL` com valores de referência. A causa provável é o codificador PNG e a renderização de texto do Firefox, que geram bytes diferentes das strings de referência produzidas em outros navegadores. | `canvas-01-pagina.png`, `canvas-03-pagina-fim.png`, `canvas-02-popup.png` |
| 8 | Tracker Blocking (`request-blocking/`, "Start the test"), em duas rodadas: sem e com `third-party.site` na lista de bloqueio | A página faz 23 requisições para `bad.third-party.site` por mecanismos diferentes (HTML: script, style, img, picture, object, audio, video, iframe; CSS: import, font, background; JS: WebSocket, EventSource, fetch, XHR, sendBeacon; outros: favicon, fetch em iframe e iframe aninhado, WebWorker, ServiceWorker, relatório CSP, fetch redirecionado). Pede para colocar esse domínio na lista de bloqueio; com bloqueio, todas deveriam falhar. | **Sem bloqueio:** a página marcou 22 "loaded" e 1 "failed" (WebSocket). O plugin listou `bad.third-party.site` com **22 requisições** de 11 tipos (script, stylesheet, object, xmlhttprequest ×7, sub_frame, image ×3, imageset, websocket, beacon, font, csp_report, media ×2), "Não listado" na Disconnect; 2 indicadores de hijacking; score 89 A. **Com `third-party.site` na lista:** **22 requisições bloqueadas** ("Requisições bloqueadas nesta aba: 22"; na linha do domínio, "bloqueadas: 22"). A página marcou **22 de 23 bloqueadas** (10 "not loaded" + 12 "failed") e **1 "loaded": `serviceworker-fetch`**. | **Bloqueio funcionou em 22 de 23 mecanismos**, incluindo WebSocket, sendBeacon, relatório CSP, fetch dentro de iframes e de WebWorker, e o fetch redirecionado (o bloqueio pega a requisição redirecionada porque ela passa de novo pelo `onBeforeRequest`). A diferença entre "not loaded" e "failed" é só de como a página detecta: elementos HTML cancelados nunca disparam `load`, e chamadas JS recebem erro. **`serviceworker-fetch` escapou:** requisições feitas por um Service Worker não pertencem a nenhuma aba, então o Firefox as entrega ao `webRequest` com `tabId = -1`, e o `background.js` ignora requisições sem aba (`if (details.tabId < 0) return`). Correção possível: aplicar a lista também a requisições com `tabId < 0`, usando `originUrl` para decidir se são de terceiro. **"Não listado":** `bad.third-party.site` é um domínio de teste que não consta da lista Disconnect; por isso só a lista pessoal o bloqueia. **WebSocket "failed" já na rodada sem bloqueio:** a conexão falhou por conta do servidor ou do navegador, não do plugin, que nessa rodada só observava. | `request-blocking-01-sem-bloqueio-pagina.png`, `-02-sem-bloqueio-popup.png`, `-03-com-bloqueio-pagina.png`, `-04-com-bloqueio-minha-lista.png`, `-05-com-bloqueio-rastreadores.png`, `request-blocking-results-sem-bloqueio.json`, `request-blocking-results-com-bloqueio.json` |
| 9 | Storage partitioning (`storage-partitioning/`, botão "Run Tests") | A página grava um ID de sessão em 21 mecanismos de armazenamento, no contexto de 1ª parte (`www.first-party.site`, na página e num iframe do mesmo site). Em seguida, uma janela de teste tenta ler esses valores do mesmo domínio embutido em outro site (cross-site). "pass" = o valor **não** vaza entre sites (particionado ou bloqueado); "fail" = vazou. Resultado: 19 pass, WebSQL "unsupported" (conta como pass) e Prefetch Cache "error". | 1 domínio terceiro, **2 cookies de 1ª parte persistentes** (`partition_test` por JS e `partition_test_http` por header `Set-Cookie`), e storage em dois frames do próprio `www.first-party.site`: o iframe `iframe.html?mode=store` e o recurso `partitioning/resource`, cada um com 1 item em localStorage, 1 em sessionStorage e 1 banco IndexedDB. Frame 0 com 0 itens. Score 99 A. | **O particionamento é do Firefox, não do plugin.** Os "pass" vêm da Proteção Total de Cookies (TCP/dFPI), que separa cookies, storage e caches de um mesmo domínio por site de topo. O plugin não particiona nada; ele mostra o que foi gravado e por quem, e confirmou que a gravação aconteceu nos contextos esperados (cookie por JS e por header, storage nos frames de gravação). **Frames classificados como 1ª parte:** corretamente, porque o iframe de gravação é do mesmo site da página. A leitura cross-site acontece em outra janela, que tem relatório próprio; o popup mostra só a aba ativa. **Frame 0 com 0 itens:** a gravação ocorreu depois das medições do `load`/+3 s (mesma limitação da linha 6). **Prefetch Cache "error":** o próprio teste da página não conseguiu executar a verificação de prefetch neste navegador; não há relação com o plugin. | `storage-partitioning-01-pagina.png`, `storage-partitioning-02-popup-storage.png`, `storage-partitioning-03-popup-frames.png`, `storage-partitioning-04-popup-cookies.png`, `storage-partitioning-results.json` |
| 10 | Bounce tracking (link "Go to first-party.site", 1ª visita) | `bad.third-party.site` grava o ID `bounceUID` em cookie e localStorage e redireciona com `location.href` para `www.first-party.site`, passando o ID na URL (`?bounceUIDcookie=...&isNew=95`). | Bounce `third-party.site`, gravidade **maior**, "enviou cookie", cadeia `privacy-test-pages.site → third-party.site → first-party.site`. | Sem divergência. Dois pontos técnicos: (1) o Firefox não marcou a navegação por `location.href` como `client_redirect`, então o plugin trata como continuação da cadeia toda página que sai em menos de 5 s; (2) o `bounce.html` redireciona logo depois de gravar o cookie, e a mensagem do hook de `document.cookie` pode se perder junto com a página, por isso o background consulta `browser.cookies.getAll` para o domínio intermediário. Numa visita repetida o `bounce.html` não grava cookie de novo (`if (!lsUID && !cookieUID)`), mas o cookie existente é reenviado, e a consulta mantém a gravidade "maior". | `bounce-01-primeira-visita.png` |
| 11 | Query Parameters (`query-parameters/`, links 1, 3 e 4) | Uma proteção deve remover os parâmetros de rastreio antes de a página de destino carregar. Link 1 (`utm_source=something&q=other`): esperado `"q=other"`. Link 3 (`fbclid=12345&fb_source=someting&u=14`): esperado `"u=14"`. Link 4 (`q=something&id=1234`, "should not be rewritten"): esperado `"q=something&id=1234"`. | Link 1: a página recebeu `"utm_source=something&q=other"`; o plugin alertou **"Parâmetro utm_source"** (score 99 A). Link 3: recebeu `"fbclid=12345&fb_source=someting&u=14"`; o plugin alertou **"Parâmetro fbclid"**, mas não `fb_source`. Link 4: recebeu `"q=something&id=1234"`; o plugin **não alertou nada** (score 100 A). | **Detectar não é remover:** o plugin lista os parâmetros de rastreio da URL da página, mas não reescreve a navegação, então os links 1 e 3 chegaram com os parâmetros. O Firefox em modo Padrão também não os removeu (a remoção de parâmetros de rastreio do Firefox fica no modo Estrito). **`fb_source` não detectado:** a lista do plugin cobre `utm_*`, `gclid`, `fbclid`, `msclkid`, `dclid`, `mc_eid`, `_hsenc` e `igshid`; `fb_source` não está nela. É uma limitação da lista fixa; basta incluí-lo em `detectTrackingParameters` no `background.js`. **Link 4 (teste negativo):** correto, sem falso positivo: `q` e `id` são parâmetros funcionais e não entram no alerta nem no score. | `query-parameters-01-pagina.png`, `-02-link1-destino.png`, `-03-link1-popup.png`, `-04-link3-destino.png`, `-05-link3-popup.png`, `-06-link4-destino.png`, `-07-link4-popup.png` |
| 12 | JS leaks: "Detect changes to JS objects in global scope" (comparado a Firefox 92) | A página lista propriedades de `window` adicionadas, removidas ou alteradas em relação a um navegador padrão; uma proteção ideal não deixa rastro observável. | Hijacking/hook: **nenhum alerta**; score 100 A. Na página, "Properties Changed" mostra `window.indexedDB.open` e `window.indexedDB.deleteDatabase`. | O plugin está correto em não alertar: a página não substitui APIs, só lê o `window`. A página, por sua vez, **detectou os hooks do próprio plugin** em `indexedDB.open` e `deleteDatabase`: para contar chamadas, o `content.js` envolve essas funções com `exportFunction`, e o wrapper não é idêntico à função nativa. Um site poderia usar essa diferença para descobrir que a extensão está instalada. Os hooks de canvas e de `document.cookie` não apareceram porque a página não inspeciona `HTMLCanvasElement.prototype` nem `Document.prototype`. As demais diferenças não vêm do plugin: `languages.0/1` refletem o idioma pt-BR, e `location.toString/valueOf` e a longa lista de "Properties Added" refletem a diferença entre o Firefox 156 e o perfil de referência do Firefox 92. | `js-leaks-01-pagina.png`, `js-leaks-02-popup.png` |

### 2.1 Divergências gerais esperadas

- **Detectar não é bloquear.** O plugin só cancela requisições de domínios da lista pessoal; nas demais páginas ele relata o que viu.
- **Proteções nativas do Firefox agem antes.** A Proteção Aprimorada contra Rastreamento (ETP) bloqueia parte dos rastreadores conhecidos, e a Proteção Total de Cookies (TCP) particiona cookies e storage de terceiros. O plugin vê a requisição bloqueada ou o storage particionado, não o comportamento original.
- **Sem surrogates.** Extensões como o DuckDuckGo substituem scripts bloqueados por versões falsas ("surrogates") para a página não quebrar; o plugin não faz isso.
- **A query string não é limpa.** Parâmetros de rastreio são detectados e listados, mas não removidos da URL.

---

## 3. Análise de sites reais

Condições da coleta: janela privada limpa, Firefox 156.0.1, ETP em Padrão, banner de cookies sem interação, lista de bloqueio vazia, cerca de 10 s de espera após o carregamento. HAR exportado do DevTools (aba Rede, "Manter registros" e "Desativar cache"). Blacklight rodado com a mesma URL final. uBlock Origin com o plugin desativado, logger aberto na mesma URL.

### 3.1 Adidas (`https://www.adidas.com.br`)

**Arquivos:** `evidencias/adidas/adidas.har`, prints do plugin, Blacklight e uBlock em `evidencias/adidas/`.
**URL final:** `https://www.adidas.com.br/` (sem redirecionamento)
**Data e hora da coleta:** 28/09/2026, por volta de 19:30 (horário de Brasília); o HAR começa em 19:30:39
**Banner de cookies:** "Monitorização de cookies", com "Aceitar monitorização" e "Gerir monitorização"; não foi clicado (print `devtools-rede.png`).
**HAR:** 267 requisições; resumo gerado por `tools/analisar_har.py` em `evidencias/adidas/har-resumo.md`.

**Resumo do plugin:**

| Terceiros | Rastreadores conhecidos | Cookies (1ª sessão / 1ª persistente / 3ª sessão / 3ª persistente) | Storage | Alertas | Score |
| --- | --- | --- | --- | --- | --- |
| 14 hosts (7 domínios base) | 3: `res.cloudinary.com`, `eum.instana.io`, `tags.tiqcdn.com` | 236 observados: 168 / 48 / 3 / 6 (contagem de gravações; o score conta pares nome + domínio distintos) | Frame 0: 4 itens em localStorage e 7 em sessionStorage, sem IndexedDB | Canvas fingerprint (`toDataURL`, script `www.adidas.com.br/D1iN8EIyM2XaC4879w/.../icUxhEA8P`); hook: `fetch` e `XMLHttpRequest.prototype.open` substituídos no frame 0 | **55 C** (rastreadores −12, canvas −15, hijack −10, cookies 3ª persistentes −4, 3ª não rastreadora −4) |

**Observações do HAR que explicam o resultado:**

- **O gerenciador de tags foi bloqueado pelo Firefox.** `tags.tiqcdn.com/utag/adidas/adidasglobal/prod/utag.js` (Tealium iQ) e `eum.instana.io/eum.min.js` (monitoramento Instana) aparecem no HAR com **status 0**, sem resposta: a Proteção contra rastreamento do Firefox cancelou as requisições. Como o Tealium é quem carrega as tags de marketing (pixels de anúncio, analytics), nenhuma delas chegou a ser pedida. Isso explica por que a Adidas mostra só 14 hosts de terceiros, quase todos da própria empresa. O plugin conta os dois domínios porque registra a tentativa no `onBeforeRequest`, antes do bloqueio.
- **10 dos 14 "terceiros" são da própria Adidas em outro domínio base:** `adidas.com` (assets, microfrontends, esm.glass, brand.assets, account-frontends, feature-flags) e `3stripes.net`. Pela regra de eTLD+1, `adidas.com` ≠ `adidas.com.br`, então contam como 3ª parte, embora sejam a mesma empresa. Os outros são CDNs: `akamaihd.net` (fotos) e `amazonaws.com` (arquivo de taxonomia).
- **`res.cloudinary.com` é CDN de imagens**, usada aqui como `res.cloudinary.com/adidas-app/...` (19 imagens e vídeos). Ela está na lista Disconnect e por isso conta como rastreador, mas no tráfego observado só entrega mídia da própria Adidas; é um provável falso positivo da classificação por lista.
- **Canvas fingerprint de antibot:** o script que lê o canvas é servido pelo próprio `www.adidas.com.br`, num caminho aleatório (`/D1iN8EIyM2XaC4879w/...`), e o site grava os cookies `ak_bmsc` e `bm_sz` (domínio `adidas.com`). Esse conjunto é característico do Akamai Bot Manager, que coleta a impressão digital do navegador para distinguir humanos de robôs. Por estar em 1ª parte, listas de bloqueio baseadas em domínio não o pegam.
- **Hooks em `fetch` e `XMLHttpRequest.open`:** coerentes com o mesmo sensor antibot ou com a ferramenta de monitoramento de desempenho, que envolvem essas funções para observar requisições.
- **Polling de 1ª parte:** `www.adidas.com.br/.../membership?locale=pt_BR` é pedido dezenas de vezes e sempre recebe **403**. Não entra como indicador de hijacking porque o critério exige domínio de terceiro.

**Reconciliação:**

| Domínio | Plugin | Blacklight | uBlock | Explicação (citando o HAR) |
| --- | --- | --- | --- | --- |
| `tags.tiqcdn.com` (Tealium) | Rastreador (Disconnect), 1 requisição | Não apontado ("No ad trackers found"; nenhum pixel nem GA remarketing) | **Não bloqueado**: aparece no registro sem filtro aplicado; o uBlock mostra o CNAME `dzfq4ouujrxm8.cloudfront.net` (`ublock-03-registro-tiqcdn.png`) | Plugin e uBlock divergem. No HAR, `utag.js` tem **status 0**: quem bloqueou foi a Proteção contra rastreamento do Firefox, não o uBlock. As listas padrão do uBlock (EasyList/EasyPrivacy) não bloqueiam o carregador do Tealium, porque muitos sites dependem dele para funcionar; a Disconnect o classifica como rastreador porque ele existe para disparar tags de marketing. |
| `eum.instana.io` | Rastreador (Disconnect), 1 requisição | Não apontado (o Blacklight só lista domínios de ad tech da Tracker Radar) | **Bloqueado** pelo filtro `\|\|instana.io^$3p` (único bloqueio da página; `ublock-01-popup.png`, `ublock-02-registro.png`) | Plugin e uBlock concordam. No HAR, `eum.min.js` também tem status 0 (bloqueado pelo Firefox). O Instana é monitoramento de desempenho de usuário real (RUM), que coleta dados de navegação. |
| `res.cloudinary.com` | Rastreador (Disconnect), 19 requisições | Não apontado | **Liberado**: todas as imagens carregam; o uBlock revela o CNAME `resc.cloudinary.com.cdn.cloudflare.net` | Plugin diverge do uBlock. No HAR são só imagens e vídeos em `res.cloudinary.com/adidas-app/...`. A Cloudinary é CDN de mídia; a Disconnect a lista, mas no tráfego observado ela só entrega conteúdo da própria Adidas. Provável falso positivo da classificação por lista. |
| Canvas / Akamai Bot Manager | Canvas fingerprint (`toDataURL`) em script de 1ª parte | **Detectado**: "This website loads trackers ... designed to evade third-party cookie blockers"; "Blacklight detected a script loaded from **adidas.com.br**", com a imagem desenhada ("SomeCanvasFingerPrint...") (`blacklight-03-canvas.png`) | Não bloqueado (1ª parte) | **Plugin e Blacklight concordam**, e apontam o mesmo domínio de origem do script. No HAR, o script está em `www.adidas.com.br/D1iN8EIyM2XaC4879w/...`, e o site grava `ak_bmsc` e `bm_sz`, cookies do Akamai Bot Manager. O próprio Blacklight ressalva que não sabe dizer se o objetivo é rastrear ou prevenir fraude/bots; o conjunto de evidências indica antibot. Listas por domínio não pegam scripts de 1ª parte; plugin e Blacklight detectam pelo comportamento (leitura do canvas após desenho de texto). |
| Cookies de 3ª parte (`adidas.com`) | 2 persistentes (`ak_bmsc`, `bm_sz`) e 1 de sessão (`akacd_acc_frontend_prd`), todos em `adidas.com` | **1 cookie de 3ª parte**, "set for adidas AG" | — | Concordam no essencial: os cookies "de terceiro" são da própria Adidas em outro domínio base (`adidas.com` ≠ `adidas.com.br`). A contagem difere porque o plugin separa cada nome e o Blacklight agrupa por empresa (adidas AG). |
| Scriptlet do uBlock | — | — | Injetou `+js(prevent-clipboard-wr...)` em `www.adidas.com.br` | Além de bloquear requisições, o uBlock modifica o comportamento da página: esse scriptlet impede que o site escreva na área de transferência. O plugin só observa e não tem esse tipo de intervenção. |

**Síntese da Adidas:** os três instrumentos concordam que a página, sem consentimento, tem **pouco rastreamento de terceiros**: o Blacklight não achou nenhum ad tracker, o uBlock só precisou bloquear 1 requisição e o plugin viu 3 domínios da Disconnect, dos quais 2 foram barrados pelo Firefox (status 0 no HAR) e 1 é CDN. O motivo provável é duplo: o carregador de tags (Tealium) é bloqueado pelo Firefox na janela privada e, no Blacklight, as tags dependem do aceite do banner ("Aceitar monitorização"), que nenhum dos testes clicou; além disso, o Blacklight avisa que ferramentas de detecção de bots podem impedir o disparo de rastreadores, e a Adidas usa Akamai Bot Manager. O Blacklight visitou como **celular a partir da Califórnia** (`device=mobile&location=us-ca` na URL do resultado), outra fonte de diferença. O ponto de maior concordância é o **canvas fingerprint**, detectado pelo plugin e pelo Blacklight no mesmo script de `adidas.com.br`.

### 3.2 Nike (`https://www.nike.com.br`)

**Arquivos:** `evidencias/nike/nike.har`, prints em `evidencias/nike/`.
**URL final:** `https://www.nike.com.br/` (sem redirecionamento)
**Data e hora da coleta:** 28/09/2026; o HAR começa em 19:48:01 (horário de Brasília)
**Banner de cookies:** banner da AdOpt (`tag.goadopt.io`), com ícone de cookie; não foi clicado.
**HAR:** 143 requisições; resumo em `evidencias/nike/har-resumo.md`.

**Resumo do plugin:**

| Terceiros | Rastreadores conhecidos | Cookies (1ª sessão / 1ª persistente / 3ª sessão / 3ª persistente) | Storage | Alertas | Score |
| --- | --- | --- | --- | --- | --- |
| 27 hosts (23 domínios base) | 16 hosts (14 domínios base): Google Ads (`pagead2.googlesyndication.com`), Google Analytics, `www.google.com`, Firebase (3 hosts), Pinterest (`ct.pinterest.com`, `s.pinimg.com`), Bing, TikTok, Facebook, Criteo, Globo (`pixel.globo.com`), RTB House (`tags.creativecdn.com`), Clarity, Awin (`www.dwin1.com`) | 175 observados: 13 / 118 / 18 / 25 | Frame 0: 8 itens em localStorage, 3 em sessionStorage, 3 bancos IndexedDB (6 aberturas, 2 exclusões); iframe `ct.pinterest.com/ct.html` (3ª parte) sem storage | Canvas fingerprint (`toDataURL`, script `www.nike.com.br/cmNLLEGlo/.../aDT0P`); **cookie sync** `nike.com.br → google-analytics.com` e `→ google.com` (parâmetro `ep.attr_utm_source`); **7 indicadores de hook**: polling de `googletagmanager.com/gtag/js` (6 pedidos em 30 s), `fetch`, `XHR.open`, `XHR.send` e `window.open` substituídos no frame 0, e `fetch`/`XHR.open` no iframe do `gtm-server.nike.com.br` | **16 F** (rastreadores −20, canvas −15, hijack −15, cookies 3ª persistentes −15, sync −10, 3ª não rastreadora −9) |

**Observações do HAR que explicam o resultado:**

- **Diferente da Adidas, o gerenciador de tags carregou.** `www.googletagmanager.com` (7 scripts) não está na lista Disconnect nem é bloqueado pelo Firefox, e a partir dele a página tentou disparar uma bateria de pixels de marketing antes de qualquer consentimento.
- **O Firefox bloqueou a maioria desses pixels.** 24 requisições de rastreadores têm **status 0** no HAR (sem resposta): `connect.facebook.net/en_US/fbevents.js`, `analytics.tiktok.com/.../events.js`, `bat.bing.com/bat.js` (2×), `dynamic.criteo.com/js/ld/ld.js`, `www.dwin1.com/17652.js`, `tags.creativecdn.com/...js`, `www.clarity.ms/tag/oqtkeruk44`, `pixel.globo.com/event`, 11 chamadas a `pagead2.googlesyndication.com` (conversões do Google Ads `AW-974911059` e `AW-1038984920`) e 4 a `www.google-analytics.com/g/collect`. O plugin conta todos porque registra a tentativa antes do bloqueio. (As outras 4 requisições com status 0 são imagens de `imgnike-a.akamaihd.net` canceladas pela página, não rastreadores.)
- **Tagueamento no servidor contorna o bloqueio.** Enquanto `google-analytics.com/g/collect` era bloqueado, a mesma medição saiu por **`gtm-server.nike.com.br/g/collect?...tid=G-60FGTDZBG2`**: um contêiner do Google Tag Manager rodando num subdomínio da própria Nike. Para o navegador e para as listas, é 1ª parte, então nem o Firefox, nem a Disconnect, nem o plugin o marcam como rastreador. O mesmo servidor registra um Service Worker (`sw_iframe.html`), que aparece no plugin como frame de 1ª parte com `fetch` e `XHR.open` substituídos.
- **Antibot Akamai de novo.** O canvas é lido por um script de 1ª parte num caminho aleatório (`/cmNLLEGlo/...`), e o domínio `gruposbf.com.br` (Grupo SBF, operador da Nike no Brasil) grava `ak_bmsc` e `bm_sz`: mesmo padrão do Akamai Bot Manager visto na Adidas.
- **Cookie sync:** o plugin encontrou o valor de um cookie da Nike no parâmetro `ep.attr_utm_source` enviado ao Google Analytics e ao `www.google.com`. É o Google Analytics recebendo um identificador definido pelo site, ou seja, cruzamento de identificador 1ª parte com o Google.

**Reconciliação:**

| Domínio | Plugin | Blacklight | uBlock | Explicação (citando o HAR) |
| --- | --- | --- | --- | --- |
| `www.googletagmanager.com` (GTM: `gtm.js` e `gtag/js`) | **Não listado** na Disconnect (conta como "3ª parte não rastreadora"); 7 scripts; alerta de **polling** em `gtag/js` (6 pedidos em 30 s) | **Apontado** como Alphabet: "sent information to ... googletagmanager.com" (`blacklight-03-empresas.png`) | **Bloqueado** pelos filtros `\|\|googletagmanager.com^` e `\|\|googletagmanager.com/gtag/js` / `gtm.js` (`ublock-02-registro.png`) | **Maior divergência do site.** A Disconnect trata o GTM como gerenciador de conteúdo, não como rastreador, então o plugin só o pega de forma indireta (polling e penalidade de 3ª parte). O uBlock e o Blacklight o tratam como parte da cadeia de anúncios do Google. No HAR, o GTM carregou (status 200) e disparou todos os pixels abaixo. |
| **Efeito cascata do GTM** | Plugin vê 16 rastreadores, 24 deles com status 0 (bloqueados pelo Firefox) | 9 ad trackers | Só **4 bloqueios** na página; "9 de 12 domínios conectados" (`ublock-01-popup.png`) | Com o GTM bloqueado, o uBlock impediu que os pixels (Facebook, TikTok, Bing, Criteo, Awin, Clarity, RTB House, Globo, Google Ads) fossem **sequer pedidos**, por isso ele mostra poucos bloqueios e poucos domínios. No Firefox sem uBlock (visita do HAR), o GTM carregou e cada pixel gerou uma requisição que a ETP barrou uma a uma. Mesma causa, contagens opostas: o uBlock corta a raiz, o Firefox corta as folhas. |
| `gtm-server.nike.com.br` (GTM no servidor) | 1ª parte, não marcado; iframe de Service Worker com `fetch`/`XHR.open` substituídos | Não apontado | **Não aparece** no registro (`ublock-03-registro-gtm-server.png`) | Na visita com uBlock, o GTM de cliente foi bloqueado, então ninguém chamou o `gtm-server`; por isso ele sumiu do registro, e não porque o uBlock o filtre. Na visita do HAR, o `gtm-server.nike.com.br/g/collect?tid=G-60FGTDZBG2` recebeu a medição que o Firefox bloqueou em `google-analytics.com`. Por ser subdomínio da Nike, nenhuma das três ferramentas o classifica como rastreador: é o ponto cego comum a listas por domínio. |
| `tag.goadopt.io` (banner de cookies AdOpt) | Não listado | Não apontado | **Bloqueado** (`\|\|goadopt.io^$3p`) | O uBlock bloqueia a própria plataforma de consentimento (listas de "cookie notices"), então o banner não aparece. O plugin só a vê como 3ª parte. |
| `s3-sa-east-1.amazonaws.com/frame-image...` | Não listado (1 imagem) | Não apontado | **Bloqueado** (`\|\|amazonaws.com/frame...`) | Filtro específico de caminho do uBlock para uma imagem de rastreamento hospedada na AWS; a lista por domínio do plugin não tem essa granularidade. |
| Google (`googlesyndication.com`, `google-analytics.com`, `google.com`, Firebase) | Rastreador; 11 + 4 requisições com status 0; cookie sync `nike.com.br → google-analytics.com` e `→ google.com` | **Apontado** (Alphabet: `doubleclick.net`, `google-analytics.com`, `googlesyndication.com`, `googletagmanager.com`) | Não chega a ser pedido (GTM bloqueado) | Concordam no Google como principal destino. O Blacklight cita `doubleclick.net`, que **não aparece no HAR**: sem a ETP, as conversões do Google Ads seguem para o DoubleClick; no Firefox, as chamadas a `googlesyndication.com` foram bloqueadas (status 0) e a etapa seguinte nunca aconteceu. |
| `connect.facebook.net` | Rastreador; `fbevents.js` com status 0 | Citado entre os ad trackers ("scripts belonging to Facebook, Inc."), mas "Facebook Pixel not found" | Não chega a ser pedido | O script foi pedido nos dois casos, mas o pixel não disparou eventos: no Firefox o script foi bloqueado; no Blacklight, provavelmente por falta de consentimento. |
| `analytics.tiktok.com` | Rastreador; `events.js` com status 0 | **TikTok Pixel encontrado**, com "advanced matching" | Não chega a ser pedido | O Blacklight, sem ETP, viu o pixel funcionar e até o envio de dados com "advanced matching" (identificadores do visitante). No Firefox o script foi bloqueado antes de rodar; o plugin registrou a tentativa. |
| `dynamic.criteo.com`, `bat.bing.com`, `www.dwin1.com` (Awin) | Rastreadores; todos com status 0 | **Apontados** (Criteo, Microsoft/Bing, Awin AG) | Não chegam a ser pedidos | Concordam nos domínios. Diferença só no resultado: bloqueados pelo Firefox, executados no Blacklight. |
| Cookies de 3ª parte | 25 gravações persistentes (8 nome + domínio distintos no score); via Set-Cookie no HAR, só `ak_bmsc` e `bm_sz` em `gruposbf.com.br` | **2**, "set for Microsoft Corporation" | — | O Blacklight viu cookies do Bing porque o script rodou; no Firefox ele foi bloqueado. Os de 3ª parte que o plugin conta vêm quase todos de JavaScript (`document.cookie`), que não aparecem no HAR; e `gruposbf.com.br` (operadora da Nike) conta como 3ª parte pela regra de domínio base. |
| Canvas fingerprint | `toDataURL` em script de 1ª parte (`www.nike.com.br/cmNLLEGlo/.../aDT0P`) | **Detectado**, "script loaded from **nike.com.br**", 2 imagens desenhadas | Não bloqueado (1ª parte) | **Concordam**, como na Adidas: mesmo sensor antibot (Akamai; cookies `ak_bmsc`/`bm_sz`). |
| `www.clarity.ms` (Microsoft Clarity) | Rastreador; `tag/oqtkeruk44` com status 0 | "Session recording services **not found**" | Não chega a ser pedido | Clarity é gravação de sessão. O Firefox bloqueou a tag; no Blacklight ela não foi detectada gravando, provavelmente porque só inicia após consentimento ou interação. Divergência de detecção por comportamento (Blacklight) vs. por domínio (plugin). |

**Síntese da Nike:** é o site com mais rastreamento dos três, e as três ferramentas concordam nisso: o Blacklight achou 9 ad trackers (acima da média de 7), o plugin achou 16 hosts de rastreadores e deu **16 F**. A diferença está em *onde* cada uma atua: o uBlock corta o Google Tag Manager e, com ele, toda a cascata de pixels (só 4 bloqueios); a proteção do Firefox deixa o GTM carregar e bloqueia cada pixel depois (24 requisições com status 0 no HAR); o Blacklight, sem proteção, vê os pixels funcionando (TikTok com advanced matching). O ponto que nenhuma das três classifica como rastreador é o **tagueamento no servidor** em `gtm-server.nike.com.br`, que recebeu a medição do Google Analytics mesmo com o domínio do Google bloqueado.

### 3.3 On (`https://www.on.com`)

**Arquivos:** `evidencias/on/on.har`, prints em `evidencias/on/`.
**URL final:** `https://www.on.com/pt-br/` (a primeira requisição do HAR é `https://www.on.com/`, redirecionada por idioma). O Blacklight, rodando dos EUA, foi redirecionado para **`https://www.on.com/en-us/`**.
**Data e hora da coleta:** 28/09/2026; o HAR começa em 19:59:37 (horário de Brasília)
**Banner de cookies:** OneTrust (`cdn.cookielaw.org`) e um pop-up de newsletter ("Fique sempre por dentro"); nenhum foi clicado.
**HAR:** 382 requisições; resumo em `evidencias/on/har-resumo.md`.

**Resumo do plugin:**

| Terceiros | Rastreadores conhecidos | Cookies (1ª sessão / 1ª persistente / 3ª sessão / 3ª persistente) | Storage | Alertas | Score |
| --- | --- | --- | --- | --- | --- |
| 35 hosts (28 domínios base) | 24 hosts (21 domínios base no score): Google (DoubleClick ×3 hosts, `google.com`, `google.com.br`, `analytics.google.com`, `accounts.google.com`), OneTrust (`cdn.cookielaw.org`, `geolocation.onetrust.com`), Cloudflare Insights, TikTok, Facebook, Bing, X (`static.ads-twitter.com`), Snapchat (`sc-static.net`), Reddit, Hotjar, Segment (2), Amplitude, Sailthru (`ak.sail-horizon.com`), Skimlinks, Awin, New Relic (`bam.nr-data.net`), `cdnjs.cloudflare.com` | 221 observados: 69 / 149 / 1 / 2 | Frame 0: 6 itens em localStorage e 5 em sessionStorage; frames `about:blank` com os mesmos valores; iframe do `gtm-ss.on.com` (Service Worker) sem storage | **Sem canvas fingerprint**; **cookie sync** `on.com → google.com` e `→ google.com.br` (parâmetro `auid`); 4 indicadores de hook: `fetch`, `XHR.open`, `XHR.send` e `addEventListener` substituídos no frame 0 | **43 D** (rastreadores −20, hijack −15, cookies 3ª persistentes −4, sync −10, 3ª não rastreadora −8) |

**Observações do HAR que explicam o resultado:**

- **Mais terceiros que a Nike, nota melhor.** A On tem mais rastreadores (24 hosts) que a Nike (16), mas tirou 43 D contra 16 F porque **não faz canvas fingerprint** (0 contra −15) e tem poucos cookies de 3ª parte persistentes (2 contra 8). Os tetos de "rastreadores" (−20) e "hijacking" (−15) já estavam cheios nos dois sites, então o que separou as notas foram os outros critérios.
- **O Firefox bloqueou 26 requisições de rastreadores** (status 0 no HAR): `connect.facebook.net/en_US/fbevents.js`, `analytics.tiktok.com/.../events.js`, `bat.bing.com/bat.js`, `static.ads-twitter.com/uwt.js`, `sc-static.net/scevent.min.js`, `www.redditstatic.com/ads/pixel.js`, `static.hotjar.com/c/hotjar-197558.js`, `www.dwin1.com/124266.js`, `assistjs.skimresources.com`, `cdn.segment.com` e `api.segment.io`, `cdn.eu.amplitude.com`, `ak.sail-horizon.com`, `static.cloudflareinsights.com` (3×), 4 chamadas a `ad.doubleclick.net`, 3 a `googleads.g.doubleclick.net`, 2 a `analytics.google.com` e 1 a `stats.g.doubleclick.net`. A única outra requisição com status 0 é uma imagem SVG da própria On.
- **Tagueamento no servidor, como na Nike.** O GTM é servido por **`gtm-ss.on.com`** (`gtm.js?id=GTM-PCRPCPL`, `gtag/js?id=G-2YCD2JC1VD`), subdomínio da On. As medições do Google Analytics saem por `gtm-ss.on.com/g/collect?...tid=G-2YCD2JC1VD`, e o servidor ainda grava cookies de 1ª parte via `gtm-ss.on.com/_/set_cookie?val=...`, técnica usada para prolongar a vida de identificadores que o navegador limitaria se fossem criados por JavaScript.
- **Consentimento presumido.** As chamadas bloqueadas a `analytics.google.com/g/s/collect` e `stats.g.doubleclick.net` levam `gcs=G111`, o sinal do Google Consent Mode para "armazenamento de anúncios e de analytics **concedidos**", embora o banner da OneTrust não tenha sido aceito.
- **Cookie sync `auid`:** o parâmetro `auid=34603890.1790636381` enviado a `ad.doubleclick.net`, `www.google.com` e `www.google.com.br` é o identificador do cookie `_gcl_au` (Google Ads, gravado por JavaScript). O plugin o detectou porque vê cookies de `document.cookie`; o `analisar_har.py` não, porque o HAR só guarda `Set-Cookie`.
- **Hooks sem antibot.** Os hooks em `fetch`, `XMLHttpRequest` e `addEventListener` são compatíveis com o agente do New Relic (`bam.nr-data.net`, presente no HAR e bloqueado pelo uBlock), que envolve essas funções para medir desempenho. Diferentemente de Adidas e Nike, não há canvas nem cookies `ak_bmsc`/`bm_sz`: a On usa Cloudflare (`__cf_bm`, `__cfwaitingroom`) em vez de Akamai.

**Reconciliação:**

| Domínio | Plugin | Blacklight | uBlock | Explicação (citando o HAR) |
| --- | --- | --- | --- | --- |
| `gtm-ss.on.com` (GTM no servidor) | 1ª parte, não marcado; iframe de Service Worker | Não apontado (lista `googletagmanager.com` sob Alphabet) | **Bloqueado** pelo filtro genérico `/gtm.js` (`https://gtm-ss.on.com/gtm.js?id=GTM-PCRPCPL`, `ublock-03-registro-cont.png`) | **Diferença importante em relação à Nike.** O uBlock tem filtros por **caminho** (`/gtm.js`), não só por domínio, e por isso pegou o GTM mesmo no subdomínio da On. O plugin e a Disconnect classificam por domínio e não o pegam. Na Nike o GTM de cliente vinha de `googletagmanager.com` e o servidor só recebia dados, então o uBlock não precisou desse filtro. |
| Efeito cascata do GTM | 24 rastreadores; 26 requisições com status 0 | **22 ad trackers**, 13 empresas | Só **4 bloqueios**, 7 de 9 domínios conectados (`ublock-01-popup.png`) | Mesmo padrão da Nike: bloqueando o `gtm.js`, o uBlock impede que os pixels sejam pedidos. O Blacklight, sem proteção, vê todos funcionando; o Firefox deixa o GTM carregar e bloqueia os pixels um a um. |
| `static.cloudflareinsights.com` | Rastreador; `beacon.min.js` com status 0 (3×) | Não apontado | **Bloqueado** (`\|\|cloudflareinsights.com^`) | Concordam plugin e uBlock. É analytics da Cloudflare (Web Analytics); não é ad tech, por isso o Blacklight não o lista. |
| `bam.nr-data.net` (New Relic) | Rastreador; 1 XHR; hooks em `fetch`/`XHR` | **Apontado** ("New Relic ... nr-data.net") | **Bloqueado** (`\|\|nr-data.net^`) | Os três concordam no domínio. O Blacklight registra que a empresa diz usar os dados para desempenho, não marketing: é o mesmo ponto que a metodologia do score levanta sobre hooks de monitoramento. |
| `static.hotjar.com` | Rastreador; `hotjar-197558.js` com status 0 | **Session recording encontrado** ("script belonging to Hotjar Ltd"; "could be monitoring your keystrokes and mouse clicks") | Não chega a ser pedido | O Blacklight viu o gravador de sessão funcionar; no Firefox o script foi bloqueado antes de rodar, então o plugin só registrou a tentativa. O plugin não tem um detector de gravação de sessão; o Hotjar entra no score só como domínio rastreador. |
| TikTok, X (Twitter), Bing, Awin | Rastreadores; scripts com status 0 | **TikTok Pixel** (com advanced matching), **X Pixel**, Microsoft (`bing.com`) e Awin AG apontados | Não chegam a ser pedidos | Concordam nos domínios; diferem no resultado (bloqueados no Firefox, executados no Blacklight). |
| Google (DoubleClick, `google.com`, Analytics) | Rastreadores; cookie sync `auid`; 10 requisições com status 0 | **Apontado** (Alphabet: `doubleclick.net`, `google.com`, `googleadservices.com`, `googletagmanager.com`) e **"Google Analytics remarketing audiences"** | Não chegam a ser pedidos | Concordam. O "remarketing" do Blacklight e o cookie sync `auid` do plugin apontam o mesmo fluxo: o identificador do Google Ads indo para o DoubleClick. |
| `connect.facebook.net` | Rastreador; `fbevents.js` com status 0 | "Facebook Pixel not found" | Não chega a ser pedido | Como na Nike, o pixel não disparou eventos no Blacklight, provavelmente por depender do consentimento. |
| Cookies de 3ª parte | 3 gravações (1 sessão, 2 persistentes); no HAR, `__cf_bm`/`_cfuvid` de `openai.com` e `__cf_bm` de `on-running.com` | **23 cookies**, de OneTrust, ByteDance (TikTok) e mais 7 empresas | — | **Maior divergência numérica.** No Blacklight os pixels executaram e gravaram seus cookies; no Firefox os scripts foram bloqueados e, com a Proteção Total de Cookies, cookies de terceiros ficam particionados. O plugin só vê os poucos que chegaram por `Set-Cookie` de terceiros não bloqueados (Cloudflare nos domínios `openai.com` e `on-running.com`). |
| `cdn.cookielaw.org`, `geolocation.onetrust.com` (OneTrust) | Rastreadores (Disconnect); 10 + 1 requisições | Cita cookies da OneTrust LLC | Liberados | O banner de consentimento é contado como rastreador pela Disconnect; o uBlock não o bloqueia neste site, e o Blacklight só registra o cookie dele. |
| `images.ctfassets.net` (Contentful), `cdn.on-running.com` | 3ª parte não rastreadora (77 e 6 requisições) | Cita Amazon (`cloudfront.net`) | Liberados; o uBlock revela o CNAME `d3orhvfyxudxxq.cloudfront.net` | CDNs de imagens e fontes. O Blacklight atribui à Amazon por causa do CloudFront por trás do domínio, que só é visível resolvendo o CNAME, algo que o plugin não faz. |
| `bzr.openai.com`, `bzrcdn.openai.com` | 3ª parte não rastreadora; cookies `__cf_bm`/`_cfuvid` | Não apontado | Liberados | Script e XHR da OpenAI carregados pela On (provável integração de busca ou assistente). Não é rastreador de anúncio, mas recebe IP e grava cookies Cloudflare como terceiro. |
| Celtra (`ads.celtra.com`, `celtraidentity.com`, `track.celtra.com`), `sa.getroster.com`, `cdn.brcdn.com` | 3ª parte não rastreadora (fora da Disconnect) | Não apontados individualmente (dentro das "13 empresas") | Liberados | Plataformas de anúncio/afiliados que a Disconnect não lista. O nome `celtraidentity.com` e o `track.celtra.com` indicam identidade e rastreamento de anúncio, mas o plugin só os penaliza como terceiros comuns: limitação da lista. |
| Canvas fingerprint | Não detectado | "Tracking that evades cookie blockers **wasn't found**" | — | **Concordam**: a On não faz fingerprint de canvas. |
| Scriptlet do uBlock | — | — | Injetou `+js(prevent-clipboard-wr...)` | Mesmo scriptlet visto na Adidas e na Nike: o uBlock altera o comportamento da página. |

**Síntese da On:** é o site com **mais rastreadores de publicidade** para o Blacklight (22, três vezes a média) e para o plugin (24 hosts), mas não o de pior nota no plugin, porque não faz fingerprint e grava poucos cookies de terceiros que cheguem a ser vistos no Firefox. O Blacklight a colocaria em primeiro lugar em exposição; o plugin a coloca em segundo, atrás da Nike. A diferença vem de o Blacklight rodar sem proteção (vê 23 cookies de terceiros e gravação de sessão) e de o score do plugin ter tetos que saturam: com 21 domínios rastreadores, a On perde os mesmos −20 que a Nike com 14.

### 3.4 Causas típicas de divergência (para citar nas tabelas)

- **Carregamento após interação:** scripts que só rodam depois de rolar a página, passar o mouse ou aceitar o banner não aparecem numa visita passiva.
- **Banner LGPD:** alguns sites seguram tags de marketing até o consentimento; outros disparam antes.
- **Geolocalização:** o Blacklight roda de servidores nos EUA e pode receber outra versão do site e outros anúncios.
- **Carregador em cascata:** o uBlock bloqueia o Google Tag Manager (`googletagmanager.com`), e com isso os domínios que o GTM carregaria nem chegam a ser pedidos; o plugin, que não bloqueia, vê todos eles.
- **Listas diferentes:** o plugin usa a Disconnect; o uBlock usa EasyList, EasyPrivacy e listas próprias; o Blacklight usa detecção por comportamento mais a lista do DuckDuckGo Tracker Radar.
- **Cookies por JavaScript:** o Blacklight e o HAR veem headers `Set-Cookie`; cookies criados por `document.cookie` só aparecem para quem observa o JavaScript, como o plugin.
- **Proteções do Firefox:** ETP e TCP bloqueiam ou particionam parte do tráfego antes do plugin, enquanto o Blacklight usa um navegador sem essas proteções.
- **Tagueamento no servidor:** subdomínios próprios que fazem proxy de ferramentas de terceiros (por exemplo, `gtm-server.nike.com.br`, visto registrado como Service Worker) parecem 1ª parte para o plugin e para as listas.

---

## 4. Score de privacidade

### 4.1 Metodologia

```
score = 100 − Σ min(peso × ocorrências, teto)
```

| Critério | Peso | Teto | Justificativa |
| --- | --- | --- | --- |
| Domínio rastreador conhecido (Disconnect) | −4 | −20 | Coleta comportamental confirmada por lista pública e auditável. |
| Canvas fingerprint | −15 | −15 | Identifica o navegador sem cookie e sobrevive à limpeza de dados. |
| Indicador de hijacking/hook | −5 | −15 | Pode interceptar dados do usuário ou controlar o navegador. |
| Cookie de 3ª parte persistente | −2 | −15 | Reconhece o mesmo navegador em sites diferentes ao longo do tempo. |
| Cookie sync ou bounce | −5 | −10 | Duas empresas trocam ou reconstroem o identificador do usuário. |
| 3ª parte não rastreadora | −1 | −10 | Recebe IP e Referer mesmo fora de listas. |
| Storage HTML5 em frame de 3ª parte | −2 | −10 | Identificador persistente fora dos cookies. |
| Parâmetro de rastreio na URL | −1 | −5 | Identificador de campanha na URL; sinal mais fraco. |

Notas: A 85–100, B 70–84, C 50–69, D 30–49, F 0–29.

O peso cresce com o quanto a técnica é invasiva e difícil de evitar: fingerprint e hijacking não dependem de cookies e resistem à limpeza, então pesam mais. O teto impede que um único critério repetido zere a nota sozinho. Os tetos somam 100, então o score nunca é negativo. Detalhes e limitações em `docs/metodologia-score.md`.

### 4.2 Resultado nos 3 sites

| Critério | Adidas | Nike | On |
| --- | --- | --- | --- |
| Rastreadores conhecidos | 3 → −12 | 14 → −20 | 21 → −20 |
| Canvas fingerprint | 1 → −15 | 1 → −15 | 0 → 0 |
| Hijacking/hook | 2 → −10 | 7 → −15 | 4 → −15 |
| Cookies 3ª persistentes | 2 → −4 | 8 → −15 | 2 → −4 |
| Cookie sync / bounce | 0 → 0 | 2 → −10 | 2 → −10 |
| 3ª parte não rastreadora | 4 → −4 | 9 → −9 | 8 → −8 |
| Storage em frame de 3ª | 0 → 0 | 0 → 0 | 0 → 0 |
| Parâmetros de rastreio | 0 → 0 | 0 → 0 | 0 → 0 |
| **Score / nota** | **55 C** | **16 F** | **43 D** |

### 4.3 Comparação com o Blacklight

| Aspecto | Adidas | Nike | On |
| --- | --- | --- | --- |
| Rastreadores de anúncio (Blacklight) | 0 | 9 (Facebook, Awin e mais 4; empresas: Alphabet, Criteo, Microsoft) | 22 (Microsoft, Awin e mais 11) |
| Cookies de 3ª parte (Blacklight) | 1 (adidas AG) | 2 (Microsoft) | 23 (OneTrust, ByteDance e mais 7) |
| Canvas fingerprinting (Blacklight) | Sim (script de adidas.com.br) | Sim (script de nike.com.br) | Não |
| Session recording (Blacklight) | Não | Não | **Sim** (Hotjar) |
| Keylogging (Blacklight) | Não | Não | Não |
| Facebook Pixel / Google Analytics remarketing (Blacklight) | Não / Não (TikTok e X Pixel também não) | Não / Não; **TikTok Pixel sim**, com advanced matching | Não / **Sim**; TikTok Pixel (advanced matching) e X Pixel sim |

**Onde concordam:**

- **A Adidas é a que menos rastreia.** O Blacklight achou 0 ad trackers e 1 cookie de terceiro (da própria adidas AG); o plugin deu a melhor nota das três (55 C), e a maior parte da penalidade vem de canvas e hooks, não de rastreadores de anúncio.
- **Canvas fingerprint, caso a caso.** Os dois detectaram fingerprint na Adidas e na Nike, no mesmo script de 1ª parte (o Blacklight diz "script loaded from adidas.com.br / nike.com.br"), e os dois **não** detectaram na On. É o critério com concordância total.
- **Os mesmos destinos de publicidade.** Google (DoubleClick, Analytics), Microsoft/Bing, Criteo, Awin, TikTok e Facebook aparecem nas duas ferramentas para Nike e On. O "Google Analytics remarketing" que o Blacklight achou na On corresponde ao cookie sync `auid` (identificador do Google Ads enviado ao DoubleClick) que o plugin achou no mesmo site.

**Onde divergem e por quê:**

- **Ordem entre Nike e On.** O Blacklight coloca a On como a pior (22 ad trackers, 23 cookies de terceiro, gravação de sessão, TikTok e X Pixel) e a Nike no meio (9 ad trackers). O plugin inverte: Nike 16 F, On 43 D. Motivos:
  1. **Tetos saturados.** Nike (14 domínios rastreadores) e On (21) perdem o mesmo −20; a diferença de volume de rastreadores, que é o que o Blacklight destaca, não aparece na nota.
  2. **Canvas pesa muito.** A Nike perde −15 por um fingerprint que o próprio Blacklight diz não saber se é rastreamento ou antibot (e as evidências, cookies `ak_bmsc`/`bm_sz`, apontam para antibot). A On não tem canvas.
  3. **Cookies de terceiros.** No Blacklight, sem proteções, os pixels da On executam e gravam 23 cookies de terceiros; no Firefox, os scripts são bloqueados (status 0 no HAR) e a Proteção Total de Cookies particiona o resto, então o plugin só vê 3.
- **Ambiente diferente.** O Blacklight visita como celular a partir da Califórnia (`device=mobile&location=us-ca`) num navegador sem bloqueio; na On ele foi até redirecionado para `/en-us/`, outra versão do site. O plugin rodou no Firefox com a proteção padrão, que bloqueou de 24 a 26 requisições de rastreadores em Nike e On antes de executarem.
- **Detecção por domínio × por comportamento.** O Blacklight detecta gravação de sessão, pixels e remarketing pelo comportamento dos scripts; o plugin detecta rastreadores por lista (Disconnect) e comportamento só em canvas, cookies, storage e hooks. Por isso o Blacklight achou o Hotjar gravando sessão na On, que o plugin só conhece como domínio da lista.
- **O plugin vê o que o Blacklight não mede:** hooks em APIs globais (7 na Nike, 4 na On), polling persistente do GTM na Nike e o tagueamento no servidor (`gtm-server.nike.com.br`, `gtm-ss.on.com`), que aparece nos alertas como iframe de Service Worker de 1ª parte com `fetch` substituído.

**Limitações do score:** ele mede exposição, não intenção. Ferramentas legítimas de monitoramento (o agente do New Relic, visto na On, substitui `fetch` e `XMLHttpRequest` e envia dados a `bam.nr-data.net`) e sensores antibot (canvas na Adidas e na Nike) contam como indicadores. Sites grandes de e-commerce atingem o teto de vários critérios, o que comprime as notas; nesses casos, a comparação se faz pelo detalhamento de cada critério. Uma versão futura poderia aumentar o teto de rastreadores e reduzir o peso do canvas quando ele vem de 1ª parte com sinais de antibot.

---

## 5. Conclusão

O plugin cumpriu os objetivos da avaliação: detectou conexões a terceiros, classificou cookies (1ª/3ª parte, sessão/persistente, header/JavaScript), mediu storage HTML5 por frame, identificou canvas fingerprint, bounce tracking, cookie sync, parâmetros de rastreio e indicadores de hijacking/hook, calculou um score com metodologia explícita e bloqueou domínios de uma lista pessoal.

Nas páginas de teste do DuckDuckGo, as detecções bateram com o esperado; as divergências vieram de o plugin **observar sem proteger** (não embaralha canvas, não remove parâmetros, não particiona storage) e de limitações pontuais explicadas (requisições de Service Worker fora do bloqueio, `fb_source` fora da lista, storage gravado depois das medições).

Nos sites reais, o principal aprendizado foi que **cada ferramenta corta o rastreamento num ponto diferente**: o uBlock bloqueia o gerenciador de tags e impede a cascata de pixels; a proteção padrão do Firefox deixa o gerenciador carregar e bloqueia cada pixel; o Blacklight, sem proteção, mostra tudo o que o site faria. Ler o HAR (status 0, domínios e horários) foi o que permitiu reconciliar números que, à primeira vista, pareciam contraditórios.

O ponto cego comum às três ferramentas é o **tagueamento no servidor**: Nike (`gtm-server.nike.com.br`) e On (`gtm-ss.on.com`) enviam a medição do Google Analytics por subdomínios próprios, que parecem 1ª parte para listas baseadas em domínio. Só o uBlock pegou um caso (a On), porque tem um filtro por caminho (`/gtm.js`). Detectar esse padrão exige olhar o comportamento das requisições, não só o domínio.

---

## Anexo A: prints das DuckDuckGo Privacy Test Pages

Arquivos em `evidencias/ddg/`. A numeração segue a tabela da seção 2.

### Linhas 1 a 5: Tracker Reporting

![tracker-reporting-01-script.png](../evidencias/ddg/tracker-reporting-01-script.png)

*`tracker-reporting-01-script.png`*

![tracker-reporting-02-surrogate.png](../evidencias/ddg/tracker-reporting-02-surrogate.png)

*`tracker-reporting-02-surrogate.png`*

![tracker-reporting-03-img.png](../evidencias/ddg/tracker-reporting-03-img.png)

*`tracker-reporting-03-img.png`*

![tracker-reporting-04-fragment.png](../evidencias/ddg/tracker-reporting-04-fragment.png)

*`tracker-reporting-04-fragment.png`*

![tracker-reporting-05-fetch.png](../evidencias/ddg/tracker-reporting-05-fetch.png)

*`tracker-reporting-05-fetch.png`*

### Linha 6: Storage blocking

![storage-blocking-01-pagina.png](../evidencias/ddg/storage-blocking-01-pagina.png)

*`storage-blocking-01-pagina.png`*

![storage-blocking-02-popup.png](../evidencias/ddg/storage-blocking-02-popup.png)

*`storage-blocking-02-popup.png`*

![storage-blocking-03-popup-frames.png](../evidencias/ddg/storage-blocking-03-popup-frames.png)

*`storage-blocking-03-popup-frames.png`*

![storage-blocking-04-popup-apos-f5.png](../evidencias/ddg/storage-blocking-04-popup-apos-f5.png)

*`storage-blocking-04-popup-apos-f5.png`*

### Linha 7: Fingerprinting / canvas

![canvas-01-pagina.png](../evidencias/ddg/canvas-01-pagina.png)

*`canvas-01-pagina.png`*

![canvas-02-popup.png](../evidencias/ddg/canvas-02-popup.png)

*`canvas-02-popup.png`*

![canvas-03-pagina-fim.png](../evidencias/ddg/canvas-03-pagina-fim.png)

*`canvas-03-pagina-fim.png`*

### Linha 8: Tracker Blocking (request-blocking)

![request-blocking-01-sem-bloqueio-pagina.png](../evidencias/ddg/request-blocking-01-sem-bloqueio-pagina.png)

*`request-blocking-01-sem-bloqueio-pagina.png`*

![request-blocking-02-sem-bloqueio-popup.png](../evidencias/ddg/request-blocking-02-sem-bloqueio-popup.png)

*`request-blocking-02-sem-bloqueio-popup.png`*

![request-blocking-03-com-bloqueio-pagina.png](../evidencias/ddg/request-blocking-03-com-bloqueio-pagina.png)

*`request-blocking-03-com-bloqueio-pagina.png`*

![request-blocking-04-com-bloqueio-minha-lista.png](../evidencias/ddg/request-blocking-04-com-bloqueio-minha-lista.png)

*`request-blocking-04-com-bloqueio-minha-lista.png`*

![request-blocking-05-com-bloqueio-rastreadores.png](../evidencias/ddg/request-blocking-05-com-bloqueio-rastreadores.png)

*`request-blocking-05-com-bloqueio-rastreadores.png`*

### Linha 9: Storage partitioning

![storage-partitioning-01-pagina.png](../evidencias/ddg/storage-partitioning-01-pagina.png)

*`storage-partitioning-01-pagina.png`*

![storage-partitioning-02-popup-storage.png](../evidencias/ddg/storage-partitioning-02-popup-storage.png)

*`storage-partitioning-02-popup-storage.png`*

![storage-partitioning-03-popup-frames.png](../evidencias/ddg/storage-partitioning-03-popup-frames.png)

*`storage-partitioning-03-popup-frames.png`*

![storage-partitioning-04-popup-cookies.png](../evidencias/ddg/storage-partitioning-04-popup-cookies.png)

*`storage-partitioning-04-popup-cookies.png`*

### Linha 10: Bounce tracking

![bounce-01-primeira-visita.png](../evidencias/ddg/bounce-01-primeira-visita.png)

*`bounce-01-primeira-visita.png`*

### Linha 11: Query Parameters

![query-parameters-01-pagina.png](../evidencias/ddg/query-parameters-01-pagina.png)

*`query-parameters-01-pagina.png`*

![query-parameters-02-link1-destino.png](../evidencias/ddg/query-parameters-02-link1-destino.png)

*`query-parameters-02-link1-destino.png`*

![query-parameters-03-link1-popup.png](../evidencias/ddg/query-parameters-03-link1-popup.png)

*`query-parameters-03-link1-popup.png`*

![query-parameters-04-link3-destino.png](../evidencias/ddg/query-parameters-04-link3-destino.png)

*`query-parameters-04-link3-destino.png`*

![query-parameters-05-link3-popup.png](../evidencias/ddg/query-parameters-05-link3-popup.png)

*`query-parameters-05-link3-popup.png`*

![query-parameters-06-link4-destino.png](../evidencias/ddg/query-parameters-06-link4-destino.png)

*`query-parameters-06-link4-destino.png`*

![query-parameters-07-link4-popup.png](../evidencias/ddg/query-parameters-07-link4-popup.png)

*`query-parameters-07-link4-popup.png`*

### Linha 12: JS leaks

![js-leaks-01-pagina.png](../evidencias/ddg/js-leaks-01-pagina.png)

*`js-leaks-01-pagina.png`*

![js-leaks-02-popup.png](../evidencias/ddg/js-leaks-02-popup.png)

*`js-leaks-02-popup.png`*

## Anexo B: prints da Adidas

Arquivos em `evidencias/adidas/`, junto com `adidas.har` e `har-resumo.md`.

### Adidas: Plugin

![plugin-01-rastreadores.png](../evidencias/adidas/plugin-01-rastreadores.png)

*`plugin-01-rastreadores.png`*

![plugin-02-rastreadores-cont.png](../evidencias/adidas/plugin-02-rastreadores-cont.png)

*`plugin-02-rastreadores-cont.png`*

![plugin-03-cookies.png](../evidencias/adidas/plugin-03-cookies.png)

*`plugin-03-cookies.png`*

![plugin-04-storage.png](../evidencias/adidas/plugin-04-storage.png)

*`plugin-04-storage.png`*

![plugin-05-alertas.png](../evidencias/adidas/plugin-05-alertas.png)

*`plugin-05-alertas.png`*

![plugin-06-score.png](../evidencias/adidas/plugin-06-score.png)

*`plugin-06-score.png`*

![plugin-07-score-cont.png](../evidencias/adidas/plugin-07-score-cont.png)

*`plugin-07-score-cont.png`*

### Adidas: uBlock Origin

![ublock-01-popup.png](../evidencias/adidas/ublock-01-popup.png)

*`ublock-01-popup.png`*

![ublock-02-registro.png](../evidencias/adidas/ublock-02-registro.png)

*`ublock-02-registro.png`*

![ublock-03-registro-tiqcdn.png](../evidencias/adidas/ublock-03-registro-tiqcdn.png)

*`ublock-03-registro-tiqcdn.png`*

### Adidas: Blacklight

![blacklight-01.png](../evidencias/adidas/blacklight-01.png)

*`blacklight-01.png`*

![blacklight-02.png](../evidencias/adidas/blacklight-02.png)

*`blacklight-02.png`*

![blacklight-03-canvas.png](../evidencias/adidas/blacklight-03-canvas.png)

*`blacklight-03-canvas.png`*

### Adidas: DevTools

![devtools-rede.png](../evidencias/adidas/devtools-rede.png)

*`devtools-rede.png`*

## Anexo C: prints da Nike

Arquivos em `evidencias/nike/`, junto com `nike.har` e `har-resumo.md`.

### Nike: Plugin

![plugin-01-rastreadores.png](../evidencias/nike/plugin-01-rastreadores.png)

*`plugin-01-rastreadores.png`*

![plugin-02-rastreadores-cont.png](../evidencias/nike/plugin-02-rastreadores-cont.png)

*`plugin-02-rastreadores-cont.png`*

![plugin-03-rastreadores-cont2.png](../evidencias/nike/plugin-03-rastreadores-cont2.png)

*`plugin-03-rastreadores-cont2.png`*

![plugin-04-cookies.png](../evidencias/nike/plugin-04-cookies.png)

*`plugin-04-cookies.png`*

![plugin-05-storage.png](../evidencias/nike/plugin-05-storage.png)

*`plugin-05-storage.png`*

![plugin-06-storage-cont.png](../evidencias/nike/plugin-06-storage-cont.png)

*`plugin-06-storage-cont.png`*

![plugin-07-storage-cont2.png](../evidencias/nike/plugin-07-storage-cont2.png)

*`plugin-07-storage-cont2.png`*

![plugin-08-alertas.png](../evidencias/nike/plugin-08-alertas.png)

*`plugin-08-alertas.png`*

![plugin-09-alertas-cont.png](../evidencias/nike/plugin-09-alertas-cont.png)

*`plugin-09-alertas-cont.png`*

![plugin-10-score.png](../evidencias/nike/plugin-10-score.png)

*`plugin-10-score.png`*

![plugin-11-score-cont.png](../evidencias/nike/plugin-11-score-cont.png)

*`plugin-11-score-cont.png`*

### Nike: uBlock Origin

![ublock-01-popup.png](../evidencias/nike/ublock-01-popup.png)

*`ublock-01-popup.png`*

![ublock-02-registro.png](../evidencias/nike/ublock-02-registro.png)

*`ublock-02-registro.png`*

![ublock-03-registro-gtm-server.png](../evidencias/nike/ublock-03-registro-gtm-server.png)

*`ublock-03-registro-gtm-server.png`*

### Nike: Blacklight

![blacklight-01.png](../evidencias/nike/blacklight-01.png)

*`blacklight-01.png`*

![blacklight-02.png](../evidencias/nike/blacklight-02.png)

*`blacklight-02.png`*

![blacklight-03-empresas.png](../evidencias/nike/blacklight-03-empresas.png)

*`blacklight-03-empresas.png`*

## Anexo D: prints da On

Arquivos em `evidencias/on/`, junto com `on.har` e `har-resumo.md`.

### On: Plugin

![plugin-01-rastreadores.png](../evidencias/on/plugin-01-rastreadores.png)

*`plugin-01-rastreadores.png`*

![plugin-02-rastreadores-cont.png](../evidencias/on/plugin-02-rastreadores-cont.png)

*`plugin-02-rastreadores-cont.png`*

![plugin-03-rastreadores-cont2.png](../evidencias/on/plugin-03-rastreadores-cont2.png)

*`plugin-03-rastreadores-cont2.png`*

![plugin-04-rastreadores-cont3.png](../evidencias/on/plugin-04-rastreadores-cont3.png)

*`plugin-04-rastreadores-cont3.png`*

![plugin-05-cookies.png](../evidencias/on/plugin-05-cookies.png)

*`plugin-05-cookies.png`*

![plugin-06-storage.png](../evidencias/on/plugin-06-storage.png)

*`plugin-06-storage.png`*

![plugin-07-storage-cont.png](../evidencias/on/plugin-07-storage-cont.png)

*`plugin-07-storage-cont.png`*

![plugin-08-alertas.png](../evidencias/on/plugin-08-alertas.png)

*`plugin-08-alertas.png`*

![plugin-09-alertas-cont.png](../evidencias/on/plugin-09-alertas-cont.png)

*`plugin-09-alertas-cont.png`*

![plugin-10-score.png](../evidencias/on/plugin-10-score.png)

*`plugin-10-score.png`*

![plugin-11-score-cont.png](../evidencias/on/plugin-11-score-cont.png)

*`plugin-11-score-cont.png`*

### On: uBlock Origin

![ublock-01-popup.png](../evidencias/on/ublock-01-popup.png)

*`ublock-01-popup.png`*

![ublock-02-registro.png](../evidencias/on/ublock-02-registro.png)

*`ublock-02-registro.png`*

![ublock-03-registro-cont.png](../evidencias/on/ublock-03-registro-cont.png)

*`ublock-03-registro-cont.png`*

![ublock-04-registro-cont2.png](../evidencias/on/ublock-04-registro-cont2.png)

*`ublock-04-registro-cont2.png`*

### On: Blacklight

![blacklight-01.png](../evidencias/on/blacklight-01.png)

*`blacklight-01.png`*

![blacklight-02.png](../evidencias/on/blacklight-02.png)

*`blacklight-02.png`*

![blacklight-03-empresas.png](../evidencias/on/blacklight-03-empresas.png)

*`blacklight-03-empresas.png`*

![blacklight-04-empresas-cont.png](../evidencias/on/blacklight-04-empresas-cont.png)

*`blacklight-04-empresas-cont.png`*
