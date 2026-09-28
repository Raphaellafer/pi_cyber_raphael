# Análise de Raphael

Análise de Raphael é uma extensão experimental para Firefox criada para uma avaliação de Cibersegurança. Ela observa a atividade de privacidade da aba atual, dá uma nota à página e bloqueia apenas os domínios que o usuário colocar na própria lista.

## Funcionalidades

- agrupa requisições de terceiros por domínio, quantidade e tipo;
- compara o domínio base (eTLD+1) usando uma lista fixa de sufixos voltada aos sites brasileiros analisados;
- identifica domínios presentes na lista pública Disconnect Tracking Protection;
- classifica cookies de primeira ou terceira parte e de sessão ou persistentes;
- diferencia cookies recebidos em headers `Set-Cookie` daqueles criados por JavaScript;
- mede itens de `localStorage` e `sessionStorage` no evento `load` e três segundos depois, em cada frame;
- mede bancos IndexedDB quando `indexedDB.databases()` está disponível e observa chamadas a `open` e `deleteDatabase` desde `document_start`;
- alerta sobre leitura de canvas depois de desenho com texto e informa o script de origem;
- detecta bounce tracking: domínios intermediários em redirects de servidor e de cliente (incluindo `location.href`), com gravidade maior quando o intermediário tem cookie no navegador;
- detecta possíveis cookie syncs quando valores de cookies aparecem em parâmetros enviados a outro domínio;
- lista parâmetros de rastreio na navegação, como `utm_*`, `gclid`, `fbclid` e `msclkid`;
- detecta indicadores de hijacking/hook: WebSocket para terceiro, polling persistente, APIs nativas substituídas pela página (`fetch`, `XMLHttpRequest`, `WebSocket`, `addEventListener`, `document.write`, `sendBeacon`, `window.open`) e assinaturas do BeEF;
- calcula um score de privacidade de 0 a 100 com nota de A a F (metodologia em [docs/metodologia-score.md](docs/metodologia-score.md));
- bloqueia requisições de terceiros cujo domínio base esteja na lista de bloqueio pessoal, editável no popup;
- mostra o número de rastreadores conhecidos no ícone da extensão;
- mostra o relatório no popup, em abas, e o reinicia a cada navegação principal confirmada.

Cookies com origem `header` foram observados em uma resposta HTTP por meio de `Set-Cookie`; o navegador ainda pode rejeitá-los por suas políticas. Cookies com origem `js` foram observados no setter de `document.cookie`. Os valores são mantidos apenas na memória do background para detectar cookie sync e nunca são enviados ao popup.

## Instalação temporária

1. Abra `about:debugging` no Firefox.
2. Escolha **Este Firefox**.
3. Clique em **Carregar extensão temporária…**.
4. Selecione o arquivo `manifest.json` deste repositório.
5. Abra ou recarregue um site HTTP(S), espere pelo menos três segundos e clique no ícone da Análise de Raphael.

Como extensões temporárias são removidas quando o Firefox fecha, repita a instalação numa nova sessão. Depois de alterar o código, use **Recarregar** na mesma tela. Para usar em janela privada, confira em `about:addons` que a extensão tem permissão para rodar em janelas privadas.

O botão **Inspecionar** abre o console do background, onde as linhas `[bounce]` mostram a cadeia de navegação e os bounces detectados (ative o nível Debug no filtro do console).

## Score de privacidade

O popup dá a cada página uma nota de 0 a 100, calculada em `lib/score.js` a partir do que a extensão observou desde a última navegação principal. Quanto maior, mais respeitosa com a privacidade.

### Fórmula

```
score = 100 − Σ min(peso × ocorrências, teto)
```

A página começa com 100 pontos. Cada critério tira `peso` pontos por ocorrência, até o `teto` daquele critério. Os tetos somam exatamente 100, então o score nunca fica negativo.

### Critérios, pesos e justificativas

| Critério | Peso | Teto | Justificativa |
| --- | --- | --- | --- |
| Domínio rastreador conhecido (lista Disconnect) | −4 | −20 | Coleta comportamental confirmada por uma lista pública e auditável. |
| Canvas fingerprint | −15 | −15 | Identifica o navegador sem cookie e sobrevive à limpeza de dados; uma ocorrência já atinge o teto. |
| Indicador de hijacking/hook | −5 | −15 | Pode interceptar o que o usuário digita ou envia, ou manter um canal de controle do navegador. |
| Cookie de 3ª parte persistente | −2 | −15 | Permite reconhecer o mesmo navegador em sites diferentes ao longo do tempo. |
| Cookie sync ou bounce tracking | −5 | −10 | Duas empresas trocam ou reconstroem o identificador do usuário. |
| 3ª parte não rastreadora | −1 | −10 | Recebe o IP e, em geral, o Referer, mesmo fora de listas de rastreadores. |
| Storage HTML5 em frame de 3ª parte | −2 | −10 | Identificador persistente fora dos cookies, que escapa de quem só limpa cookies. |
| Parâmetro de rastreio na URL | −1 | −5 | Identificador de campanha ou clique na própria URL; é o sinal mais fraco. |

