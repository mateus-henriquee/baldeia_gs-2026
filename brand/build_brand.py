"""Gera os arquivos da marca Baldeia (SVG vetorial, texto convertido em curvas) e PNGs.

Conceito: o "b" minúsculo é um mapa de transporte — a haste é uma linha (tinta),
o bojo é outra linha (sinal) e o ponto de encontro é uma estação de baldeação.

Uso: python brand/build_brand.py   (requer fonttools; usa a Poppins do node_modules)
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "brand"
WEB = ROOT / "apps/web/public/brand"
FONT = ROOT / "node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff"

INK, SIGNAL, PAPER, WHITE = "#101418", "#FF4D2E", "#F6F3EC", "#FFFFFF"


def symbol(stem: str, bowl: str, node_fill: str, node_stroke: str, x: float = 0, y: float = 0, s: float = 1) -> str:
    """Símbolo em grade 64×64."""
    return (f'<g transform="translate({x} {y}) scale({s})">'
            f'<path d="M19 29 H29 A11 11 0 0 1 29 51 H19" stroke="{bowl}" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
            f'<path d="M19 8 V51" stroke="{stem}" stroke-width="8.5" stroke-linecap="round" fill="none"/>'
            f'<circle cx="19" cy="29" r="6.6" fill="{node_fill}" stroke="{node_stroke}" stroke-width="3.4"/>'
            f'</g>')


def wordmark(text: str, size: float, x: float, baseline: float, color: str, dot_color: str | None) -> tuple[str, float]:
    font = TTFont(str(FONT))
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    upm = font["head"].unitsPerEm
    scale = size / upm
    hmtx = font["hmtx"]
    paths, cursor = [], 0.0
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x + cursor * scale, baseline))
        if ch == "i" and dot_color:
            # desenha o "ı" (sem pingo) e um pingo circular na cor de sinal
            gs[cmap.get(0x0131, name)].draw(tpen)
            adv = hmtx[name][0]
            cx = x + (cursor + adv / 2) * scale
            paths.append(f'<path d="{pen.getCommands()}" fill="{color}"/>')
            paths.append(f'<circle cx="{cx:.2f}" cy="{baseline - size * 0.72:.2f}" r="{size * 0.085:.2f}" fill="{dot_color}"/>')
        else:
            gs[name].draw(tpen)
            paths.append(f'<path d="{pen.getCommands()}" fill="{color}"/>')
        cursor += hmtx[name][0]
    return "".join(paths), cursor * scale


def svg(w: float, h: float, body: str, title: str, bg: str | None = None) -> str:
    rect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{rect}{body}</svg>\n')


def horizontal(stem, bowl, node_fill, node_stroke, text, dot, bg=None) -> str:
    words, width = wordmark("baldeia", 52, 70, 51, text, dot)
    return svg(70 + width + 8, 64, symbol(stem, bowl, node_fill, node_stroke) + words, "Baldeia", bg)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    files = {
        "baldeia-simbolo.svg": svg(64, 64, symbol(INK, SIGNAL, WHITE, INK), "Baldeia — símbolo"),
        "baldeia-simbolo-app.svg": svg(64, 64, '<rect width="64" height="64" rx="16" fill="#101418"/>'
                                       + symbol(WHITE, SIGNAL, INK, WHITE, 4, 3, 0.88), "Baldeia — ícone de app"),
        "baldeia-horizontal.svg": horizontal(INK, SIGNAL, WHITE, INK, INK, SIGNAL),
        "baldeia-horizontal-negativo.svg": horizontal(WHITE, SIGNAL, INK, WHITE, WHITE, SIGNAL, bg=INK),
        "baldeia-mono-escuro.svg": horizontal(INK, INK, WHITE, INK, INK, INK),
        "baldeia-mono-claro.svg": horizontal(WHITE, WHITE, INK, WHITE, WHITE, WHITE, bg=INK),
    }
    WEB.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (OUT / name).write_text(content, encoding="utf-8")
        shutil.copy(OUT / name, WEB / name)
    shutil.copy(OUT / "baldeia-simbolo-app.svg", ROOT / "apps/web/public/favicon.svg")
    if shutil.which("rsvg-convert"):
        for name, w in (("baldeia-horizontal.svg", 1200), ("baldeia-simbolo-app.svg", 512), ("baldeia-simbolo.svg", 512)):
            subprocess.run(["rsvg-convert", "-w", str(w), str(OUT / name), "-o", str(OUT / name.replace(".svg", ".png"))], check=True)
    print("Marca gerada:", ", ".join(files))


if __name__ == "__main__":
    main()
