"""Gera o dicionário de dados a partir do schema SQL e o insere em docs/modelagem-banco-de-dados.md
(entre os marcadores DICIONARIO:INICIO e DICIONARIO:FIM). Descrições: DESC abaixo (editáveis)."""
from __future__ import annotations

import re
from pathlib import Path

from build_diagrams import parse_schema

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs/modelagem-banco-de-dados.md"
SQL = (ROOT / "database/migrations/001_schema.sql").read_text(encoding="utf-8")

COMMON = {
    "dataset_version_id": "Versão do dataset que originou o registro (linhagem).",
    "created_at": "Momento de criação (UTC).", "user_id": "Usuário titular/autor.",
    "stop_id": "Parada/estação (GTFS).", "route_id": "Linha (GTFS).", "trip_id": "Viagem-modelo (GTFS).",
    "is_demo": "Registro sintético de demonstração.", "source_id": "Fonte de dados (catálogo).",
}
DESC = {
    "data_sources": {"_": "Catálogo de fontes pesquisadas e estado real de integração.", "category": "oficial | geografica | comunitaria | comportamental | demonstrativa",
                     "integration_status": "integrada | integrada_amostra | planejada | indisponivel", "consulted_on": "Data da consulta."},
    "dataset_versions": {"_": "Versão de cada carga da Gold; uma ativa por fonte.", "sha256": "Hash do arquivo de origem.", "manifest": "Manifesto de linhagem (_manifest.json).", "is_active": "Versão em uso pelo produto."},
    "ingestion_jobs": {"_": "Execuções de ingestão (Bronze).", "records_received": "Linhas recebidas por arquivo.", "bronze_path": "Pasta imutável do dado bruto."},
    "quality_checks": {"_": "Resultado de cada regra de qualidade por versão.", "dimension": "completude | validade | unicidade | consistencia | atualidade | precisao",
                       "status": "aprovado | aprovado_com_ressalvas | reprovado", "action": "quarentena | alerta | imputacao | bloqueio | nenhuma"},
    "agencies": {"_": "Operadores do feed."}, "routes": {"_": "Linhas de transporte.", "mode": "onibus | metro | trem | outro (derivado de route_type).", "color": "Cor da linha (hex)."},
    "stops": {"_": "Paradas e estações.", "kind": "estacao (metrô/trem) | ponto (ônibus).", "name_search": "Nome normalizado para busca.", "lat": "Latitude WGS84.", "lon": "Longitude WGS84."},
    "calendar_services": {"_": "Dias de operação de cada serviço.", "expired": "Calendário fora de vigência na data da carga."},
    "trips": {"_": "Viagens-modelo (padrões) por linha e sentido.", "direction_id": "Sentido (0/1)."},
    "stop_times": {"_": "Horários relativos/absolutos por parada da viagem.", "arrival_secs": "Segundos desde o início do dia de serviço (aceita ≥ 86400)."},
    "frequencies": {"_": "Janelas de serviço por frequência.", "headway_secs": "Intervalo programado entre veículos."},
    "route_segments": {"_": "Trechos parada→parada (Gold) usados pelo roteador.", "imputed": "Tempo imputado pelo pipeline.", "anomaly": "Velocidade atípica (|z robusto| > 3,5).", "robust_z": "Z-score robusto da velocidade no modo."},
    "stop_transfers": {"_": "Conexões a pé ≤ 400 m (premissa).", "walk_secs": "Tempo estimado (fator 1,3; 1,1 m/s)."},
    "route_shapes": {"_": "Traçado simplificado (GeoJSON) por linha e sentido."},
    "service_alerts": {"_": "Alertas oficiais (GTFS-RT). Vazia: sem fonte integrada."},
    "users": {"_": "Contas.", "email_normalized": "E-mail em minúsculas (unicidade).", "password_hash": "bcrypt; nunca exportado.", "token_version": "Invalida sessões ao incrementar.",
              "reputation": "Reputação bayesiana (0–1) para relatos.", "verification_token_hash": "SHA-256 do token de verificação."},
    "user_preferences": {"_": "Preferências de trajeto.", "max_walk_m": "Caminhada máxima por conexão."},
    "user_consents": {"_": "Log append-only de consentimentos por finalidade.", "purpose": "historico_viagens | analise_habitos | geolocalizacao | comunidade_publicar", "legal_basis": "Base legal registrada."},
    "favorite_places": {"_": "Destinos favoritos (apontam para parada, não endereço).", "label": "casa | trabalho | faculdade | escola | outro"},
    "journeys": {"_": "Viagens iniciadas (somente com consentimento de histórico).", "planned_duration_secs": "Duração planejada.", "saved_to_history": "Salva por consentimento."},
    "journey_legs": {"_": "Etapas (caminhada/transporte) de uma viagem.", "stop_ids": "Sequência de paradas da etapa."},
    "journey_checkpoints": {"_": "Paradas confirmadas (manual/GPS) — sem coordenadas.", "method": "manual | gps"},
    "recommendations": {"_": "Recomendações calculadas, para monitoramento.", "feedback": "util | nao_util", "criteria_availability": "Critérios disponíveis e motivos.", "user_id": "Só preenchido com consentimento."},
    "community_reports": {"_": "Relatos comunitários.", "type": "superlotacao | atraso | linha_parada | interrupcao | enchente | acidente | assalto | problema_estacao",
                          "reporter_weight": "Peso do autor no momento do relato.", "status": "ativo | oculto_moderacao | removido", "expires_at": "Expiração automática por tipo.",
                          "user_id": "Autor; vira NULL se a conta for excluída.", "description": "Até 280 caracteres, com dados pessoais removidos; apagado 30 dias após expirar."},
    "report_confirmations": {"_": "Confirmações e contestações (1 por usuário).", "vote": "confirma | contesta", "voter_weight": "Peso do votante."},
    "report_flags": {"_": "Denúncias (3 ocultam o relato).", "reason": "falso | ofensivo | dados_pessoais | spam | outro"},
    "audit_logs": {"_": "Trilha de auditoria (sem FK para sobreviver à exclusão).", "ip_hash": "SHA-256 do IP com segredo.", "actor_user_id": "Pseudônimo do ator."},
}


