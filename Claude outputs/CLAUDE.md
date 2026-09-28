# Contexto: Avaliação Intermediária de Cibersegurança (Insper)

Este arquivo dá contexto completo para ajudar o Raphael a continuar a avaliação. Leia tudo antes de agir.

## 0. Regras de trabalho (obrigatórias)

- **Responda sempre em português.**
- **NUNCA rode `git commit` nem `git push`.** O Raphael faz os commits ele mesmo, para o histórico ficar só no nome dele. Ao terminar uma etapa, deixe as alterações sem commit e **sugira a mensagem de commit**.
- **Não altere datas de commit** nem reescreva histórico (`rebase`, `amend`, `reset` em commits já enviados).
- Os commits precisam ficar em **dias diferentes** (a avaliação desconta histórico concentrado no último dia).
- Faça **uma etapa por vez** e pare ao final, explicando o que mudou e **como testar no Firefox**.
- Antes de encerrar qualquer etapa: rode `node --check` em todos os `.js`, valide os `.json` e confira que o `manifest.json` continua válido.
- Mantenha o estilo atual do código: JavaScript puro, sem build, sem dependências, comentários em português, `textContent` no popup (nunca `innerHTML` com dados de páginas).
- Explique o código de forma didática quando pedido: o Raphael precisa conseguir explicar tudo ao professor.

## 1. A avaliação

**Disciplina:** Cibersegurança, Insper. Professor: João Eduardo Luisi.
**Tema:** criação de um plugin para Firefox que detecta e bloqueia rastreadores.
**Prazo:** 1 semana a partir da divulgação. O commit 1 foi feito em 24/09/2026; confirmar a data exata de entrega com o Raphael.

### O que o plugin precisa detectar e apresentar

1. Conexões a domínios de terceira parte numa navegação.
2. Quantidade de cookies injetados no carregamento, diferenciando 1ª/3ª parte e sessão/persistente.
3. Armazenamento no cliente via HTML5 (localStorage, sessionStorage, IndexedDB).
4. Sincronismo de cookies (cookie sync / bounce tracking).
5. Canvas fingerprint.
6. Ameaças de sequestro de navegador (hijacking e hook).
7. Pontuação de privacidade da página, com metodologia explícita.

### Entregáveis (obrigatórios para qualquer conceito)

1. **Repositório Git + plugin:** histórico de commits incrementais ao longo da semana; plugin instalável no Firefox (manifest.json + instruções via `about:debugging`).
2. **Relatório do DuckDuckGo Privacy Test Pages:** tabela com teste executado × resultado esperado (da própria página) × resultado do plugin × explicação de cada divergência. **Cada linha precisa de print do plugin rodando na página.**
3. **Análise de 3 sites reais:** para cada site, arquivo HAR exportado do DevTools + comparação do que o plugin detectou com o relatório do **Blacklight** (The Markup) e com os bloqueios do **uBlock Origin**.
4. **Pontuação de privacidade:** score aplicado aos 3 sites, com metodologia (critérios, pesos, justificativa), comparado ao Blacklight.

### Critérios de nota

**Conceito C**
- Plugin instala e roda no Firefox sem erro.
- Detecta e apresenta: conexões a terceiros, contagem de cookies e uso de storage HTML5.
- Relatório DDG cobrindo, no mínimo: Tracker Reporting, Storage blocking e Fingerprinting/canvas.
- HAR dos 3 sites reais entregue.

**Conceito B** (tudo do C, mais)
- Diferencia cookies de 1ª/3ª parte e de sessão/persistentes.
- Detecta canvas fingerprint e bounce tracking / cookie sync (páginas Bounce tracking e Query parameters do DDG).
- Relatório DDG cobre também Tracker Blocking e Storage partitioning, com explicação técnica de cada divergência.
- Reconciliação nos 3 sites: cada rastreador que o Blacklight ou o uBlock identificou e o plugin não (ou vice-versa) tem explicação técnica.

