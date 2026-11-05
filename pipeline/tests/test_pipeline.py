"""Testes com um feed GTFS controlado (fixture de teste, não representa nenhuma rede real)."""
from __future__ import annotations

import json
import math
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pytest

from baldeia_pipeline import config
from baldeia_pipeline.gold import build_transfers
from baldeia_pipeline.quality import QualityReport
from baldeia_pipeline.run import run
from baldeia_pipeline.silver import build_silver
from baldeia_pipeline.utils import douglas_peucker, haversine_m, parse_gtfs_time, robust_z

FEED = {
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\n1,TESTE,http://exemplo.invalid,America/Sao_Paulo\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\n"
                  "R1,1,R1,Teste 1,1,ZZZZZZ\nR2,1,R2,Teste 2,3,00AA00\nR9,1,R9,Tipo invalido,99,\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n"
                 "A,Alfa,-23.5500,-46.6300\nB,Beta,-23.5600,-46.6300\nC,Gama,-23.5602,-46.6302\n"
                 "X,Coordenada ruim,200,-46.6\nA,Alfa duplicado,-23.55,-46.63\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id\nR1,S,T1,0\nR2,S,T2,0\nR404,S,T3,0\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                      "T1,08:00:00,08:00:00,A,1\nT1,08:03:00,08:03:00,B,2\nT1,08:03:00,08:03:00,C,3\n"
                      "T2,25:10:00,25:10:00,B,1\nT2,25:20:00,25:20:00,A,2\nT2,xx,xx,A,3\nT9,08:00:00,08:00:00,A,1\n"
                      "T1,08:00:00,08:00:00,A,1\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                    "S,1,1,1,1,1,0,0,20200101,20200501\n",
    "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nT1,07:00:00,09:00:00,300\nT2,07:00:00,06:00:00,600\n",
}


@pytest.fixture()
def feed_zip(tmp_path: Path) -> Path:
    z = tmp_path / "feed.zip"
    with zipfile.ZipFile(z, "w") as zf:
        for name, content in FEED.items():
            zf.writestr(name, content)
    return z


def test_parse_time_accepts_after_midnight():
    assert parse_gtfs_time("25:10:00") == 25 * 3600 + 600
    assert math.isnan(parse_gtfs_time("8h"))


def test_haversine_known_distance():
    # 0,01° de latitude ≈ 1112 m
    assert abs(float(haversine_m(-23.55, -46.63, -23.56, -46.63)) - 1112) < 5


def test_robust_z_flags_outlier():
    z = robust_z(np.array([10, 11, 9, 10, 12, 10, 95.0]))
    assert abs(z[-1]) > config.ROBUST_Z_THRESHOLD
    assert (np.abs(z[:-1]) < config.ROBUST_Z_THRESHOLD).all()


def test_douglas_peucker_keeps_endpoints():
    pts = [(0, 0), (1, 0.00001), (2, 0)]
    assert douglas_peucker(pts, 0.001) == [(0, 0), (2, 0)]


def test_silver_quarantines_instead_of_dropping(tmp_path: Path, feed_zip: Path):
    bronze = tmp_path / "b"
    bronze.mkdir()
    with zipfile.ZipFile(feed_zip) as zf:
        zf.extractall(bronze)
    rep = QualityReport()
    t = build_silver(bronze, rep, today=date(2026, 11, 5))
    q = rep.summary()["quarantined_records"]
    assert set(t["stops"]["stop_id"]) == {"A", "B", "C"}          # X (coord) e A duplicado em quarentena
    assert q["stops"] == 2
    assert "R9" not in set(t["routes"]["route_id"])               # route_type fora do domínio
    assert "T3" not in set(t["trips"]["trip_id"])                 # FK de rota inexistente
    assert q["stop_times"] >= 3                                    # duplicada, horário inválido, FK trip
    assert (t["stop_times"]["arrival_secs"] >= 25 * 3600).any()   # horário após meia-noite preservado
    assert len(t["frequencies"]) == 1                              # início > fim vai para quarentena
    rr = t["routes"].set_index("route_id")
    assert rr.at["R1", "route_color"] == "4B5563"                  # cor inválida imputada
    assert rr.at["R2", "route_text_color"] == "000000"             # texto escuro sobre verde claro (contraste)
    vig = next(c for c in rep.checks if c.check_id == "calendar:vigencia")
    assert vig.records_failed == 1 and vig.status == "aprovado_com_ressalvas"


def test_transfers_respect_radius():
    import pandas as pd
    stops = pd.DataFrame({"stop_id": ["A", "B", "C"], "stop_lat": [-23.55, -23.56, -23.5602],
                          "stop_lon": [-46.63, -46.63, -46.6302], "sem_viagens": [False] * 3})
    tr = build_transfers(stops)
    pairs = set(zip(tr["from_stop_id"], tr["to_stop_id"]))
    assert ("B", "C") in pairs and ("C", "B") in pairs
    assert ("A", "B") not in pairs                                  # ~1,1 km > raio
    assert (tr["distance_m"] <= config.TRANSFER_RADIUS_M).all()


def test_full_run_writes_lineage(tmp_path: Path, feed_zip: Path):
    m = run(feed_zip, "teste", today=date(2026, 11, 5), root=tmp_path)
    gold = tmp_path / "gold" / "teste"
    assert (gold / "_manifest.json").exists()
    manifest = json.loads((gold / "_manifest.json").read_text(encoding="utf-8"))
    assert manifest["fonte"]["sha256"] == m["fonte"]["sha256"]
    assert [e["etapa"] for e in manifest["etapas"]] == ["ingestao_bronze", "tratamento_silver",
                                                         "integracao_gold", "analise_descritiva"]
    seg = (gold / "route_segments.csv").read_text(encoding="utf-8")
    assert "True" in seg  # trecho B→C com tempo zero foi imputado e sinalizado
    assert (tmp_path / "silver" / "teste" / "_quarentena" / "stops.csv").exists()