**Por que esses pesos:** o peso cresce com o quanto a técnica é invasiva e difícil de evitar. Fingerprint e hijacking não dependem de cookies e não somem quando o usuário limpa o navegador, então pesam mais por ocorrência. Um terceiro sem rastreador conhecido só expõe IP e Referer, então pesa −1.

**Por que tetos:** sem teto, um único critério muito repetido (por exemplo, 40 domínios de terceiros) zeraria a nota sozinho e esconderia os outros. Com teto, cada critério tem um peso máximo fixo na nota final, e dá para ler no detalhamento de onde vieram os pontos perdidos.

### Notas

| Nota | Faixa |
| --- | --- |
| A | 85–100 |
| B | 70–84 |
| C | 50–69 |
| D | 30–49 |
| F | 0–29 |

### Exemplo de cálculo

Uma página hipotética com 3 rastreadores conhecidos, 1 leitura de canvas após desenho de texto, 4 cookies de 3ª parte persistentes, 6 terceiros não rastreadores e 1 parâmetro `utm_source` na URL:

| Critério | Conta | Penalidade |
| --- | --- | --- |
| Rastreadores | min(4 × 3, 20) | −12 |
| Canvas | min(15 × 1, 15) | −15 |
| Cookies de 3ª persistentes | min(2 × 4, 15) | −8 |
| 3ª parte não rastreadora | min(1 × 6, 10) | −6 |
| Parâmetro de rastreio | min(1 × 1, 5) | −1 |

`score = 100 − (12 + 15 + 8 + 6 + 1) = 58`, nota **C**. A aba **Score** do popup mostra essa mesma tabela para a página aberta: ocorrências e penalidade de cada critério.

Os detalhes de contagem (o que é um "indicador de hijacking", como cookies repetidos são tratados) e as limitações do método estão em [docs/metodologia-score.md](docs/metodologia-score.md).

## Lista de bloqueio

A lista fica em `browser.storage.local` e guarda domínios base (`sub.exemplo.com` vira `exemplo.com`). Uma requisição é cancelada quando o domínio base dela está na lista **e** ela é de terceiro em relação à página. Páginas principais nunca são bloqueadas, e listar o domínio de um site não quebra o próprio site. Há duas formas de editar a lista: o botão **Bloquear/Desbloquear** na aba Rastreadores e a aba **Minha lista**.

## Dados e metodologia

`lib/trackers.json` é uma cópia derivada de `services.json` do projeto [Disconnect Tracking Protection](https://github.com/disconnectme/disconnect-tracking-protection), obtida em 24 de setembro de 2026. A origem informa licença CC BY-NC-SA 4.0; os metadados da cópia ficam no próprio JSON.

O domínio base (eTLD+1) é calculado com a lista fixa de sufixos `com`, `com.br`, `edu.br`, `gov.br`, `org.br` e `net.br`, pois os sites analisados são brasileiros. Essa é uma simplificação intencional: outros sufixos estrangeiros de duas partes, como `co.uk`, não são tratados e seguem a regra geral das duas últimas partes.

Os relatórios ficam somente na memória do processo de background e são eliminados quando a aba fecha ou a extensão é descarregada. O conteúdo armazenado pelos sites não é enviado ao popup, que mostra apenas contagens e nomes. A única leitura de `document.cookie` no content script verifica se existe um cookie chamado `BEEFHOOK` e envia só verdadeiro ou falso.

## Estrutura

- `manifest.json`: Manifest V2 e permissões da extensão;
- `background.js`: relatório por aba, observação de rede, bounce, hijacking, bloqueio e badge;
- `content.js`: hooks de storage, canvas e `document.cookie` e comparação de APIs globais por frame;
- `lib/domains.js`: cálculo de domínio base e comparação de terceiros;
- `lib/score.js`: score de privacidade e lista de indicadores de hijacking;
- `lib/trackers.json`: domínios derivados da Disconnect;
- `popup/`: interface do relatório;
- `docs/metodologia-score.md`: critérios, pesos, tetos e limitações do score;
- `docs/relatorio.md` e `docs/relatorio.pdf`: relatório da avaliação (testes do DuckDuckGo, sites reais e score);
- `tools/analisar_har.py`: resume um HAR em Markdown com a mesma regra de domínio e a mesma lista do plugin (`python tools/analisar_har.py <arquivo.har> <url>`);
- `tools/gerar_pdf.py`: gera o PDF do relatório com as imagens embutidas (requer `pip install markdown` e Chrome ou Edge);
- `icons/`: ícone da extensão;
- `evidencias/`: reservado para as evidências da avaliação.

## Verificação de desenvolvimento

Sem dependências ou build. Antes de cada commit, valide os arquivos JSON e execute `node --check` em cada arquivo JavaScript. No Firefox, use o botão **Inspecionar** da extensão em `about:debugging` para confirmar que não há erros no console.