**Conceito A** (tudo do B, mais)
- Detecta indicadores de hijacking/hook (ex.: WebSocket ou polling persistente para domínio terceiro; script injetado que altera objetos globais; a página js-leaks do DDG serve de teste).
- Pontuação de privacidade com metodologia explícita, aplicada aos 3 sites, com comparação crítica ao Blacklight (onde concordam, onde divergem e por quê).
- Interface do plugin exibe o relatório por página (rastreadores, cookies, storage, score) e **permite lista de bloqueio personalizada**.

### Pontos de atenção (descontos)

- Commit único ou histórico concentrado no último dia: desconto.
- Relatório sem HAR ou sem prints do plugin rodando: entregáveis 2 e 3 não pontuam.
- Explicações de divergência genéricas, sem referência ao tráfego observado no HAR ou na página de teste, não são consideradas.

### Formato de entrega

- Link do repositório (público ou com acesso ao professor).
- Relatório em PDF com os entregáveis 2, 3 e 4.
- Arquivos HAR e prints no repositório, na pasta `evidencias/`.

### Referências

- Páginas de teste: https://privacy-test-pages.site/ (código: https://github.com/duckduckgo/privacy-test-pages)
- Blacklight: https://themarkup.org/blacklight
- uBlock Origin: https://github.com/gorhill/uBlock
- Outros: coveryourtracks.eff.org, browserleaks.com/canvas, fingerprintable.org, github.com/jonasstrehle/supercookie
- WebExtensions: https://developer.mozilla.org/pt-BR/docs/Mozilla/Add-ons/WebExtensions

## 2. Estado atual do repositório

- **Repo:** https://github.com/Raphaellafer/pi_cyber_raphael (branch `main`)
- **Pasta local:** `C:\Users\lafer\cyber\pi_cyber_raphael`
- **Nome da extensão:** "Análise de Raphael"

### Commits já feitos

| # | Data | Conteúdo |
| --- | --- | --- |
| 1 | 24/09/2026 | Conceito C: estrutura, terceiros, contagem de cookies, storage HTML5, popup, README |
| 2 | 28/09/2026 | Conceito B: classificação de cookies, canvas, bounce, cookie sync, query params + correção do bounce |

**Faltam:** commit 3 (Conceito A) e commit 4 (ferramentas de análise, relatório e evidências), cada um num dia diferente.

### Arquivos

| Arquivo | Função |
| --- | --- |
| `manifest.json` | Manifest V2. Permissões: webRequest, webRequestBlocking, cookies, tabs, storage, webNavigation, `<all_urls>`. Background: `lib/domains.js` + `background.js`. Content script em `document_start`, `all_frames`, `match_about_blank`. |
| `background.js` | Relatório por aba (`reports: Map<tabId, report>`), zerado a cada navegação principal (`webNavigation.onCommitted`, frameId 0). Terceiros via `webRequest.onBeforeRequest`; cookies via `onHeadersReceived` (Set-Cookie) e mensagens `jsCookie`; bounce via `onBeforeRedirect` + jornada de navegação (`navigationJourneys`); cookie sync; parâmetros de rastreio; canvas. Valores de cookies ficam num `WeakMap` privado e **nunca** vão para o popup. Tem `console.debug("[bounce] ...")`. |
| `content.js` | Roda em cada frame. Hooks na página via `window.wrappedJSObject` + `exportFunction` (sem injetar `<script>`, por causa de CSP): IndexedDB (`open`, `deleteDatabase`), canvas (`toDataURL`, `toBlob`, `getImageData`, `fillText`) e setter de `document.cookie`. Mede localStorage/sessionStorage/IndexedDB no `load` e 3 s depois. Mensagens levam um `token` do `registerFrame`. |
| `lib/domains.js` | `PrivacyDomains`: `hostname`, `baseDomain`, `isThirdParty`, `isTracker`. Domínio base com lista fixa `SUFIXOS = ["com","com.br","edu.br","gov.br","org.br","net.br"]` (sufixo de 2 partes → 3 últimos rótulos; senão 2). Simplificação intencional, porque os sites são brasileiros. |
| `lib/trackers.json` | `{source, retrieved, license, domains[]}`: 4.454 domínios da lista Disconnect (`services.json`), CC BY-NC-SA 4.0. |
| `popup/` | Mostra URL, resumo (terceiros, rastreadores, cookies), tabela de terceiros, cookies em 4 grupos + tabela (nome, domínio, parte, tipo, origem), storage por frame, alertas (canvas, bounce, cookie sync, parâmetros). Subtítulo: "Conceito B". Atualiza a cada 1 s. |
| `README.md` | Funcionalidades, instalação temporária, dados e metodologia, estrutura. |
| `evidencias/` | Vazia (só `.gitkeep`). |

