"""Registro de verificações de qualidade e quarentena.

Princípio: nenhum registro é descartado em silêncio. Todo registro removido de uma
camada vai para a quarentena com o motivo, e toda regra gera uma linha no relatório.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import pandas as pd

# Dimensões de qualidade adotadas (ver docs/governanca-e-etica.md, seção 1).
DIMENSIONS = {"completude", "validade", "unicidade", "consistencia", "atualidade", "precisao"}


@dataclass
class QualityCheck:
    check_id: str
    table: str
    dimension: str
    rule: str
    records_checked: int
    records_failed: int
    action: str          # quarentena | alerta | imputacao | nenhuma | bloqueio
    severity: str        # info | aviso | erro
    status: str = field(init=False)
    details: str = ""

    def __post_init__(self) -> None:
        assert self.dimension in DIMENSIONS, self.dimension
        if self.records_failed == 0:
            self.status = "aprovado"
        elif self.severity == "erro" and self.action == "bloqueio":
            self.status = "reprovado"
        else:
            self.status = "aprovado_com_ressalvas"


class QualityReport:
    def __init__(self) -> None:
        self.checks: list[QualityCheck] = []
        self.quarantine: dict[str, list[pd.DataFrame]] = {}

    def add(self, check: QualityCheck) -> None:
        self.checks.append(check)

    def quarantine_rows(self, table: str, rows: pd.DataFrame, reason: str) -> None:
        if rows.empty:
            return
        q = rows.copy()
        q["_motivo_quarentena"] = reason
        self.quarantine.setdefault(table, []).append(q)

    def quarantine_frame(self, table: str) -> pd.DataFrame:
        frames = self.quarantine.get(table, [])
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    def summary(self) -> dict:
        by_status: dict[str, int] = {}
        for c in self.checks:
            by_status[c.status] = by_status.get(c.status, 0) + 1
        return {
            "total_checks": len(self.checks),
            "by_status": by_status,
            "quarantined_records": {t: int(sum(len(f) for f in fs)) for t, fs in self.quarantine.items()},
            "blocking_failures": [c.check_id for c in self.checks if c.status == "reprovado"],
        }

    def to_records(self) -> list[dict]:
        return [asdict(c) for c in self.checks]
