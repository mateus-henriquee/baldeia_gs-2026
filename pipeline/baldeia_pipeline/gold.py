"""ETAPA 4 — Integração e transformação (camada Gold).

Produz tabelas prontas para o produto (planejador, mapa, indicadores):
- tabelas de referência GTFS tipadas (agencies, routes, stops, trips, stop_times, frequencies, calendar)
- route_segments: trechos parada→parada com tempo, distância, velocidade e flags
- stop_transfers: conexões a pé entre pontos próximos (premissas em config.py)
- route_shapes.geojson: traçados simplificados para o mapa
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import config
from .quality import QualityCheck, QualityReport
from .utils import douglas_peucker, haversine_m, robust_z


def _mode(route_type: int) -> str:
    if route_type in config.MODE_BY_ROUTE_TYPE:
        return config.MODE_BY_ROUTE_TYPE[route_type]
    if 100 <= route_type < 200:
        return "trem"
    if 400 <= route_type < 500:
        return "metro"
    if 700 <= route_type < 800:
        return "onibus"
    return "outro"


def build_segments(stop_times: pd.DataFrame, stops: pd.DataFrame, trips: pd.DataFrame,
                   routes: pd.DataFrame, report: QualityReport) -> pd.DataFrame:
    s = stop_times.sort_values(["trip_id", "stop_sequence"]).copy()
    s["to_stop_id"] = s.groupby("trip_id")["stop_id"].shift(-1)
    s["to_arrival"] = s.groupby("trip_id")["arrival_secs"].shift(-1)
    seg = s.dropna(subset=["to_stop_id"]).copy()
    seg = seg.rename(columns={"stop_id": "from_stop_id"})
    seg["travel_secs"] = seg["to_arrival"] - seg["departure_secs"]
    coords = stops.set_index("stop_id")[["stop_lat", "stop_lon"]]
    a = coords.loc[seg["from_stop_id"]].to_numpy()
    b = coords.loc[seg["to_stop_id"]].to_numpy()
    seg["distance_m"] = haversine_m(a[:, 0], a[:, 1], b[:, 0], b[:, 1]).round(1)
    seg = seg.merge(trips[["trip_id", "route_id"]], on="trip_id").merge(
        routes[["route_id", "route_type"]], on="route_id")
    seg["mode"] = seg["route_type"].map(_mode)

    # Imputação transparente de tempos não positivos (velocidade mediana do modo).
    nonpos = seg["travel_secs"] <= 0
    seg["imputed"] = nonpos
    valid = seg[~nonpos]
    med_speed = (valid["distance_m"] / valid["travel_secs"]).groupby(valid["mode"]).median()
    for mode, sp in med_speed.items():
        m = nonpos & (seg["mode"] == mode)
        seg.loc[m, "travel_secs"] = (seg.loc[m, "distance_m"] / sp).clip(lower=30).round()
    report.add(QualityCheck("route_segments:tempo_positivo", "route_segments", "consistencia",
                            "Tempo de trecho > 0 (se não, imputado pela velocidade mediana do modo)",
                            len(seg), int(nonpos.sum()), "imputacao", "aviso"))

    seg["speed_kmh"] = (seg["distance_m"] / seg["travel_secs"] * 3.6).round(2)
    seg["robust_z"] = 0.0
    for mode, idx in seg.groupby("mode").groups.items():
        seg.loc[idx, "robust_z"] = robust_z(seg.loc[idx, "speed_kmh"].to_numpy()).round(2)
    seg["anomaly"] = seg["robust_z"].abs() > config.ROBUST_Z_THRESHOLD
    report.add(QualityCheck("route_segments:velocidade_plausivel", "route_segments", "precisao",
                            f"|z robusto| da velocidade por modo ≤ {config.ROBUST_Z_THRESHOLD}",
                            len(seg), int(seg["anomaly"].sum()), "alerta", "aviso",
                            details="Trechos anômalos são mantidos e sinalizados para revisão humana."))
    cols = ["trip_id", "route_id", "stop_sequence", "from_stop_id", "to_stop_id", "travel_secs",
            "distance_m", "speed_kmh", "mode", "imputed", "anomaly", "robust_z"]
    out = seg[cols].copy()
    out["travel_secs"] = out["travel_secs"].astype(int)
    return out.reset_index(drop=True)


def build_transfers(stops: pd.DataFrame) -> pd.DataFrame:
    """Pares de pontos a até TRANSFER_RADIUS_M em linha reta (busca por grade espacial)."""
    s = stops[~stops["sem_viagens"]][["stop_id", "stop_lat", "stop_lon"]].reset_index(drop=True)
    cell = config.TRANSFER_RADIUS_M / 111_000  # graus (aprox.) por célula
    s["gx"] = np.floor(s["stop_lon"] / cell).astype(int)
    s["gy"] = np.floor(s["stop_lat"] / cell).astype(int)
    grid: dict[tuple[int, int], list[int]] = {}
    for i, (gx, gy) in enumerate(zip(s["gx"], s["gy"])):
        grid.setdefault((gx, gy), []).append(i)
    rows = []
    lat, lon, ids = s["stop_lat"].to_numpy(), s["stop_lon"].to_numpy(), s["stop_id"].to_numpy()
    for i in range(len(s)):
        gx, gy = s.at[i, "gx"], s.at[i, "gy"]
        cand = [j for dx in (-1, 0, 1) for dy in (-1, 0, 1) for j in grid.get((gx + dx, gy + dy), []) if j != i]
        if not cand:
            continue
        cand = np.array(cand)
        d = haversine_m(lat[i], lon[i], lat[cand], lon[cand])
        for j, dist in zip(cand[d <= config.TRANSFER_RADIUS_M], d[d <= config.TRANSFER_RADIUS_M]):
            walk = dist * config.WALK_DETOUR_FACTOR / config.WALK_SPEED_MPS
            rows.append((ids[i], ids[j], round(float(dist), 1), int(round(walk))))
    return pd.DataFrame(rows, columns=["from_stop_id", "to_stop_id", "distance_m", "walk_secs"])


def build_shapes(shapes: pd.DataFrame | None, trips: pd.DataFrame, routes: pd.DataFrame,
                 stop_times: pd.DataFrame, stops: pd.DataFrame) -> dict:
    features = []
    rinfo = routes.set_index("route_id")
    for (route_id, direction), grp in trips.groupby(["route_id", "direction_id"]):
        trip = grp.iloc[0]
        pts: list[tuple[float, float]] = []
        source = "shapes"
        if shapes is not None and trip["shape_id"] and (shapes["shape_id"] == trip["shape_id"]).any():
            sh = shapes[shapes["shape_id"] == trip["shape_id"]]
            pts = list(zip(sh["shape_pt_lon"].round(6), sh["shape_pt_lat"].round(6)))
        else:  # fallback: liga as paradas na ordem
            source = "stop_times"
            st = stop_times[stop_times["trip_id"] == trip["trip_id"]].merge(stops, on="stop_id")
            pts = list(zip(st["stop_lon"], st["stop_lat"]))
        simp = douglas_peucker(pts, config.SHAPE_SIMPLIFY_TOLERANCE)
        r = rinfo.loc[route_id]
        features.append({
            "type": "Feature",
            "properties": {"route_id": route_id, "direction_id": int(direction), "mode": _mode(int(r["route_type"])),
                           "color": f"#{r['route_color']}", "geometry_source": source,
                           "points_original": len(pts), "points_simplified": len(simp)},
            "geometry": {"type": "LineString", "coordinates": [[float(x), float(y)] for x, y in simp]},
        })
    return {"type": "FeatureCollection", "features": features}


def build_gold(silver: dict[str, pd.DataFrame], report: QualityReport) -> dict[str, object]:
    routes = silver["routes"].copy()
    routes["mode"] = routes["route_type"].map(_mode)
    stops = silver["stops"].copy()
    trips = silver["trips"]
    stop_times = silver["stop_times"]

    modes_by_stop = stop_times.merge(trips[["trip_id", "route_id"]], on="trip_id").merge(
        routes[["route_id", "mode"]], on="route_id").groupby("stop_id")["mode"].agg(lambda x: sorted(set(x)))
    stops["modes"] = stops["stop_id"].map(modes_by_stop).apply(lambda v: v if isinstance(v, list) else [])
    stops["kind"] = stops["modes"].apply(lambda m: "estacao" if ("metro" in m or "trem" in m) else "ponto")

    segments = build_segments(stop_times, stops, trips, routes, report)
    transfers = build_transfers(stops)
    report.add(QualityCheck("stop_transfers:geradas", "stop_transfers", "completude",
                            f"Conexões a pé ≤ {config.TRANSFER_RADIUS_M} m geradas (premissa, não dado medido)",
                            len(stops), 0, "nenhuma", "info", details=f"{len(transfers)} pares direcionais"))
    shapes_geo = build_shapes(silver.get("shapes"), trips, routes, stop_times, stops)

    gold: dict[str, object] = {
        "agencies": silver["agency"].rename(columns={"agency_name": "name", "agency_url": "url",
                                                      "agency_timezone": "timezone", "agency_lang": "lang"}),
        "routes": routes.rename(columns={"route_short_name": "short_name", "route_long_name": "long_name",
                                         "route_color": "color", "route_text_color": "text_color"})[
            ["route_id", "agency_id", "short_name", "long_name", "route_type", "mode", "color", "text_color"]],
        "stops": stops.rename(columns={"stop_name": "name", "stop_desc": "description", "stop_lat": "lat",
                                       "stop_lon": "lon", "stop_name_search": "name_search"}).assign(
            modes=lambda d: d["modes"].apply("|".join))[
            ["stop_id", "name", "description", "lat", "lon", "kind", "modes", "name_search",
             "fora_area_esperada", "sem_viagens"]],
        "trips": trips.rename(columns={"trip_headsign": "headsign"})[
            ["trip_id", "route_id", "service_id", "direction_id", "headsign", "shape_id"]],
        "stop_times": stop_times[["trip_id", "stop_sequence", "stop_id", "arrival_secs", "departure_secs"]].astype(
            {"arrival_secs": int, "departure_secs": int}),
        "route_segments": segments,
        "stop_transfers": transfers,
        "route_shapes": shapes_geo,
    }
    if "frequencies" in silver:
        gold["frequencies"] = silver["frequencies"][["trip_id", "start_secs", "end_secs", "headway_secs"]].astype(int, errors="ignore")
    if "calendar" in silver:
        gold["calendar"] = silver["calendar"][["service_id", "monday", "tuesday", "wednesday", "thursday", "friday",
                                               "saturday", "sunday", "start_date_iso", "end_date_iso", "expirado"]]
    return gold


def write_gold(gold: dict[str, object], out_dir: Path) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for name, obj in gold.items():
        if isinstance(obj, pd.DataFrame):
            obj.to_csv(out_dir / f"{name}.csv", index=False)
            counts[name] = len(obj)
        else:
            (out_dir / f"{name}.geojson").write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
            counts[name] = len(obj.get("features", []))  # type: ignore[union-attr]
    return counts