### Regra de bounce (background.js)

- Uma navegação é "continuação" se tiver `transitionQualifiers` com `client_redirect` **ou** se a página anterior foi confirmada há menos de `REDIRECT_CONTINUATION_MS` (5 s).
- Se não for continuação, a cadeia começa com a URL da página anterior da aba (onde o usuário clicou).
- Bounce = domínio base intermediário diferente da origem e do destino. Gravidade "maior" se esse domínio gravou cookie (header ou JS).

## 3. Testes já feitos (sanidade, fora do relatório)

| Teste | Onde | Resultado |
| --- | --- | --- |
| Cookies via JS (sessão e persistente) | example.com, console | OK: 1ª parte, origem js, tipos corretos |
| Canvas | example.com, console | OK: alerta toDataURL, origem "desconhecida" (normal no console) |
| Cookie sync | example.com → `new Image().src="https://httpbin.org/image/png?uid=..."` | OK: example.com → httpbin.org, parâmetro uid |
| Parâmetros de rastreio | `example.com/?utm_source=teste&gclid=123` | OK |
| Cookie via header | `httpbin.org/cookies/set?headerCookie=abcdefgh123` | OK: 1ª, sessão, header. Storage "aguardando" porque o visualizador de JSON do Firefox não roda content scripts |
| Bounce | privacy-test-pages.site/privacy-protections/bounce-tracking/ | Falhava porque a origem ficava fora da cadeia. **Correção entrou no commit 2; falta confirmar no navegador.** |

**Como testar o bounce:** abra sempre a página original do DDG e clique em **"Go to first-party.site"** (NÃO "good.third-party.site": nesse caso intermediário e destino têm o mesmo domínio base `third-party.site`, e não há bounce pela regra). Esperado: bounce `third-party.site`, gravidade "maior" (o `bounce.html` grava o cookie `bounceUID` via JS e localStorage e redireciona com `location.href`), cadeia `privacy-test-pages.site → third-party.site → first-party.site`. Conferir também o log `[bounce]` em about:debugging → Inspecionar.

Na primeira visita, `bounceUIDlocalStorage` e `bounceUIDcookie` chegam vazios e `isNew=<id>` aparece. Isso é normal: o ID ainda não existia. Numa segunda visita, se continuar vazio, pode ser proteção do Firefox (bounce tracking protection / particionamento), o que é bom material para o relatório.

## 4. Sites reais escolhidos (o professor liberou a escolha)

1. `https://www.adidas.com.br`
2. `https://www.nike.com.br`
3. `https://www.on.com` (anotar a URL final se redirecionar, ex.: `/pt-br`)

Primeira observação na Nike (visita comum, sem janela privada, banner de cookies "AdOpt" aberto): 58 domínios terceiros, 46 rastreadores conhecidos, 173 cookies. Terceiros vistos: analytics.tiktok.com, www.googletagmanager.com ("Não listado" na Disconnect: divergência provável com Blacklight/uBlock), a.clarity.ms, applepay.cdn-apple.com, bat.bing.com, pagead2.googlesyndication.com. **Essa visita não serve de evidência oficial** (ver seção 7).

