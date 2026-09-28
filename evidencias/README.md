# Evidências

Prints, arquivos HAR e resultados exportados usados no relatório (`docs/relatorio.md`).

Ambiente de coleta: Firefox 156.0.1 no Windows 11, janela privada limpa, proteção aprimorada contra rastreamento em **Padrão**, extensão carregada por `about:debugging` e lista de bloqueio vazia (exceto na rodada "com bloqueio" do teste de Tracker Blocking).

## `ddg/`: DuckDuckGo Privacy Test Pages

| Arquivos | Teste |
| --- | --- |
| `tracker-reporting-01..05-*.png` | Tracker Reporting: script, surrogate, img, document fragment, fetch |
| `storage-blocking-*.png` | Storage blocking (página, popup logo após o clique e popup após F5) |
| `canvas-*.png` | Fingerprinting / canvas (página completa e popup) |
| `request-blocking-*.png`, `request-blocking-results-*.json` | Tracker Blocking, sem e com `third-party.site` na lista de bloqueio |
| `storage-partitioning-*.png`, `storage-partitioning-results.json` | Storage partitioning |
| `bounce-01-primeira-visita.png` | Bounce tracking ("Go to first-party.site", 1ª visita) |
| `query-parameters-*.png` | Query parameters (links 1, 3 e 4) |
| `js-leaks-*.png` | JS leaks (página e popup) |

## `adidas/`, `nike/`, `on/`: sites reais

Cada pasta segue o mesmo padrão:

| Arquivo | Conteúdo |
| --- | --- |
| `<site>.har` | Tráfego completo da visita, exportado do DevTools (aba Rede, "Manter registros" e "Desativar cache") |
| `har-resumo.md` | Saída de `python tools/analisar_har.py <site>.har <url>` |
| `plugin-*.png` | Popup do plugin na mesma visita do HAR: resumo, rastreadores, cookies, storage, alertas, score |
| `blacklight.png` ou `blacklight.pdf` | Relatório do Blacklight (The Markup) para a mesma URL |
| `ublock-*.png` | uBlock Origin (com o plugin desativado): contagem no popup e logger com os bloqueios |

Na visita dos sites reais, o banner de cookies **não** foi aceito nem rejeitado, nos três sites.
