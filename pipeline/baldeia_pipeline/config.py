"""Parâmetros do pipeline.

Tudo que é premissa (não dado) fica aqui, documentado, para ser auditável.
Ver docs/pipeline-de-dados.md e docs/metodologia-analitica.md.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
BRONZE = DATA / "bronze"
SILVER = DATA / "silver"
GOLD = DATA / "gold"

PIPELINE_VERSION = "1.1.0"

# Arquivos GTFS Schedule obrigatórios (simplificação usada pelo Ipea; calendar.txt
# é condicionalmente obrigatório na especificação oficial).
REQUIRED_FILES = ["agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]
OPTIONAL_FILES = ["calendar.txt", "calendar_dates.txt", "frequencies.txt", "shapes.txt", "transfers.txt"]

REQUIRED_COLUMNS = {
    "agency.txt": ["agency_name", "agency_url", "agency_timezone"],
    "stops.txt": ["stop_id", "stop_name", "stop_lat", "stop_lon"],
    "routes.txt": ["route_id", "route_type"],
    "trips.txt": ["route_id", "service_id", "trip_id"],
    "stop_times.txt": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
    "calendar.txt": ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday",
                      "saturday", "sunday", "start_date", "end_date"],
    "frequencies.txt": ["trip_id", "start_time", "end_time", "headway_secs"],
    "shapes.txt": ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
}

# Domínio de route_type (GTFS básico + tipos estendidos 100-1700 aceitos como válidos).
ROUTE_TYPES_BASIC = {0, 1, 2, 3, 4, 5, 6, 7, 11, 12}
MODE_BY_ROUTE_TYPE = {0: "metro", 1: "metro", 2: "trem", 3: "onibus", 11: "onibus", 12: "metro"}

# Caixa de plausibilidade da Região Metropolitana de São Paulo (graus).
# Coordenadas fora dela não são descartadas: recebem alerta de qualidade.
RMSP_BBOX = {"lat_min": -24.1, "lat_max": -23.0, "lon_min": -47.3, "lon_max": -45.6}

# Premissas de caminhada (não são dados medidos — ver metodologia).
TRANSFER_RADIUS_M = 400       # raio máximo para conexão a pé entre pontos/estações
WALK_SPEED_MPS = 1.1          # ~4 km/h, conservador para incluir pessoas com mobilidade reduzida
WALK_DETOUR_FACTOR = 1.3      # distância real ~30% maior que a linha reta

# Detecção de anomalias (z-score robusto, Iglewicz & Hoaglin, 1993).
ROBUST_Z_THRESHOLD = 3.5

# Simplificação de geometrias (Douglas-Peucker), em graus (~22 m).
SHAPE_SIMPLIFY_TOLERANCE = 0.0002