## 5. Próxima etapa: COMMIT 3 (Conceito A)

Mensagem sugerida: `feat: detecção de hijacking/hook, score e blocklist (Conceito A)`

1. **Hijacking/hook**
   - WebSocket para terceiro: `details.type === "websocket"` no `onBeforeRequest` com domínio de terceiro. Opcional: hook no construtor `WebSocket` no content.js.
   - Polling persistente: mesma URL de terceiro (sem query string) pedida 5+ vezes em 30 s via `xmlhttprequest`/`script`/`beacon`.
   - Objetos globais alterados: no `document_start`, guardar as referências nativas de `fetch`, `XMLHttpRequest.prototype.open`/`send`, `WebSocket`, `EventTarget.prototype.addEventListener`, `document.write` (via `wrappedJSObject`); 2 s após o `load`, comparar e listar o que mudou. Listar também globais novas (diferença de `Object.keys(window.wrappedJSObject)`), limitado a 50.
   - Assinaturas BeEF: script com `hook.js`, cookie `BEEFHOOK`, global `beef`.
   - Teste: https://privacy-test-pages.site/security/js-leaks.html ("Detect changes to JS objects in global scope").
2. **Blocklist personalizada**
   - Lista em `browser.storage.local` (`blocklist`: array de domínios base); `storage.onChanged` atualiza um `Set`.
   - Bloqueio: `webRequest.onBeforeRequest` com `["blocking"]` retornando `{ cancel: true }` quando o domínio base estiver na lista. Não bloquear `main_frame`.
   - Contar bloqueios por aba e mostrar no popup.
   - Popup: botão "Bloquear"/"Desbloquear" em cada terceiro e aba "Minha lista" para adicionar/remover manualmente.
3. **Score 0–100**, em `computeScore(report)` (de preferência em `lib/score.js`, carregado no background e no popup):
   `score = 100 − Σ min(peso × ocorrências, teto)`

   | Critério | Peso | Teto | Justificativa |
   | --- | --- | --- | --- |
   | Domínio rastreador conhecido (Disconnect) | −4 | −20 | Coleta comportamental confirmada |
   | Canvas fingerprint | −15 (uma vez) | −15 | Identifica sem cookie e sobrevive à limpeza |
   | Indicador de hijacking/hook | −5 | −15 | Pode interceptar dados ou controlar o navegador |
   | Cookie de 3ª parte persistente | −2 | −15 | Rastreamento entre sites ao longo do tempo |
   | Cookie sync ou bounce | −5 | −10 | Troca de identificadores entre empresas |
   | 3ª parte não rastreadora | −1 | −10 | Exposição de IP/Referer |
   | Storage HTML5 em frame de 3ª parte (itens > 0) | −2 | −10 | Identificador persistente fora dos cookies |
   | Parâmetro de rastreio na URL | −1 | −5 | Identificador na própria URL |

   Letras: A 85–100, B 70–84, C 50–69, D 30–49, F 0–29. Mostrar a nota e o detalhamento por critério.
4. **Popup final:** abas ou seções Rastreadores · Cookies · Storage · Alertas (canvas, bounce, sync, parâmetros, hijack) · Score · Minha lista. Badge no ícone com o nº de rastreadores. Subtítulo "Conceito A".
5. **Docs:** `docs/metodologia-score.md` com critérios, pesos, tetos e justificativas; atualizar o README.

## 6. Etapa final: COMMIT 4

Mensagem sugerida: `docs: ferramentas de análise, evidências e relatório`

