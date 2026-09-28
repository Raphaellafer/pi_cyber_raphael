#!/usr/bin/env python3
"""Gera docs/relatorio.pdf a partir de docs/relatorio.md, com as imagens embutidas.

Uso:
    python tools/gerar_pdf.py

Requer o pacote `markdown` (pip install markdown) e Google Chrome ou Microsoft
Edge instalados; o navegador é usado em modo headless para imprimir o HTML.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "docs" / "relatorio.md"
SAIDA = RAIZ / "docs" / "relatorio.pdf"

NAVEGADORES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "chromium", "msedge",
]

ESTILO = """
@page { size: A4; margin: 16mm 14mm; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: #18263b; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 15pt; margin: 20pt 0 8pt; border-bottom: 1px solid #c9d4e0; padding-bottom: 3pt; }
h2 { break-before: auto; }
h3 { font-size: 12pt; margin: 14pt 0 6pt; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 8pt; }
th, td { border: 1px solid #c9d4e0; padding: 4pt 5pt; vertical-align: top; text-align: left; }
th { background: #e8eef5; }
tr { break-inside: avoid; }
code { font-family: Consolas, monospace; font-size: 0.92em; background: #f0f3f7; padding: 0 2pt; overflow-wrap: anywhere; }
pre { background: #f0f3f7; padding: 6pt; }
img { display: block; max-width: 100%; max-height: 225mm; margin: 6pt auto 2pt; border: 1px solid #c9d4e0; break-inside: avoid; }
p:has(> img) { break-inside: avoid; margin: 0; }
p:has(> img) + p { text-align: center; font-size: 8pt; color: #526178; margin: 0 0 12pt; }
hr { border: 0; border-top: 1px solid #c9d4e0; margin: 16pt 0; }
"""


def navegador():
    for candidato in NAVEGADORES:
        if os.path.isfile(candidato) or shutil.which(candidato):
            return candidato
    sys.exit("Chrome ou Edge não encontrado.")


def main():
    texto = ENTRADA.read_text(encoding="utf-8")
    corpo = markdown.markdown(texto, extensions=["tables", "fenced_code", "sane_lists"])
    # As imagens usam caminhos relativos a docs/; o HTML fica em docs/ para resolvê-los.
    html = (f"<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'>"
            f"<title>Relatório</title><style>{ESTILO}</style></head><body>{corpo}</body></html>")
    with tempfile.NamedTemporaryFile("w", suffix=".html", dir=ENTRADA.parent,
                                     delete=False, encoding="utf-8") as arquivo:
        arquivo.write(html)
        html_path = Path(arquivo.name)
    try:
        subprocess.run([navegador(), "--headless", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={SAIDA}", html_path.as_uri()],
                       check=True, capture_output=True, timeout=180)
    finally:
        html_path.unlink(missing_ok=True)
    print(f"PDF gerado: {SAIDA} ({SAIDA.stat().st_size / 1_048_576:.1f} MB)")


if __name__ == "__main__":
    main()
