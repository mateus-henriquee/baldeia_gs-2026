"""ETAPA 3 — Camada Silver: tratamento, limpeza e validação.

Entrada: arquivos .txt preservados na Bronze.
Saída: tabelas tipadas e validadas + relatório de qualidade + quarentena.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import pandas as pd

from . import config
from .quality import QualityCheck, QualityReport
from .utils import normalize_text, parse_gtfs_time

HEX_COLOR = re.compile(r"^[0-9A-Fa-f]{6}$")

PRIMARY_KEYS = {
    "agency.txt": ["agency_id"],
    "stops.txt": ["stop_id"],
    "routes.txt": ["route_id"],
    "trips.txt": ["trip_id"],
    "stop_times.txt": ["trip_id", "stop_sequence"],
    "calendar.txt": ["service_id"],
    "frequencies.txt": ["trip_id", "start_time"],
    "shapes.txt": ["shape_id", "shape_pt_sequence"],
}


def _luminance(hex6: str) -> float:
    def ch(v: int) -> float:
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hex6[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def _best_text(bg: str) -> str:
    lum = _luminance(bg)
    return "000000" if (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) else "FFFFFF"


def _read_raw(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    for c in df.columns:
        df[c] = df[c].str.strip()
    return df


def _check(report: QualityReport, cid: str, table: str, dim: str, rule: str, checked: int,
           failed: int, action: str, severity: str, details: str = "") -> None:
    report.add(QualityCheck(cid, table, dim, rule, int(checked), int(failed), action, severity, details=details))


def _dedupe(df: pd.DataFrame, name: str, report: QualityReport) -> pd.DataFrame:
    fname, name = name, name.removesuffix(".txt")
    dup = df.duplicated(keep="first")
    report.quarantine_rows(name, df[dup], "linha_duplicada_identica")
    _check(report, f"{name}:linhas_duplicadas", name, "unicidade", "Linhas idênticas são removidas (mantida a 1ª)",
           len(df), dup.sum(), "quarentena", "aviso")
    df = df[~dup]
    pk = [c for c in PRIMARY_KEYS.get(fname, []) if c in df.columns]
    if pk:
        dpk = df.duplicated(subset=pk, keep="first")
        report.quarantine_rows(name, df[dpk], f"chave_primaria_duplicada({','.join(pk)})")
        _check(report, f"{name}:pk_unica", name, "unicidade", f"Chave {pk} deve ser única",
               len(df), dpk.sum(), "quarentena", "erro")
        df = df[~dpk]
    return df


def _required_values(df: pd.DataFrame, name: str, report: QualityReport) -> pd.DataFrame:
    fname, name = name, name.removesuffix(".txt")
    cols = [c for c in config.REQUIRED_COLUMNS.get(fname, []) if c in df.columns]
    if not cols:
        return df
    empty = (df[cols] == "").any(axis=1)
    report.quarantine_rows(name, df[empty], f"campo_obrigatorio_vazio({','.join(cols)})")
    _check(report, f"{name}:obrigatorios_preenchidos", name, "completude",
           f"Campos {cols} não podem ser vazios", len(df), empty.sum(), "quarentena", "erro")
    return df[~empty]


def build_silver(bronze_dir: Path, report: QualityReport, today: date | None = None) -> dict[str, pd.DataFrame]:
    today = today or date.today()
    present = {p.name for p in bronze_dir.glob("*.txt")}

    missing = [f for f in config.REQUIRED_FILES if f not in present]
    _check(report, "feed:arquivos_obrigatorios", "feed", "completude",
           f"Arquivos obrigatórios presentes: {config.REQUIRED_FILES}", len(config.REQUIRED_FILES), len(missing),
           "bloqueio", "erro", details=f"ausentes={missing}")
    if missing:
        raise ValueError(f"Feed GTFS incompleto. Ausentes: {missing}")
    has_calendar = "calendar.txt" in present or "calendar_dates.txt" in present
    _check(report, "feed:calendario", "feed", "completude", "calendar.txt ou calendar_dates.txt presente",
           1, 0 if has_calendar else 1, "alerta", "aviso")

    t: dict[str, pd.DataFrame] = {}
    for name in sorted(present):
        if name not in config.REQUIRED_FILES + config.OPTIONAL_FILES:
            continue
        df = _read_raw(bronze_dir / name)
        missing_cols = [c for c in config.REQUIRED_COLUMNS.get(name, []) if c not in df.columns]
        _check(report, f"{name.removesuffix('.txt')}:colunas_obrigatorias", name.removesuffix(".txt"), "validade", "Colunas obrigatórias presentes",
               len(config.REQUIRED_COLUMNS.get(name, [])), len(missing_cols),
               "bloqueio" if name in config.REQUIRED_FILES else "alerta",
               "erro" if name in config.REQUIRED_FILES else "aviso", details=f"ausentes={missing_cols}")
        if missing_cols:
            if name in config.REQUIRED_FILES:
                raise ValueError(f"{name}: colunas obrigatórias ausentes {missing_cols}")
            continue
        df = _dedupe(df, name, report)
        df = _required_values(df, name, report)
        t[name.removesuffix(".txt")] = df

    # ---- agency
    ag = t["agency"]
    if "agency_id" not in ag.columns:
        ag["agency_id"] = "1"
    t["agency"] = ag

    # ---- stops: coordenadas
    st = t["stops"].copy()
    st["stop_lat"] = pd.to_numeric(st["stop_lat"], errors="coerce")
    st["stop_lon"] = pd.to_numeric(st["stop_lon"], errors="coerce")
    bad = st["stop_lat"].isna() | st["stop_lon"].isna() | ~st["stop_lat"].between(-90, 90) | ~st["stop_lon"].between(-180, 180)
    report.quarantine_rows("stops", st[bad], "coordenada_invalida")
    _check(report, "stops:coordenadas_validas", "stops", "validade", "Latitude ∈ [-90,90] e longitude ∈ [-180,180]",
           len(st), bad.sum(), "quarentena", "erro")
    st = st[~bad]
    b = config.RMSP_BBOX
    outside = ~(st["stop_lat"].between(b["lat_min"], b["lat_max"]) & st["stop_lon"].between(b["lon_min"], b["lon_max"]))
    st["fora_area_esperada"] = outside
    _check(report, "stops:dentro_rmsp", "stops", "precisao", "Ponto dentro da caixa da RMSP (alerta, não descarta)",
           len(st), outside.sum(), "alerta", "aviso")
    st["stop_name_search"] = st["stop_name"].map(normalize_text)
    if "stop_desc" not in st.columns:
        st["stop_desc"] = ""
    t["stops"] = st

    # ---- routes
    ro = t["routes"].copy()
    ro["route_type"] = pd.to_numeric(ro["route_type"], errors="coerce")
    valid_type = ro["route_type"].isin(config.ROUTE_TYPES_BASIC) | ro["route_type"].between(100, 1700)
    report.quarantine_rows("routes", ro[~valid_type], "route_type_fora_do_dominio")
    _check(report, "routes:route_type_dominio", "routes", "validade", "route_type no domínio GTFS",
           len(ro), (~valid_type).sum(), "quarentena", "erro")
    ro = ro[valid_type].copy()
    ro["route_type"] = ro["route_type"].astype(int)
    for col in ("route_color", "route_text_color"):
        if col not in ro.columns:
            ro[col] = ""
    badc = (ro["route_color"] != "") & ~ro["route_color"].str.match(HEX_COLOR)
    _check(report, "routes:route_color_hex", "routes", "validade", "route_color vazio ou hexadecimal de 6 dígitos",
           len(ro), badc.sum(), "imputacao", "info", details="valor padrão 4B5563")
    ro.loc[badc | (ro["route_color"] == ""), "route_color"] = "4B5563"
    # Texto da linha: se ausente/inválido, escolhe preto ou branco pelo maior contraste (WCAG) com a cor da linha.
    badt = (ro["route_text_color"] == "") | ~ro["route_text_color"].str.match(HEX_COLOR)
    _check(report, "routes:route_text_color_hex", "routes", "validade",
           "route_text_color hexadecimal; se ausente, imputado por contraste WCAG", len(ro), badt.sum(), "imputacao", "info",
           details="000000 ou FFFFFF conforme maior razão de contraste")
    ro.loc[badt, "route_text_color"] = ro.loc[badt, "route_color"].map(_best_text)
    for col in ("route_short_name", "route_long_name"):
        if col not in ro.columns:
            ro[col] = ""
    no_name = (ro["route_short_name"] == "") & (ro["route_long_name"] == "")
    _check(report, "routes:nome_presente", "routes", "completude", "route_short_name ou route_long_name preenchido",
           len(ro), no_name.sum(), "alerta", "aviso")
    t["routes"] = ro

    # ---- trips
    tr = t["trips"].copy()
    fk = tr["route_id"].isin(ro["route_id"])
    report.quarantine_rows("trips", tr[~fk], "fk_route_id_inexistente")
    _check(report, "trips:fk_route", "trips", "consistencia", "trips.route_id existe em routes",
           len(tr), (~fk).sum(), "quarentena", "erro")
    tr = tr[fk].copy()
    for col in ("direction_id", "shape_id", "trip_headsign"):
        if col not in tr.columns:
            tr[col] = ""
    tr["direction_id"] = pd.to_numeric(tr["direction_id"], errors="coerce").fillna(0).astype(int)
    if "calendar" in t:
        sv = tr["service_id"].isin(t["calendar"]["service_id"])
        _check(report, "trips:fk_service", "trips", "consistencia", "trips.service_id existe em calendar",
               len(tr), (~sv).sum(), "alerta", "aviso")
    t["trips"] = tr

    # ---- stop_times
    stt = t["stop_times"].copy()
    stt["arrival_secs"] = stt["arrival_time"].map(parse_gtfs_time)
    stt["departure_secs"] = stt["departure_time"].map(parse_gtfs_time)
    stt["stop_sequence"] = pd.to_numeric(stt["stop_sequence"], errors="coerce")
    bad_t = stt["arrival_secs"].isna() | stt["departure_secs"].isna() | stt["stop_sequence"].isna()
    report.quarantine_rows("stop_times", stt[bad_t], "horario_ou_sequencia_invalido")
    _check(report, "stop_times:horarios_validos", "stop_times", "validade",
           "Horários HH:MM:SS (aceita >24h) e stop_sequence numérico", len(stt), bad_t.sum(), "quarentena", "erro")
    stt = stt[~bad_t].copy()
    fk_trip = stt["trip_id"].isin(tr["trip_id"])
    fk_stop = stt["stop_id"].isin(st["stop_id"])
    report.quarantine_rows("stop_times", stt[~fk_trip], "fk_trip_id_inexistente")
    report.quarantine_rows("stop_times", stt[fk_trip & ~fk_stop], "fk_stop_id_inexistente")
    _check(report, "stop_times:fk_trip", "stop_times", "consistencia", "stop_times.trip_id existe em trips",
           len(stt), (~fk_trip).sum(), "quarentena", "erro")
    _check(report, "stop_times:fk_stop", "stop_times", "consistencia", "stop_times.stop_id existe em stops",
           len(stt), (fk_trip & ~fk_stop).sum(), "quarentena", "erro")
    stt = stt[fk_trip & fk_stop].copy()
    stt["stop_sequence"] = stt["stop_sequence"].astype(int)
    stt = stt.sort_values(["trip_id", "stop_sequence"])
    prev = stt.groupby("trip_id")["departure_secs"].shift(1)
    non_mono = (stt["arrival_secs"] < prev).fillna(False)
    _check(report, "stop_times:tempo_monotonico", "stop_times", "consistencia",
           "Chegada não pode ser anterior à partida da parada anterior", len(stt), non_mono.sum(), "alerta", "aviso")
    stt["flag_tempo_nao_monotonico"] = non_mono
    t["stop_times"] = stt

    # ---- frequencies
    if "frequencies" in t:
        fr = t["frequencies"].copy()
        fr["start_secs"] = fr["start_time"].map(parse_gtfs_time)
        fr["end_secs"] = fr["end_time"].map(parse_gtfs_time)
        fr["headway_secs"] = pd.to_numeric(fr["headway_secs"], errors="coerce")
        bad_f = fr["start_secs"].isna() | fr["end_secs"].isna() | fr["headway_secs"].isna() | \
            (fr["headway_secs"] <= 0) | (fr["end_secs"] <= fr["start_secs"]) | ~fr["trip_id"].isin(tr["trip_id"])
        report.quarantine_rows("frequencies", fr[bad_f], "frequencia_invalida")
        _check(report, "frequencies:validas", "frequencies", "validade",
               "headway > 0, início < fim e trip_id existente", len(fr), bad_f.sum(), "quarentena", "erro")
        fr = fr[~bad_f].copy()
        fr["headway_secs"] = fr["headway_secs"].astype(int)
        t["frequencies"] = fr

    # ---- calendar: atualidade
    if "calendar" in t:
        ca = t["calendar"].copy()
        ca["start_date_iso"] = pd.to_datetime(ca["start_date"], format="%Y%m%d", errors="coerce")
        ca["end_date_iso"] = pd.to_datetime(ca["end_date"], format="%Y%m%d", errors="coerce")
        bad_d = ca["start_date_iso"].isna() | ca["end_date_iso"].isna()
        report.quarantine_rows("calendar", ca[bad_d], "data_invalida")
        _check(report, "calendar:datas_validas", "calendar", "validade", "Datas AAAAMMDD válidas",
               len(ca), bad_d.sum(), "quarentena", "erro")
        ca = ca[~bad_d].copy()
        expired = ca["end_date_iso"].dt.date < today
        _check(report, "calendar:vigencia", "calendar", "atualidade",
               f"Calendário vigente em {today.isoformat()}", len(ca), expired.sum(), "alerta", "aviso",
               details="Calendário expirado: usar apenas como padrão semanal histórico, nunca como horário atual.")
        ca["expirado"] = expired
        for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
            ca[d] = ca[d].astype(int)
        ca["start_date_iso"] = ca["start_date_iso"].dt.date.astype(str)
        ca["end_date_iso"] = ca["end_date_iso"].dt.date.astype(str)
        t["calendar"] = ca

    # ---- shapes
    if "shapes" in t:
        sh = t["shapes"].copy()
        for c in ("shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"):
            sh[c] = pd.to_numeric(sh[c], errors="coerce")
        bad_s = sh[["shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]].isna().any(axis=1)
        report.quarantine_rows("shapes", sh[bad_s], "ponto_de_traçado_invalido")
        _check(report, "shapes:pontos_validos", "shapes", "validade", "Pontos de traçado numéricos",
               len(sh), bad_s.sum(), "quarentena", "erro")
        t["shapes"] = sh[~bad_s].sort_values(["shape_id", "shape_pt_sequence"])

    # Pontos sem nenhuma viagem: mantidos, mas sinalizados (consistência).
    unused = ~t["stops"]["stop_id"].isin(t["stop_times"]["stop_id"])
    _check(report, "stops:sem_viagens", "stops", "consistencia", "Ponto atendido por ao menos uma viagem",
           len(t["stops"]), unused.sum(), "alerta", "info")
    t["stops"]["sem_viagens"] = unused.values
    return t


def write_silver(tables: dict[str, pd.DataFrame], report: QualityReport, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, df in tables.items():
        df.to_csv(out_dir / f"{name}.csv", index=False)
    qdir = out_dir / "_quarentena"
    qdir.mkdir(exist_ok=True)
    for old in qdir.glob("*.csv"):
        old.unlink()
    for table in report.quarantine:
        report.quarantine_frame(table).to_csv(qdir / f"{table}.csv", index=False)
