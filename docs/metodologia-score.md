# Metodologia do score de privacidade

O popup calcula uma nota de 0 a 100 para a página aberta na aba, a partir do relatório que a extensão montou desde a última navegação principal. O cálculo fica em `lib/score.js` (`PrivacyScore.computeScore`).

## Fórmula

```
score = 100 − Σ min(peso × ocorrências, teto)
```

Cada critério tira pontos proporcionais ao número de ocorrências, até um teto. Os tetos somam exatamente 100, então o score nunca fica negativo. O teto por critério impede que um único comportamento muito repetido (por exemplo, 40 domínios de terceiros sem rastreador conhecido) esconda os outros.

## Critérios

| Critério | Como é contado | Peso | Teto | Justificativa |
| --- | --- | --- | --- | --- |
| Domínio rastreador conhecido | Domínios base distintos de terceiros presentes na lista Disconnect (`lib/trackers.json`) | −4 | −20 | Coleta comportamental confirmada por uma lista pública e auditável. |
| Canvas fingerprint | Leituras de canvas (`toDataURL`, `toBlob`, `getImageData`) depois de `fillText` no mesmo frame | −15 | −15 | Identifica o navegador sem cookie e sobrevive à limpeza de dados. Uma ocorrência já basta para o teto. |
| Indicador de hijacking/hook | WebSocket para terceiro, polling persistente, API nativa substituída, assinatura do BeEF (detalhes abaixo) | −5 | −15 | Pode interceptar o que o usuário digita ou envia, ou manter um canal de controle do navegador. |
| Cookie de 3ª parte persistente | Pares nome + domínio distintos de cookies de 3ª parte com `Expires` ou `Max-Age` | −2 | −15 | Permite reconhecer o mesmo navegador em sites diferentes ao longo do tempo. |
| Cookie sync ou bounce | Alertas de cookie sync + domínios intermediários de bounce tracking | −5 | −10 | Duas empresas trocam ou reconstroem o identificador do usuário. |
| 3ª parte não rastreadora | Domínios base distintos de terceiros fora da lista Disconnect | −1 | −10 | Cada terceiro recebe o IP e, em geral, o Referer, mesmo que não esteja numa lista. |
| Storage HTML5 em frame de 3ª parte | Frames de 3ª parte com pelo menos um item em localStorage, sessionStorage ou IndexedDB | −2 | −10 | Um identificador persistente fora dos cookies, que escapa de quem só limpa cookies. |
| Parâmetro de rastreio na URL | Parâmetros como `utm_*`, `gclid`, `fbclid`, `msclkid` na URL da página | −1 | −5 | Carrega um identificador de campanha ou de clique na própria URL; é o sinal mais fraco. |

## Notas

| Nota | Faixa |
| --- | --- |
| A | 85–100 |
| B | 70–84 |
| C | 50–69 |
| D | 30–49 |
| F | 0–29 |

## Indicadores de hijacking/hook

- **WebSocket para terceiro:** requisição do tipo `websocket` (observada em `webRequest.onBeforeRequest`) para um domínio base diferente do da página. Um canal persistente e bidirecional permite que outra empresa envie comandos ou receba dados em tempo real.
- **Polling persistente:** a mesma URL de terceiro, sem a query string, pedida 5 vezes ou mais em 30 segundos por `xmlhttprequest`, `script`, `beacon` ou `ping`. É o equivalente sem WebSocket de um canal de controle.
- **API nativa substituída:** o content script guarda, no `document_start` (antes de qualquer script da página), as referências de `fetch`, `XMLHttpRequest.prototype.open`/`send`, `WebSocket`, `EventTarget.prototype.addEventListener`, `document.write`, `navigator.sendBeacon` e `window.open`. Dois e dez segundos depois do `load`, compara de novo. Conta como substituída a API cuja referência mudou para uma função que não é nativa. Cada API substituída em cada frame é um indicador.
- **Assinaturas do BeEF** (Browser Exploitation Framework): script cujo caminho termina em `hook.js`, cookie `BEEFHOOK` ou variável global `beef`.

As globais novas criadas pela página aparecem no popup só como informação, sem entrar no score: quase todo site cria dezenas delas (`dataLayer`, `jQuery`, `gtag`), e contá-las puniria qualquer página com JavaScript.

## Limitações conhecidas

- **Indicador não é prova.** Ferramentas legítimas de monitoramento (Sentry, New Relic, Hotjar) também substituem `fetch` e `XMLHttpRequest`, e chats de suporte usam WebSocket. O score mede exposição, não intenção.
- **A lista Disconnect não cobre tudo.** Domínios fora dela (por exemplo, `www.googletagmanager.com`, que o plugin mostrou como "Não listado" na Nike) caem em "3ª parte não rastreadora" e pesam menos. O Blacklight e o uBlock Origin usam outras listas e heurísticas, o que explica parte das divergências.
- **Só o que carregou conta.** Scripts que dependem de interação, de rolagem ou do aceite do banner de cookies não entram no relatório se não rodarem durante a visita.
- **Proteções do Firefox reduzem o que chega a acontecer.** A Proteção Aprimorada contra Rastreamento (ETP) e a Proteção Total de Cookies (TCP) bloqueiam ou particionam parte dos rastreadores antes do plugin ver o efeito.
- **Requisições bloqueadas pela lista pessoal continuam contando.** O score mede o que a página tentou fazer, não o que passou pelo filtro.
- **Domínio base simplificado.** `lib/domains.js` usa uma lista fixa de sufixos brasileiros (`com.br`, `gov.br` etc.). Sufixos estrangeiros de duas partes, como `co.uk`, não são tratados.
