from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

EARTH_RADIUS_M = 6_371_000.0
_TIME_RE = re.compile(r"^\s*(\d{1,3}):([0-5]\d):([0-5]\d)\s*$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_gtfs_time(value: object) -> float:
    """Converte HH:MM:SS em segundos desde o início do dia de serviço.

    GTFS permite horas >= 24 (viagens que passam da meia-noite). Retorna NaN se inválido.
    """
    if value is None:
        return math.nan
    m = _TIME_RE.match(str(value))
    if not m:
        return math.nan
    h, mi, s = (int(x) for x in m.groups())
    return float(h * 3600 + mi * 60 + s)


def haversine_m(lat1, lon1, lat2, lon2):
    """Distância em metros (vetorizada com NumPy)."""
    lat1, lon1, lat2, lon2 = (np.radians(np.asarray(x, dtype=float)) for x in (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))


def normalize_text(value: object) -> str:
    """Minúsculas, sem acentos e espaços extras — usado para busca, nunca para exibição."""
    s = unicodedata.normalize("NFKD", str(value or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def robust_z(values: np.ndarray) -> np.ndarray:
    """Z-score modificado (Iglewicz & Hoaglin): 0.6745 * (x - mediana) / MAD."""
    x = np.asarray(values, dtype=float)
    med = np.nanmedian(x)
    mad = np.nanmedian(np.abs(x - med))
    if not mad or np.isnan(mad):
        return np.zeros_like(x)
    return 0.6745 * (x - med) / mad


def douglas_peucker(points: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Simplificação de polilinha (lon, lat) — implementação iterativa."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (x1, y1), (x2, y2) = points[start], points[end]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-12
        max_d, idx = 0.0, -1
        for i in range(start + 1, end):
            x0, y0 = points[i]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if d > max_d:
                max_d, idx = d, i
        if max_d > tol and idx > 0:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))
    return [p for p, k in zip(points, keep) if k]
