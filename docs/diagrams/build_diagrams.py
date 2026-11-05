"""Gera os diagramas técnicos da Baldeia (SVG + PNG).

Fonte editável: este script (layout e conteúdo) + os .mmd (Mermaid) ao lado.
O ERD é lido diretamente de database/migrations/001_schema.sql — se o schema mudar,
basta rodar `npm run diagrams` para atualizar a imagem.

Saídas: apps/web/public/assets/diagrams/*.svg|png
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/web/public/assets/diagrams"
SCHEMA = ROOT / "database/migrations/001_schema.sql"
MANIFEST = ROOT / "data/gold/sptrans_gtfs_amostra/_manifest.json"

INK, MUTED, LINE, PAPER, WHITE = "#101418", "#5B6270", "#C9CDD5", "#F6F3EC", "#FFFFFF"
SIGNAL = "#FF4D2E"
CAT = {  # categorias de fonte
    "oficial": ("#2B59C3", "#E3EBFB"), "geografica": ("#16805A", "#DDF3E8"),
    "comunitaria": ("#D9431F", "#FFE6DE"), "comportamental": ("#6B4BD1", "#ECE6FB"), "demonstrativa": ("#6B7280", "#EEEFF2"),
}
LAYER = {"bronze": ("#A8642B", "#F7E8D8"), "silver": ("#5F6B7E", "#ECEFF4"), "gold": ("#9C7A06", "#FBF0C9")}
FONT = "Poppins, 'Segoe UI', Arial, sans-serif"


class Canvas:
    def __init__(self, w: int, h: int, title: str, desc: str):
        self.w, self.h, self.title, self.desc = w, h, title, desc
        self.parts: list[str] = []

    def add(self, s: str) -> None:
        self.parts.append(s)

    def text(self, x, y, s, size=13, weight=400, color=INK, anchor="start", italic=False) -> None:
        st = ' font-style="italic"' if italic else ""
        self.add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}"{st}>{escape(s)}</text>')

    def box(self, x, y, w, h, title, lines=(), fill=WHITE, stroke=INK, title_color=INK, rx=14, sid=None, dashed=False,
            badge=None, badge_color=SIGNAL, size=12.5, title_size=15, sw=1.6) -> None:
        dash = ' stroke-dasharray="6 5"' if dashed else ""
        gid = f' id="{sid}" class="step" data-step="{sid}" tabindex="0"' if sid else ""
        self.add(f'<g{gid}><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>')
        self.text(x + 16, y + 26, title, title_size, 600, title_color)
        for i, ln in enumerate(lines):
            self.text(x + 16, y + 48 + i * (size + 6.5), ln, size, 400, MUTED if not ln.startswith("•") else INK)
        if badge:
            bw = 9 + len(badge) * 6.6
            self.add(f'<rect x="{x + w - bw - 10}" y="{y + 10}" width="{bw}" height="20" rx="10" fill="{badge_color}"/>')
            self.text(x + w - bw / 2 - 10, y + 24, badge, 10.5, 600, WHITE, "middle")
        self.add("</g>")

    def arrow(self, pts, color=INK, dashed=False, label=None, lx=None, ly=None, width=1.8, marker="a") -> None:
        d = "M" + " L".join(f"{x} {y}" for x, y in pts)
        dash = ' stroke-dasharray="6 5"' if dashed else ""
        self.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dash} marker-end="url(#{marker})"/>')
        if label:
            mx, my = (lx, ly) if lx is not None else ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2 - 7)
            tw = len(label) * 6.1 + 12
            self.add(f'<rect x="{mx - tw / 2}" y="{my - 13}" width="{tw}" height="18" rx="9" fill="{PAPER}"/>')
            self.text(mx, my, label, 11, 500, MUTED, "middle")

    def svg(self) -> str:
        defs = (f'<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0 0 L10 5 L0 10 z" fill="{INK}"/></marker>'
                f'<marker id="s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0 0 L10 5 L0 10 z" fill="{SIGNAL}"/></marker>'
                f'<marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0 0 L10 5 L0 10 z" fill="{MUTED}"/></marker>'
                f'<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
                f'<rect width="8" height="8" fill="#F1F2F4"/><line x1="0" y1="0" x2="0" y2="8" stroke="#D5D8DE" stroke-width="3"/></pattern></defs>')
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}" '
                f'role="img" aria-labelledby="t d" font-family="{FONT}"><title id="t">{escape(self.title)}</title>'
                f'<desc id="d">{escape(self.desc)}</desc>{defs}<rect width="{self.w}" height="{self.h}" fill="{PAPER}"/>'
                + "".join(self.parts) + "</svg>\n")


def legend(c: Canvas, x, y, items) -> None:
    for i, (color, label, dashed) in enumerate(items):
        xx = x + i * 190
        dash = ' stroke-dasharray="5 4"' if dashed else ""
        c.add(f'<rect x="{xx}" y="{y - 11}" width="22" height="14" rx="4" fill="{WHITE}" stroke="{color}" stroke-width="2"{dash}/>')
        c.text(xx + 30, y, label, 11.5, 500, MUTED)


# ---------------------------------------------------------------- 1. PIPELINE
def pipeline() -> Canvas:
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    q = m["qualidade"]
    c = Canvas(1480, 900, "Pipeline de dados da Baldeia",
               "Fluxo das fontes à apresentação: ingestão, camadas Bronze, Silver e Gold, armazenamento, análise, algoritmos, recomendações, apresentação, feedback e monitoramento.")
    c.text(40, 52, "Pipeline de dados — da fonte à decisão", 26, 700)
    c.text(40, 80, f"Versão do dataset: {m['dataset_version']} · {q['total_checks']} verificações de qualidade · tempos medidos na última execução", 13, 400, MUTED)

    # 1 Fontes
    c.box(40, 110, 270, 470, "1 · Fontes", sid="fontes", fill=WHITE)
    srcs = [("oficial", "GTFS SPTrans (amostra)", "integrada · histórica", False),
            ("oficial", "GTFS completo / Olho Vivo", "planejada · requer cadastro", True),
            ("geografica", "OpenStreetMap (tiles)", "integrada · ODbL", False),
            ("comunitaria", "Relatos da comunidade", "integrada · não verificados", False),
            ("comportamental", "Uso da plataforma", "integrada · com consentimento", False),
            ("comportamental", "Geolocalização", "só no aparelho · não enviada", False)]
    for i, (cat, name, sub, dashed) in enumerate(srcs):
        col, bg = CAT[cat]
        y = 150 + i * 70
        c.add(f'<rect x="56" y="{y}" width="238" height="56" rx="10" fill="{bg}" stroke="{col}" stroke-width="1.6"{" stroke-dasharray=\"6 5\"" if dashed else ""}/>')
        c.text(70, y + 24, name, 13, 600, INK)
        c.text(70, y + 43, sub, 11.5, 500, col)

    e = {x["etapa"]: x for x in m["etapas"]}
    # 2 Ingestão + 3 Bronze
    c.box(350, 110, 250, 150, "2 · Ingestão", ["bronze.py", "• cópia íntegra + SHA-256", "• horário, origem, nº de linhas", f"• {e['ingestao_bronze']['duracao_ms']:.0f} ms"], sid="ingestao")
    lb, lbg = LAYER["bronze"]
    c.box(350, 290, 250, 170, "3 · Bronze (bruto)", ["data/bronze/<fonte>/<job>/", "• raw.zip + .txt originais", "• _ingestion.json", "• imutável: permite reprocessar"],
          fill=lbg, stroke=lb, title_color=lb, sid="bronze")
    ls, lsbg = LAYER["silver"]
    c.box(640, 110, 290, 350, "4–5 · Silver (limpo e validado)", [
        "silver.py", "• remove duplicadas e PK repetidas", "• tipa coordenadas e horários (>24h)", "• valida domínios (route_type, cores)",
        "• integridade referencial (FK)", "• vigência do calendário", "• alerta: fora da RMSP", "",
        f"{q['total_checks']} regras · {q['by_status'].get('aprovado_com_ressalvas', 0)} com ressalvas", f"{e['tratamento_silver']['duracao_ms']:.0f} ms"],
        fill=lsbg, stroke=ls, title_color=ls, sid="silver")
    c.box(640, 490, 290, 90, "Quarentena", ["_quarentena/<tabela>.csv", "nada é descartado sem motivo"], fill="url(#hatch)", stroke=ls, dashed=True, sid="quarentena")
    lg, lgbg = LAYER["gold"]
    c.box(970, 110, 300, 350, "6 · Gold (integrado)", [
        "gold.py", "• trechos parada→parada", "  (tempo, distância, velocidade)", "• conexões a pé ≤ 400 m",
        "• traçados simplificados (Douglas–Peucker)", "• imputação sinalizada", "• anomalias: z-score robusto", "",
        "_manifest.json = linhagem", f"{e['integracao_gold']['duracao_ms']:.0f} ms"],
        fill=lgbg, stroke=lg, title_color=lg, sid="gold")
    c.box(1310, 110, 140, 350, "7 · Banco", ["armazena-", "mento", "", "PostgreSQL", "(PGlite local)", "", "loadGold.ts", "versão ativa", "", "PostGIS", "opcional"], sid="armazenamento")

    # linha 2
    c.box(1110, 640, 340, 150, "8 · Análise", ["analysis.py + views SQL", "• estatística descritiva", "• oferta planejada por hora", "• agregados com k-anonimato (k=3)"], sid="analise")
    c.box(730, 640, 340, 150, "9 · Modelos e algoritmos", ["planner.ts · trust.ts", "• Dijkstra multicritério por horário", "• confiança de relatos (regras)", "• sem ML: dados insuficientes"], sid="algoritmos")
    c.box(390, 640, 300, 150, "10 · Recomendações", ["alternativas + motivos", "• mais rápida, menos baldeações…", "• critério sem dados = avisado", "• tabela recommendations"], sid="recomendacoes")
    c.box(40, 640, 310, 150, "11 · Apresentação", ["planejador, mapa, alertas,", "navegação, relatórios", "• origem do dado sempre visível", "• demo sempre rotulado"], sid="apresentacao")
    c.box(40, 820, 1410, 56, "12 · Feedback e monitoramento", [], fill="#FFF4EF", stroke=SIGNAL, title_color=SIGNAL, sid="monitoramento")
    c.text(370, 853, "útil/não útil · quality_checks por versão · ingestion_jobs · latência p50/p95 · denúncias e moderação · retenção automática", 12.5, 500, MUTED)

    # setas
    c.arrow([(310, 185), (350, 185)])
    c.arrow([(475, 260), (475, 290)])
    c.arrow([(600, 375), (640, 375)], label="valida", lx=620, ly=362)
    c.arrow([(785, 460), (785, 490)], color=MUTED, dashed=True, marker="m")
    c.arrow([(930, 285), (970, 285)], label="integra", lx=950, ly=272)
    c.arrow([(1270, 285), (1310, 285)])
    c.arrow([(1380, 460), (1380, 640)], label="SQL", lx=1380, ly=560)
    c.arrow([(1110, 715), (1070, 715)])
    c.arrow([(730, 715), (690, 715)])
    c.arrow([(390, 715), (350, 715)])
    c.arrow([(195, 790), (195, 820)], color=SIGNAL, marker="s")
    c.arrow([(1300, 820), (1300, 800), (1300, 790)], color=SIGNAL, marker="s")
    c.arrow([(700, 820), (700, 805), (785, 805), (785, 790)], color=SIGNAL, marker="s")
    c.add(f'<path d="M40 848 H20 V140 H40" fill="none" stroke="{SIGNAL}" stroke-width="1.8" stroke-dasharray="6 5" marker-end="url(#s)"/>')
    c.add(f'<text x="0" y="0" transform="translate(15 500) rotate(-90)" font-size="11" font-weight="600" fill="{SIGNAL}" text-anchor="middle">reprocessa</text>')
    legend(c, 360, 610, [(LAYER["bronze"][0], "Bronze: como chegou", False), (LAYER["silver"][0], "Silver: tratado", False),
                         (LAYER["gold"][0], "Gold: pronto p/ uso", False), (MUTED, "planejado/quarentena", True)])
    return c


# ---------------------------------------------------------------- 2. DFD
def dfd() -> Canvas:
    c = Canvas(1480, 1010, "Diagrama de fluxo de dados (DFD) da Baldeia",
               "Entidades externas, processos, depósitos de dados, limites de confiança e fluxos com dados pessoais.")
    c.text(40, 52, "Fluxo de dados (DFD) e limites de confiança", 26, 700)
    c.text(40, 80, "Retângulos = entidades externas · cantos arredondados = processos · barras = depósitos · tracejado = limite de confiança · ● DP = dado pessoal", 13, 400, MUTED)

    def zone(x, y, w, h, label, color):
        c.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" fill="none" stroke="{color}" stroke-width="2" stroke-dasharray="10 7"/>')
        c.add(f'<rect x="{x + 20}" y="{y - 12}" width="{len(label) * 7.6 + 20}" height="24" rx="12" fill="{PAPER}"/>')
        c.text(x + 30, y + 5, label, 12.5, 700, color)

    def entity(x, y, w, h, title, sub):
        c.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{WHITE}" stroke="{INK}" stroke-width="2.2"/>')
        c.text(x + w / 2, y + h / 2 - 2, title, 14, 600, INK, "middle")
        c.text(x + w / 2, y + h / 2 + 17, sub, 11, 400, MUTED, "middle")

    def process(x, y, w, h, n, title, lines):
        c.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="26" fill="{WHITE}" stroke="{INK}" stroke-width="1.6"/>')
        c.add(f'<line x1="{x}" y1="{y + 34}" x2="{x + w}" y2="{y + 34}" stroke="{LINE}"/>')
        c.text(x + 18, y + 23, f"P{n}", 12, 700, SIGNAL)
        c.text(x + 48, y + 23, title, 13.5, 600, INK)
        for i, ln in enumerate(lines):
            c.text(x + 18, y + 54 + i * 17, ln, 11.5, 400, MUTED)

    def store(x, y, w, n, title, personal=False):
        c.add(f'<path d="M{x} {y} H{x + w} M{x} {y + 34} H{x + w} M{x} {y} V{y + 34}" stroke="{INK}" stroke-width="1.8" fill="none"/>')
        c.add(f'<rect x="{x}" y="{y}" width="{w}" height="34" fill="{WHITE}" opacity="0.6"/>')
        c.text(x + 10, y + 22, f"D{n}", 11.5, 700, MUTED)
        c.text(x + 38, y + 22, title, 12.5, 600, INK)
        if personal:
            c.add(f'<circle cx="{x + w - 16}" cy="{y + 17}" r="6" fill="{SIGNAL}"/>')

    zone(30, 120, 330, 820, "Dispositivo do usuário", "#2B59C3")
    zone(400, 120, 720, 820, "Servidor Baldeia (API + PostgreSQL)", INK)
    zone(1160, 120, 290, 520, "Ambiente de dados (pipeline)", LAYER["gold"][0])
    zone(1160, 690, 290, 250, "Terceiros", "#16805A")

    entity(70, 170, 250, 70, "Usuário", "passageiro(a)")
    process(70, 300, 250, 120, 0, "Interface web", ["React · sessão em cookie", "httpOnly; navegação offline", "em localStorage"])
    entity(70, 480, 250, 70, "Geolocalização", "API do navegador, sob permissão")
    c.add(f'<rect x="70" y="600" width="250" height="110" rx="14" fill="#E3EBFB" stroke="#2B59C3"/>')
    c.text(86, 628, "Fica no aparelho", 13, 700, "#2B59C3")
    for i, t in enumerate(["coordenadas GPS (nunca enviadas)", "viagem em andamento (offline)", "só a parada confirmada sobe"]):
        c.text(86, 652 + i * 18, "• " + t, 11.5, 500, INK)
    entity(70, 760, 250, 70, "Comunidade", "usuários que reportam")

    process(440, 160, 300, 130, 1, "Autenticação e consentimento", ["bcrypt · JWT · limites de tentativa", "consentimento por finalidade", "(log append-only)"])
    process(780, 160, 300, 130, 2, "Planejamento de rotas", ["grafo em memória (Gold)", "Dijkstra multicritério", "explica fatores e limitações"])
    store(440, 320, 300, 1, "Contas, preferências, consentimentos", True)
    store(780, 320, 300, 2, "Viagens e recomendações", True)
    store(780, 376, 300, 4, "Rede de transporte (referência)")
    process(440, 440, 300, 130, 3, "Comunidade e confiança", ["remove dados pessoais do texto", "apoio × frescor; teto 0,85", "denúncia → moderação"])
    process(780, 440, 300, 130, 4, "Privacidade e titular", ["exportar (JSON), revogar,", "excluir conta (anonimiza relatos)", "retenção automática"])
    store(440, 600, 300, 3, "Relatos, votos e denúncias", True)
    store(440, 660, 300, 6, "Auditoria (IP só como hash)", True)
    store(780, 660, 300, 5, "Linhagem e qualidade (versões)")
    process(440, 740, 640, 100, 5, "Análise agregada e monitoramento", ["k-anonimato (k=3) em agregados de relatos · métricas de latência · feedback das recomendações",
                                                                         "Sem venda ou compartilhamento de dados pessoais"])

    entity(1190, 160, 230, 70, "Fontes oficiais", "SPTrans (GTFS)")
    process(1190, 270, 230, 130, 6, "Pipeline (Python)", ["Bronze → Silver → Gold", "quarentena + relatório", "_manifest.json"])
    store(1190, 440, 230, 7, "Arquivos Bronze/Silver/Gold")
    c.text(1305, 530, "Olho Vivo · EMTU · Metrô:", 11.5, 500, MUTED, "middle")
    c.text(1305, 548, "planejadas", 11.5, 500, MUTED, "middle")
    entity(1190, 730, 230, 70, "OpenStreetMap", "tiles do mapa (ODbL)")
    c.add(f'<rect x="1190" y="840" width="230" height="70" fill="{WHITE}" stroke="{MUTED}" stroke-width="1.8" stroke-dasharray="6 5"/>')
    c.text(1305, 870, "Overpass / Olho Vivo", 13, 600, MUTED, "middle")
    c.text(1305, 889, "planejadas", 11, 400, MUTED, "middle")

    pd = SIGNAL
    c.arrow([(195, 240), (195, 300)], label="cliques", lx=195, ly=272)
    c.arrow([(320, 205), (440, 205)], color=pd, marker="s", label="● e-mail, senha", lx=380, ly=196)
    c.arrow([(320, 305), (760, 305), (760, 225), (780, 225)], color=pd, marker="s", label="● origem/destino, horário", lx=560, ly=300)
    c.arrow([(195, 480), (195, 420)], label="lat/lon (local)", lx=195, ly=455)
    c.arrow([(320, 795), (375, 795), (375, 505), (440, 505)], color=pd, marker="s", label="● relato + parada", lx=377, ly=660)
    c.arrow([(590, 290), (590, 320)], color=pd, marker="s")
    c.arrow([(930, 290), (930, 320)], color=pd, marker="s")
    c.text(944, 312, "● só com consentimento", 11, 500, SIGNAL)
    c.arrow([(590, 570), (590, 600)], color=pd, marker="s")
    c.arrow([(780, 505), (740, 505)], label="anonimiza", lx=760, ly=490)
    c.arrow([(1080, 390), (1100, 390), (1100, 225), (1080, 225)], label="grafo", lx=1100, ly=300)
    c.arrow([(1305, 230), (1305, 270)])
    c.arrow([(1305, 400), (1305, 440)])
    c.arrow([(1190, 457), (1140, 457), (1140, 405), (1080, 405)], label="carga Gold", lx=1140, ly=440)
    c.arrow([(1140, 457), (1140, 677), (1080, 677)], label="versão", lx=1140, ly=600)
    c.arrow([(1190, 765), (1150, 765), (1150, 875), (345, 875), (345, 420), (320, 420)], color="#16805A", label="imagens do mapa (com Referer)", lx=760, ly=870)
    c.arrow([(760, 694), (760, 740)], color=MUTED, marker="m", label="lê", lx=760, ly=720)
    legend(c, 440, 985, [(SIGNAL, "fluxo com dado pessoal", False), (INK, "fluxo sem dado pessoal", False), (MUTED, "planejado", True)])
    return c


# ---------------------------------------------------------------- 3. ERD
def parse_schema() -> dict[str, dict]:
    sql = SCHEMA.read_text(encoding="utf-8")
    tables: dict[str, dict] = {}
    for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
        name, body = m.group(1), m.group(2)
        cols, pks, fks = [], set(), {}
        for raw in body.split("\n"):
            line = raw.split("--")[0].strip().rstrip(",")
            if not line:
                continue
            if line.startswith("PRIMARY KEY"):
                pks |= {x.strip() for x in re.search(r"\((.*?)\)", line).group(1).split(",")}
                continue
            fk = re.match(r"FOREIGN KEY \((.*?)\) REFERENCES (\w+)", line)
            if fk:
                for col in fk.group(1).split(","):
                    fks.setdefault(col.strip(), fk.group(2))
                continue
            if re.match(r"(UNIQUE|CHECK)\b", line):
                continue
            # várias colunas booleanas na mesma linha (calendar_services)
            for part in re.split(r",\s*(?=[a-z_]+ boolean)", line):
                cm = re.match(r"([a-z_0-9]+)\s+([a-z]+(?:\(\d+(?:,\d+)?\))?(?:\[\])?(?: precision)?)", part)
                if not cm:
                    continue
                col, typ = cm.groups()
                cols.append({"name": col, "type": typ.replace(" precision", ""), "null": "NOT NULL" not in part and "PRIMARY KEY" not in part})
                if "PRIMARY KEY" in part:
                    pks.add(col)
                ref = re.search(r"REFERENCES (\w+)", part)
                if ref:
                    fks[col] = ref.group(1)
        tables[name] = {"cols": cols, "pk": pks, "fk": fks}
    return tables


ERD_LAYOUT = {  # (x, y, grupo)
    "data_sources": (40, 130, "gov"), "dataset_versions": (40, 400, "gov"), "ingestion_jobs": (300, 130, "gov"), "quality_checks": (300, 400, "gov"),
    "agencies": (600, 130, "rede"), "routes": (600, 290, "rede"), "route_shapes": (600, 580, "rede"), "service_alerts": (40, 690, "rede"),
    "trips": (860, 130, "rede"), "calendar_services": (860, 370, "rede"), "frequencies": (860, 700, "rede"),
    "stop_times": (1120, 130, "rede"), "route_segments": (1120, 330, "rede"), "stops": (1380, 130, "rede"), "stop_transfers": (1380, 430, "rede"),
    "users": (40, 1010, "user"), "user_preferences": (40, 1330, "user"), "user_consents": (300, 1330, "user"), "favorite_places": (300, 1010, "user"),
    "journeys": (600, 1010, "viagem"), "journey_legs": (860, 1010, "viagem"), "journey_checkpoints": (860, 1330, "viagem"), "recommendations": (600, 1360, "viagem"),
    "community_reports": (1120, 1010, "com"), "report_confirmations": (1380, 1010, "com"), "report_flags": (1380, 1230, "com"),
    "audit_logs": (1120, 1380, "aud"),
}
GROUPS = {"gov": ("Governança e linhagem", "#9C7A06"), "rede": ("Rede de transporte (Gold)", "#2B59C3"),
          "user": ("Usuários e consentimento", "#6B4BD1"), "viagem": ("Viagens e recomendações", "#16805A"),
          "com": ("Comunidade", "#D9431F"), "aud": ("Auditoria", "#5B6270")}
TW, ROW = 230, 19


def erd() -> Canvas:
    t = parse_schema()
    missing = set(t) - set(ERD_LAYOUT)
    assert not missing, f"Tabelas sem posição no ERD: {missing}"
    c = Canvas(1660, 1620, "Diagrama entidade-relacionamento (ERD) da Baldeia",
               f"{len(t)} tabelas lidas de database/migrations/001_schema.sql com chaves primárias, estrangeiras e cardinalidades.")
    c.text(40, 52, "Modelo de dados (ERD) — gerado a partir do schema SQL", 26, 700)
    c.text(40, 80, f"{len(t)} tabelas · PK = chave primária · FK = chave estrangeira · ● = dado pessoal · notação pé-de-galinha (1 ── N; ○ = opcional)", 13, 400, MUTED)
    personal = {"users", "user_preferences", "user_consents", "favorite_places", "journeys", "journey_legs", "journey_checkpoints",
                "recommendations", "community_reports", "report_confirmations", "report_flags", "audit_logs"}
    boxes: dict[str, tuple[float, float, float, dict[str, float]]] = {}
    max_rows = 12
    start = len(c.parts)
    for name, (x, y, g) in ERD_LAYOUT.items():
        info = t[name]
        cols = sorted(info["cols"], key=lambda col: (col["name"] not in info["pk"], col["name"] not in info["fk"]))
        shown = cols[:max_rows]
        h = 36 + ROW * len(shown) + (ROW if len(cols) > max_rows else 0) + 8
        color = GROUPS[g][1]
        c.add(f'<rect x="{x}" y="{y}" width="{TW}" height="{h}" rx="10" fill="{WHITE}" stroke="{color}" stroke-width="1.6"/>')
        c.add(f'<path d="M{x} {y + 10} Q{x} {y} {x + 10} {y} H{x + TW - 10} Q{x + TW} {y} {x + TW} {y + 10} V{y + 32} H{x} Z" fill="{color}"/>')
        c.text(x + 12, y + 22, name, 13, 600, WHITE)
        if name in personal:
            c.add(f'<circle cx="{x + TW - 16}" cy="{y + 16}" r="5" fill="{WHITE}"/>')
        rows: dict[str, float] = {}
        for i, col in enumerate(shown):
            yy = y + 36 + ROW * i + 13
            rows[col["name"]] = yy - 4
            tag = "PK" if col["name"] in info["pk"] else ("FK" if col["name"] in info["fk"] else "")
            if tag:
                c.text(x + 10, yy, tag, 9.5, 700, SIGNAL if tag == "PK" else color)
            c.text(x + 34, yy, col["name"] + ("?" if col["null"] and not tag == "PK" else ""), 11, 600 if tag else 400, INK)
            c.text(x + TW - 10, yy, col["type"], 10, 400, MUTED, "end")
        if len(cols) > max_rows:
            c.text(x + 34, y + 36 + ROW * max_rows + 13, f"+ {len(cols) - max_rows} atributos", 10.5, 400, MUTED, italic=True)
        boxes[name] = (x, y, h, rows)

    # grupos
    label_pos = {"gov": (40, 120), "rede": (600, 120), "user": (40, 1000), "viagem": (600, 1000), "com": (1120, 1000), "aud": (1120, 1370)}
    for g, (label, color) in GROUPS.items():
        c.text(*label_pos[g], label.upper(), 11, 700, color)
    rel_start = len(c.parts)

    # relações (pé-de-galinha)
    seen = set()
    for child, info in t.items():
        for col, parent in info["fk"].items():
            key = (child, parent, col)
            if key in seen or parent not in boxes:
                continue
            seen.add(key)
            cx, cy, ch, crow = boxes[child]
            px, py, ph, prow = boxes[parent]
            y1 = crow.get(col, cy + 20)
            pk = next(iter(t[parent]["pk"]), None)
            y2 = prow.get(pk, py + 20) if pk else py + 20
            if parent == child:
                continue
            # escolhe lados
            if px + TW < cx:
                x1, x2, d1, d2 = cx, px + TW, -1, 1
            elif cx + TW < px:
                x1, x2, d1, d2 = cx + TW, px, 1, -1
            else:
                x1, x2, d1, d2 = cx, px, -1, -1
            midx = (x1 + x2) / 2 if d1 != d2 else min(x1, x2) - 18
            nullable = next((cc["null"] for cc in info["cols"] if cc["name"] == col), False)
            color = "#8A93A3"
            c.add(f'<path d="M{x1} {y1} H{midx} V{y2} H{x2}" fill="none" stroke="{color}" stroke-width="1.2" opacity="0.85"/>')
            # lado "muitos" (filho): pé-de-galinha
            fx = x1 + d1 * 10
            c.add(f'<path d="M{x1} {y1 - 6} L{fx} {y1} L{x1} {y1 + 6}" fill="none" stroke="{color}" stroke-width="1.2"/>')
            if nullable:
                c.add(f'<circle cx="{x1 + d1 * 15}" cy="{y1}" r="3.5" fill="{WHITE}" stroke="{color}"/>')
            # lado "um" (pai): duas barras
            for k in (6, 10):
                c.add(f'<line x1="{x2 + d2 * k}" y1="{y2 - 6}" x2="{x2 + d2 * k}" y2="{y2 + 6}" stroke="{color}" stroke-width="1.2"/>')
    # relações por baixo das tabelas (não riscam o texto)
    c.parts = c.parts[:start] + c.parts[rel_start:] + c.parts[start:rel_start]
    return c


# ---------------------------------------------------------------- 4. GOVERNANÇA
def governance() -> Canvas:
    stages = ["Coleta", "Bronze", "Silver", "Gold", "API e banco", "Interface", "Descarte"]
    controls = [
        ("Qualidade", ["hash SHA-256", "nº de linhas", "regras por dimensão; quarentena", "imputação sinalizada; z robusto", "CHECK, FK, NOT NULL", "rótulos oficial/comunidade/demo", "—"]),
        ("Segurança", ["HTTPS (prod.)", "pasta fora do app", "—", "—", "bcrypt, JWT httpOnly, rate limit, CSP, origem", "sem segredos no cliente", "exclusão em cascata"]),
        ("Privacidade", ["minimização: parada, não GPS", "—", "—", "—", "consentimento por finalidade; k=3", "geolocalização só local", "anonimiza autoria de relatos"]),
        ("Metadados", ["catálogo de fontes", "_ingestion.json", "relatório de qualidade", "_manifest.json", "data_sources, dataset_versions", "página Transparência", "—"]),
        ("Linhagem", ["source_id", "job_id", "regras por versão", "dataset_version em cada carga", "FK para dataset_versions", "versão exibida na resposta", "—"]),
        ("Auditoria", ["ingestion_jobs", "imutável", "quality_checks", "carga registrada", "audit_logs (IP em hash)", "—", "log da retenção"]),
        ("Retenção", ["—", "manter p/ reprocessar", "substituída por versão", "versão ativa única", "viagens 180 d; texto 30 d", "localStorage limpável", "logs 365 d"]),
        ("Acesso", ["—", "engenharia de dados", "engenharia de dados", "leitura pela API", "papéis: usuário, moderador, admin", "cada um vê só o seu", "—"]),
    ]
    planned = {("Segurança", "Coleta"), ("Segurança", "Bronze")}
    c = Canvas(1520, 760, "Governança transversal ao pipeline",
               "Matriz de controles de qualidade, segurança, privacidade, metadados, linhagem, auditoria, retenção e acesso em cada etapa do ciclo de vida dos dados.")
    c.text(40, 52, "Governança transversal — controles em cada etapa", 26, 700)
    c.text(40, 80, "A governança atravessa todo o ciclo de vida, não é uma etapa final. Tracejado = depende de configuração de produção.", 13, 400, MUTED)
    x0, y0, lw, cw, rh = 40, 120, 150, 184, 70
    for j, s in enumerate(stages):
        x = x0 + lw + j * cw
        fill = {1: LAYER["bronze"][1], 2: LAYER["silver"][1], 3: LAYER["gold"][1]}.get(j, WHITE)
        c.add(f'<rect x="{x + 4}" y="{y0}" width="{cw - 8}" height="44" rx="22" fill="{fill}" stroke="{INK}" stroke-width="1.4"/>')
        c.text(x + cw / 2, y0 + 28, s, 14, 600, INK, "middle")
        if j < len(stages) - 1:
            c.arrow([(x + cw - 6, y0 + 22), (x + cw + 6, y0 + 22)])
    for i, (name, cells) in enumerate(controls):
        y = y0 + 64 + i * rh
        c.add(f'<rect x="{x0}" y="{y}" width="{lw + cw * len(stages)}" height="{rh - 8}" rx="12" fill="{WHITE if i % 2 == 0 else "#FBFAF7"}" stroke="{LINE}"/>')
        c.text(x0 + 16, y + rh / 2, name, 14, 700, SIGNAL if i == 2 else INK)
        for j, cell in enumerate(cells):
            x = x0 + lw + j * cw
            words, lines, cur = cell.split(), [], ""
            for w in words:
                if len(cur) + len(w) + 1 > 26:
                    lines.append(cur)
                    cur = w
                else:
                    cur = f"{cur} {w}".strip()
            lines.append(cur)
            if (name, stages[j]) in planned:
                c.add(f'<rect x="{x + 6}" y="{y + 6}" width="{cw - 12}" height="{rh - 20}" rx="8" fill="none" stroke="{MUTED}" stroke-dasharray="5 4"/>')
            for k, ln in enumerate(lines[:3]):
                c.text(x + 14, y + rh / 2 - (len(lines[:3]) - 1) * 8 + k * 16, ln, 11.2, 500 if cell != "—" else 400, INK if cell != "—" else LINE)
    return c


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    out = {"data-pipeline": pipeline(), "data-flow": dfd(), "entity-relationship": erd(), "data-governance": governance()}
    for name, canvas in out.items():
        path = OUT / f"{name}.svg"
        path.write_text(canvas.svg(), encoding="utf-8")
        if shutil.which("rsvg-convert"):
            subprocess.run(["rsvg-convert", "-z", "1.5", str(path), "-o", str(OUT / f"{name}.png")], check=True)
    print("Diagramas:", ", ".join(f"{n}.svg" for n in out))


if __name__ == "__main__":
    main()
