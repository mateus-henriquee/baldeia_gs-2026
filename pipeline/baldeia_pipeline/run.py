"""Orquestração do pipeline: Bronze → Silver → Gold → Análise → Manifesto de linhagem.

Uso:
    python -m baldeia_pipeline.run --source data/sources/sptrans-gtfs-amostra/spo_gtfs.zip \
        --source-id sptrans_gtfs_amostra
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import date
from pathlib import Path

from . import config
from .analysis import run_analysis
from .bronze import ingest_gtfs_zip
from .gold import build_gold, write_gold
from .quality import QualityReport
from .silver import build_silver, write_silver
from .utils import utc_now_iso


def run(source: Path, source_id: str, today: date | None = None, root: Path = config.DATA) -> dict:
    t0 = time.perf_counter()
    steps: list[dict] = []

    def step(name: str, started: float, **info) -> None:
        steps.append({"etapa": name, "duracao_ms": round((time.perf_counter() - started) * 1000, 1), **info})

    s = time.perf_counter()
    job = ingest_gtfs_zip(source, source_id, bronze_root=root / "bronze")
    step("ingestao_bronze", s, job_id=job.job_id, status=job.status, linhas_recebidas=job.files)
    if job.status != "success":
        raise RuntimeError(f"Ingestão falhou: {job.errors}")
    bronze_dir = config.ROOT / job.bronze_path if not Path(job.bronze_path).is_absolute() else Path(job.bronze_path)

    report = QualityReport()
    s = time.perf_counter()
    silver = build_silver(bronze_dir, report, today=today)
    silver_dir = root / "silver" / source_id
    write_silver(silver, report, silver_dir)
    step("tratamento_silver", s, linhas={k: len(v) for k, v in silver.items()},
         quarentena=report.summary()["quarantined_records"])

    s = time.perf_counter()
    gold = build_gold(silver, report)
    gold_dir = root / "gold" / source_id
    counts = write_gold(gold, gold_dir)
    step("integracao_gold", s, linhas=counts)

    s = time.perf_counter()
    analytics = run_analysis(gold)
    (gold_dir / "analytics.json").write_text(json.dumps(analytics, ensure_ascii=False, indent=2), encoding="utf-8")
    step("analise_descritiva", s)

    quality = {"resumo": report.summary(), "verificacoes": report.to_records()}
    (gold_dir / "quality_report.json").write_text(json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8")

    dataset_version = f"dsv_{job.sha256[:12]}_p{config.PIPELINE_VERSION}"
    manifest = {
        "dataset_version": dataset_version,
        "pipeline_version": config.PIPELINE_VERSION,
        "gerado_em": utc_now_iso(),
        "fonte": {"source_id": source_id, "arquivo": job.source_uri, "sha256": job.sha256, "bytes": job.bytes},
        "ingestao": {"job_id": job.job_id, "bronze_path": job.bronze_path, "duplicado_de": job.duplicate_of,
                     "iniciado_em": job.started_at, "finalizado_em": job.finished_at},
        "etapas": steps,
        "premissas": {"raio_conexao_m": config.TRANSFER_RADIUS_M, "velocidade_caminhada_mps": config.WALK_SPEED_MPS,
                      "fator_desvio_caminhada": config.WALK_DETOUR_FACTOR,
                      "limiar_z_robusto": config.ROBUST_Z_THRESHOLD},
        "qualidade": report.summary(),
        "saidas": {name: f"data/gold/{source_id}/{name}.{'geojson' if name == 'route_shapes' else 'csv'}" for name in counts},
        "duracao_total_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
    (gold_dir / "_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    p = argparse.ArgumentParser(description="Pipeline de dados Baldeia (GTFS → Bronze/Silver/Gold)")
    p.add_argument("--source", type=Path, default=config.DATA / "sources/sptrans-gtfs-amostra/spo_gtfs.zip")
    p.add_argument("--source-id", default="sptrans_gtfs_amostra")
    args = p.parse_args()
    m = run(args.source, args.source_id)
    print(json.dumps({k: m[k] for k in ("dataset_version", "qualidade", "duracao_total_ms")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
