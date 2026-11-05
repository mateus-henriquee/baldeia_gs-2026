"""ETAPA 5 — Análise descritiva sobre a camada Gold.

Tudo aqui descreve a OFERTA PLANEJADA do feed (horários e frequências programados).
Não mede lotação, atraso nem operação real — o feed não contém essas informações.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _describe(x: pd.Series) -> dict:
    x = x.dropna().astype(float)
    if x.empty:
        return {"n": 0}
    q = np.percentile(x, [25, 50, 75])
    return {"n": int(len(x)), "media": round(float(x.mean()), 2), "mediana": round(float(q[1]), 2),
            "p25": round(float(q[0]), 2), "p75": round(float(q[2]), 2), "iqr": round(float(q[2] - q[0]), 2),
            "desvio_padrao": round(float(x.std(ddof=1)), 2) if len(x) > 1 else 0.0,
            "min": round(float(x.min()), 2), "max": round(float(x.max()), 2)}


def network_summary(g: dict) -> dict:
    routes, stops = g["routes"], g["stops"]
    return {
        "linhas_por_modo": routes["mode"].value_counts().sort_index().to_dict(),
        "paradas_total": int(len(stops)),
        "estacoes": int((stops["kind"] == "estacao").sum()),
        "pontos_onibus": int((stops["kind"] == "ponto").sum()),
        "paradas_sem_viagens": int(stops["sem_viagens"].sum()),
        "viagens_modelo": int(len(g["trips"])),
        "trechos": int(len(g["route_segments"])),
        "conexoes_a_pe": int(len(g["stop_transfers"])),
        "caminhada_conexao_mediana_s": float(g["stop_transfers"]["walk_secs"].median()) if len(g["stop_transfers"]) else None,
    }


def service_profile(g: dict) -> dict:
    """Oferta planejada por hora: linhas-sentido ativas e intervalo mediano, por modo (dias úteis)."""
    if "frequencies" not in g:
        return {"disponivel": False, "motivo": "feed sem frequencies.txt"}
    fr = g["frequencies"].merge(g["trips"][["trip_id", "route_id", "service_id"]], on="trip_id").merge(
        g["routes"][["route_id", "mode"]], on="route_id")
    if "calendar" in g:
        weekday = g["calendar"][g["calendar"]["wednesday"] == 1]["service_id"]
        fr = fr[fr["service_id"].isin(weekday)]
    rows = []
    for _, r in fr.iterrows():
        for h in range(int(r["start_secs"]) // 3600, int(np.ceil(r["end_secs"] / 3600))):
            rows.append((r["mode"], h % 24, r["trip_id"], r["headway_secs"] / 60))
    df = pd.DataFrame(rows, columns=["mode", "hora", "trip_id", "headway_min"])
    out: dict = {"base": "frequencies.txt, serviços que operam às quartas-feiras", "por_modo": {}}
    for mode, gm in df.groupby("mode"):
        prof = gm.groupby("hora").agg(linhas_sentido=("trip_id", "nunique"),
                                      intervalo_mediano_min=("headway_min", "median")).reset_index()
        best = prof.sort_values(["intervalo_mediano_min", "hora"]).iloc[0]
        out["por_modo"][mode] = {
            "horas": prof.round(2).to_dict(orient="records"),
            "menor_intervalo_mediano_min": round(float(best["intervalo_mediano_min"]), 2),
            "horas_de_maior_oferta": prof[prof["intervalo_mediano_min"] == best["intervalo_mediano_min"]]["hora"].astype(int).tolist(),
        }
    return out


def segment_speeds(g: dict) -> dict:
    seg = g["route_segments"]
    stops = g["stops"].set_index("stop_id")["name"]
    out = {"unidade": "km/h", "por_modo": {m: _describe(gm["speed_kmh"]) for m, gm in seg.groupby("mode")}}
    anom = seg[seg["anomaly"]].sort_values("robust_z", key=lambda s: -s.abs()).head(25)
    out["anomalias"] = [{
        "route_id": r.route_id, "de": stops.get(r.from_stop_id, r.from_stop_id), "para": stops.get(r.to_stop_id, r.to_stop_id),
        "distancia_m": float(r.distance_m), "tempo_s": int(r.travel_secs), "velocidade_kmh": float(r.speed_kmh),
        "z_robusto": float(r.robust_z)} for r in anom.itertuples()]
    out["total_anomalias"] = int(seg["anomaly"].sum())
    out["trechos_imputados"] = int(seg["imputed"].sum())
    return out


def trip_durations(g: dict) -> list[dict]:
    seg = g["route_segments"]
    agg = seg.groupby(["trip_id", "route_id"]).agg(duracao_min=("travel_secs", lambda s: s.sum() / 60),
                                                   extensao_km=("distance_m", lambda s: s.sum() / 1000),
                                                   trechos=("travel_secs", "size")).reset_index()
    agg = agg.merge(g["routes"][["route_id", "short_name", "long_name", "mode"]], on="route_id")
    agg["velocidade_media_kmh"] = agg["extensao_km"] / (agg["duracao_min"] / 60)
    return agg.round(2).sort_values(["mode", "route_id"]).to_dict(orient="records")


def run_analysis(g: dict) -> dict:
    return {
        "aviso": "Estatísticas da oferta PLANEJADA (GTFS). Não representam lotação, atrasos ou operação observada.",
        "rede": network_summary(g),
        "oferta_por_hora": service_profile(g),
        "velocidade_trechos": segment_speeds(g),
        "duracao_viagens": trip_durations(g),
    }