def main() -> None:
    t = parse_schema()
    out = []
    for name, info in t.items():
        d = DESC.get(name, {})
        out.append(f"\n#### `{name}` — {d.get('_', '')}\n\n| Coluna | Tipo | Nulo | Chave | Descrição |\n|---|---|---|---|---|")
        for c in info["cols"]:
            key = "PK" if c["name"] in info["pk"] else ""
            if c["name"] in info["fk"]:
                key = (key + " " if key else "") + f"FK → {info['fk'][c['name']]}"
            desc = d.get(c["name"]) or COMMON.get(c["name"], "")
            m = re.search(rf"\n\s*{c['name']}\s[^\n]*CHECK \(([^\n]*?)\)(?:,|\n)", SQL)
            if m and not desc:
                desc = f"Regra: {m.group(1)}"
            if not desc and key.startswith("PK") and "FK" not in key:
                desc = "Identificador do registro."
            desc = desc.replace("|", "/")
            out.append(f"| `{c['name']}` | {c['type']} | {'sim' if c['null'] and key[:2] != 'PK' else 'não'} | {key} | {desc} |")
    doc = DOC.read_text(encoding="utf-8")
    start, end = "<!-- DICIONARIO:INICIO -->", "<!-- DICIONARIO:FIM -->"
    doc = doc[: doc.index(start) + len(start)] + "\n" + "\n".join(out) + "\n\n" + doc[doc.index(end):]
    DOC.write_text(doc, encoding="utf-8")
    print(f"Dicionário: {len(t)} tabelas")


if __name__ == "__main__":
    main()
