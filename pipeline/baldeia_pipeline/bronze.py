"""ETAPA 1-2 — Ingestão e camada Bronze.

Preserva o arquivo recebido exatamente como chegou, mais metadados de ingestão
(origem, horário, hash, tamanho, lista de arquivos e contagem de linhas).
Nada é corrigido aqui: a Bronze é a "prova" do que foi recebido.
"""
from __future__ import annotations

import json
import shutil
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import config
from .utils import sha256_file, utc_now_iso


@dataclass
class IngestionJob:
    job_id: str
    source_id: str
    source_uri: str
    started_at: str
    finished_at: str | None = None
    status: str = "running"
    sha256: str = ""
    bytes: int = 0
    files: dict[str, int] = field(default_factory=dict)   # arquivo -> linhas (sem cabeçalho)
    duplicate_of: str | None = None
    bronze_path: str = ""
    errors: list[str] = field(default_factory=list)


def _previous_job_with_hash(source_dir: Path, sha: str) -> str | None:
    if not source_dir.exists():
        return None
    for meta in sorted(source_dir.glob("*/_ingestion.json")):
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if data.get("sha256") == sha and data.get("status") == "success":
            return data.get("job_id")
    return None


def ingest_gtfs_zip(zip_path: Path, source_id: str, bronze_root: Path = config.BRONZE) -> IngestionJob:
    zip_path = Path(zip_path)
    started = utc_now_iso()
    sha = sha256_file(zip_path)
    job_id = f"job_{started.replace('-', '').replace(':', '').replace('+0000', 'Z')[:16]}_{sha[:8]}"
    source_dir = bronze_root / source_id
    job = IngestionJob(job_id=job_id, source_id=source_id, source_uri=str(zip_path.as_posix()),
                       started_at=started, sha256=sha, bytes=zip_path.stat().st_size)
    job.duplicate_of = _previous_job_with_hash(source_dir, sha)

    target = source_dir / job_id
    target.mkdir(parents=True, exist_ok=True)
    job.bronze_path = str(target.relative_to(config.ROOT).as_posix()) if target.is_relative_to(config.ROOT) else str(target)
    try:
        shutil.copy2(zip_path, target / "raw.zip")
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                if info.is_dir() or not info.filename.endswith(".txt"):
                    continue
                name = Path(info.filename).name
                raw = zf.read(info)
                (target / name).write_bytes(raw)
                text = raw.decode("utf-8-sig", errors="replace")
                lines = [ln for ln in text.splitlines() if ln.strip()]
                job.files[name] = max(len(lines) - 1, 0)
        job.status = "success"
    except (zipfile.BadZipFile, OSError) as exc:
        job.status = "failed"
        job.errors.append(f"{type(exc).__name__}: {exc}")
    job.finished_at = utc_now_iso()
    (target / "_ingestion.json").write_text(json.dumps(asdict(job), ensure_ascii=False, indent=2), encoding="utf-8")
    return job
