# Análise de Raphael

Análise de Raphael é uma extensão experimental para Firefox criada para uma avaliação de Cibersegurança. Nesta primeira etapa, ela observa a atividade de privacidade da aba atual sem bloquear ou modificar requisições.

## Funcionalidades desta etapa

- agrupa requisições de terceiros por domínio, quantidade e tipo;
- compara o domínio base (eTLD+1) usando uma lista fixa de sufixos voltada aos sites brasileiros analisados;
- identifica domínios presentes na lista pública Disconnect Tracking Protection;
- conta headers `Set-Cookie` recebidos pela aba;
- mede itens de `localStorage` e `sessionStorage` no evento `load` e três segundos depois, em cada frame;
- mede bancos IndexedDB quando `indexedDB.databases()` está disponível e observa chamadas a `open` e `deleteDatabase` desde `document_start`;
- mostra o relatório no popup e o reinicia a cada navegação principal confirmada.

O contador de cookies representa headers recebidos. Políticas do navegador podem rejeitar esses cookies, portanto o número não equivale necessariamente aos cookies gravados. A classificação detalhada de cookies pertence à próxima etapa.

## Instalação temporária

1. Abra `about:debugging` no Firefox.
2. Escolha **Este Firefox**.
3. Clique em **Carregar extensão temporária…**.
4. Selecione o arquivo `manifest.json` deste repositório.
5. Abra ou recarregue um site HTTP(S), espere pelo menos três segundos e clique no ícone da Análise de Raphael.

Como extensões temporárias são removidas quando o Firefox fecha, repita a instalação numa nova sessão.

## Dados e metodologia

`lib/trackers.json` é uma cópia derivada de `services.json` do projeto [Disconnect Tracking Protection](https://github.com/disconnectme/disconnect-tracking-protection), obtida em 24 de setembro de 2026. A origem informa licença CC BY-NC-SA 4.0; os metadados da cópia ficam no próprio JSON.

O domínio base (eTLD+1) é calculado com a lista fixa de sufixos `com`, `com.br`, `edu.br`, `gov.br`, `org.br` e `net.br`, pois os sites analisados são brasileiros. Essa é uma simplificação intencional: outros sufixos estrangeiros de duas partes, como `co.uk`, não são tratados e seguem a regra geral das duas últimas partes.

Os relatórios ficam somente na memória do processo de background e são eliminados quando a aba fecha ou a extensão é descarregada. O conteúdo armazenado pelos sites não é lido: o popup mostra apenas contagens.

## Estrutura

- `manifest.json`: Manifest V2 e permissões da extensão;
- `background.js`: relatório por aba e observação de rede;
- `content.js`: medição de storage por frame;
- `lib/domains.js`: cálculo de domínio base e comparação de terceiros;
- `lib/trackers.json`: domínios derivados da Disconnect;
- `popup/`: interface do relatório;
- `icons/`: ícone da extensão;
- `evidencias/`: reservado para as evidências da avaliação.

## Verificação de desenvolvimento

Sem dependências ou build. Antes de cada commit, valide os arquivos JSON e execute `node --check` em cada arquivo JavaScript. No Firefox, use o botão **Inspecionar** da extensão em `about:debugging` para confirmar que não há erros no console.