- `tools/analisar_har.py` (Python 3, só biblioteca padrão): recebe `.har` + URL do site; lista domínios de terceiros (nº de requisições, tipos, se é rastreador via `lib/trackers.json`), cookies de terceiros em Set-Cookie, WebSockets, possíveis cookie syncs e o horário de cada primeira requisição. Saída em Markdown para colar no relatório. Usar a mesma regra de domínio base do `lib/domains.js`.
- `docs/relatorio.md` (base do PDF), com marcadores `[PREENCHER]`:
  1. Introdução e arquitetura do plugin.
  2. Tabela DDG (seção 8).
  3. Uma seção por site: tabela de reconciliação `domínio × plugin × Blacklight × uBlock × explicação (citando o HAR)`.
  4. Score dos 3 sites vs Blacklight: onde concordam, onde divergem e por quê.
- Estrutura `evidencias/ddg/`, `evidencias/adidas/`, `evidencias/nike/`, `evidencias/on/` com README explicando o conteúdo.
- O Raphael gera os HARs e prints; o PDF final também vai para o repo.

## 7. Procedimento de coleta de evidências (o Raphael faz; oriente se pedir)

Para cada site (Adidas, Nike, On), na **mesma visita**:
1. Janela privada limpa, com o plugin carregado (em about:debugging, permitir a extensão em janelas privadas, se preciso). Proteção contra rastreamento do Firefox em **Padrão** (anotar no relatório).
2. **Regra do banner de cookies: não clicar em Aceitar nem Rejeitar**, a mesma nos 3 sites, e explicar isso no relatório.
3. DevTools → Rede → marcar "Manter registros" e "Desativar cache" → abrir o site → esperar ~10 s → "Salvar tudo como HAR" → `evidencias/<site>/<site>.har`.
4. Prints do popup: resumo, terceiros, cookies, storage, alertas e score.
5. Blacklight com a URL final → print ou PDF.
6. uBlock Origin (com o plugin desativado) → logger → print dos bloqueios.

Divergências típicas para explicar: carregamento após interação/scroll, banner LGPD segurando scripts, Blacklight rodando dos EUA (anúncios diferentes), uBlock bloqueando o carregador (GTM) e impedindo domínios em cascata, listas diferentes (Disconnect vs EasyList/EasyPrivacy), cookies via JS vs Set-Cookie, proteções nativas do Firefox (ETP, Total Cookie Protection).

## 8. Páginas do DuckDuckGo para o entregável 2

Base: https://privacy-test-pages.site/

| Página | Caminho | Conceito |
| --- | --- | --- |
| Tracker Reporting (via script, surrogate, img, document fragment, fetch) | `tracker-reporting/1major-via-script.html` etc. | C |
| Storage blocking | `privacy-protections/storage-blocking/` | C |
| Fingerprinting + canvas | `privacy-protections/fingerprinting/` e `.../canvas.html` | C |
| Tracker Blocking | `privacy-protections/request-blocking/` | B |
| Storage partitioning | `privacy-protections/storage-partitioning/` | B |
| Bounce tracking | `privacy-protections/bounce-tracking/` | B |
| Query Parameters | `privacy-protections/query-parameters/` | B |
| JS leaks | `security/js-leaks.html` | A |

Colunas da tabela: teste executado | resultado esperado (da página) | resultado do plugin | divergência + explicação técnica (citando URL/requisição observada) | print (`evidencias/ddg/<pagina>-NN.png`).

Divergências esperadas: o plugin **detecta** mas só **bloqueia** o que está na blocklist; o Firefox já bloqueia ou particiona antes (ETP/TCP); surrogates não são fornecidos; cookies via JS não aparecem em Set-Cookie; a query string não é removida (só detectada).

## 9. Checklist final

- [ ] Bounce confirmado no DDG (first-party.site)
- [ ] Commit 3 (Conceito A) num dia diferente
- [ ] Prints DDG de todas as páginas da seção 8
- [ ] HAR + prints do plugin + Blacklight + uBlock dos 3 sites
- [ ] Reconciliação com explicação técnica por domínio, citando o HAR
- [ ] Score aplicado aos 3 sites + comparação crítica com o Blacklight
- [ ] Commit 4 num dia diferente
- [ ] Relatório PDF no repo e enviado
- [ ] Repo público ou com acesso dado ao professor
