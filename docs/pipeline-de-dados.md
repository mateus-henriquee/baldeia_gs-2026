# Pipeline de dados

Diagrama: [`apps/web/public/assets/diagrams/data-pipeline.svg`](../apps/web/public/assets/diagrams/data-pipeline.svg) (fonte: `docs/diagrams/build_diagrams.py` e `docs/diagrams/data-pipeline.mmd`).

Código: `pipeline/baldeia_pipeline/` (Python 3.11+, pandas, NumPy). Testes: `pipeline/tests/` (pytest, feed GTFS controlado).

```bash
npm run pipeline        # = cd pipeline && python -m baldeia_pipeline.run
npm run pipeline:test   # 7 testes
```

## Visão geral (estado implementado)

| Etapa | Onde | Entrada → saída | Execução real (05/11/2026) |
|---|---|---|---|
| 1. Coleta/ingestão | `bronze.py` | `.zip` GTFS → `data/bronze/<fonte>/<job>/` | 11 ms |
| 2. Armazenamento bruto (Bronze) | `bronze.py` | cópia + `_ingestion.json` | — |
| 3. Tratamento e limpeza (Silver) | `silver.py`, `quality.py` | `.txt` → CSV tipado + `_quarentena/` | 119 ms |
| 4. Integração e transformação (Gold) | `gold.py` | Silver → tabelas de serviço + GeoJSON | 160 ms |
| 5. Análise | `analysis.py` + views SQL | Gold → `analytics.json`; agregados no banco | 43 ms |
| 6. Disponibilização | `apps/api/src/db/loadGold.ts` + API | Gold → PostgreSQL → planejador, mapa, relatórios | carga ~2,5 s (PGlite) |
| 7. Monitoramento e feedback | `quality_checks`, `ingestion_jobs`, `/api/public/status`, `recommendations.feedback` | — | contínuo |

Dataset ativo: `dsv_b944d5374b20_p1.1.0` (hash da fonte + versão do pipeline). Uma re-execução com o mesmo arquivo gera novo `job_id` e registra `duplicado_de` — há dois jobs no Bronze do repositório demonstrando isso.

## Etapa 1–2 — Ingestão e Bronze

- Recebe um `.zip` GTFS (arquivo local; a fonte oficial completa exige download autenticado).
- Calcula **SHA-256**, tamanho, horário UTC e linhas por arquivo.
- Copia o `.zip` original e extrai os `.txt` **sem nenhuma alteração**.
- Grava `_ingestion.json` (job, fonte, status, erros, duplicidade).
- **Por que imutável:** se uma regra da Silver tiver erro, reprocessamos a partir do Bronze sem baixar de novo. Bronze é camada de recuperação, não de consumo.

Mecanismo por fonte (atual e previsto):

| Fonte | Como chega | Mecanismo |
|---|---|---|
| GTFS (SPTrans, EMTU) | arquivo `.zip` | lote, `run.py --source` |
| Olho Vivo *(prev.)* | REST/JSON com token | coletor periódico → Bronze JSON por minuto |
| GTFS-RT *(prev.)* | Protocol Buffers | coletor periódico → Bronze `.pb` |
| Relatos | HTTP POST autenticado | API → tabela operacional (validação síncrona) |
| Interações | HTTP | API → tabelas operacionais (com consentimento) |
| GPS | navegador | **não sai do aparelho** |

## Etapa 3 — Silver (tratamento e validação)

Todas as regras geram uma linha no relatório de qualidade (`quality_report.json` → tabela `quality_checks`). **Nenhum registro é descartado em silêncio**: reprovados vão para `data/silver/<fonte>/_quarentena/<tabela>.csv` com a coluna `_motivo_quarentena`.

| Operação | Regra | Ação |
|---|---|---|
| Arquivos obrigatórios | agency, stops, routes, trips, stop_times | bloqueio |
| Colunas obrigatórias | por arquivo (ver `config.REQUIRED_COLUMNS`) | bloqueio |
| Espaços e BOM | `strip` em cabeçalhos e valores; `utf-8-sig` | normalização |
| Duplicidade exata | linhas idênticas | quarentena |
| Chave primária | ex.: `(trip_id, stop_sequence)` | quarentena das repetidas |
| Campos obrigatórios vazios | completude | quarentena |
| Coordenadas | lat ∈ [-90, 90], lon ∈ [-180, 180] | quarentena |
| Fora da RMSP | caixa lat [-24,1; -23,0], lon [-47,3; -45,6] | **alerta** (não descarta) |
| Horários | `HH:MM:SS`, aceitando ≥ 24 h (viagens após meia-noite) | quarentena se inválido |
| Monotonicidade | chegada ≥ partida anterior | alerta |
| Integridade referencial | trip→route, stop_time→trip/stop | quarentena |
| Domínio | `route_type` GTFS (0–7, 11, 12, 100–1700) | quarentena |
| Cores | hexadecimal de 6 dígitos | imputação (cor padrão; texto por contraste WCAG) |
| Frequências | headway > 0, início < fim | quarentena |
| Calendário | datas `AAAAMMDD` válidas; **vigência** | alerta de atualidade |
| Texto para busca | minúsculas sem acento (`name_search`) | coluna derivada |

**Resultado real:** 54 verificações, 51 aprovadas, 3 com ressalvas, 0 registros em quarentena:
- `calendar:vigencia` — 6 de 6 serviços expirados (fim em 01/05/2020) → todo resultado de rota exibe aviso de dado histórico;
- `routes:route_text_color_hex` — 9 de 19 linhas sem cor de texto → imputada por contraste (preto sobre a L4 amarela, por exemplo);
- `route_segments:velocidade_plausivel` — 19 de 824 trechos com velocidade atípica (ver Gold).

## Etapa 4 — Gold (integração)

| Saída | Linhas | Descrição |
|---|---|---|
| `route_segments.csv` | 824 | trecho parada→parada: tempo, distância (haversine), velocidade, `imputed`, `anomaly`, `robust_z` |
| `stop_transfers.csv` | 2.416 | pares de paradas a ≤ 400 m em linha reta; caminhada = dist × 1,3 ÷ 1,1 m/s |
| `route_shapes.geojson` | 36 | traçados simplificados (Douglas–Peucker, tolerância ~22 m) |
| `stops.csv` | 654 | + `kind` (estação se atendida por metrô/trem), `modes`, `name_search` |
| `routes.csv` | 19 | + `mode` derivado de `route_type` |
| `trips, stop_times, frequencies, calendar, agencies` | — | tipadas, prontas para carga |

Integrações relevantes:
- **Relato ↔ rede:** cada relato referencia `stop_id` (e opcionalmente `route_id`), validado contra a view `v_stop_routes` (a linha precisa atender a parada).
- **Estações homônimas** (ex.: três `stop_id` para Tatuapé — Metrô e CPTM) são agrupadas em memória como `estacao:tatuape` quando a até 600 m.
- **Imputação:** trechos com tempo ≤ 0 recebem tempo pela velocidade mediana do modo e `imputed = true` (zero casos nesta versão; testado com feed controlado).
- **Anomalias:** z-score robusto da velocidade por modo; |z| > 3,5 → `anomaly = true`. Caso real: **CPTM L11, Tatuapé ↔ Dom Bosco, 13,1 km em 6 min (130,9 km/h, z = 8,26)** — valor implausível no feed. Mantido, sinalizado e avisado ao usuário quando a rota usa o trecho.

Linhagem: `_manifest.json` registra versão, fonte, hash, job, etapas com duração e linhas, premissas e resumo de qualidade.

## Etapa 5 — Análise

`analytics.json` (oferta **planejada**, não observada):
- **Rede:** 19 linhas (6 metrô, 7 trem, 6 ônibus); 188 estações e 466 pontos; 2.416 conexões a pé (mediana 294 s).
- **Velocidade programada por trecho (km/h):** metrô mediana 25,5 (p25–p75: 20,1–31,3); ônibus 9,2 (6,8–12,2); trem 23,7 (15,1–33,1).
- **Intervalo mediano programado (dias úteis):** metrô 2,5 min às 6h–8h e 2 min às 19h; trem 5 min às 6h–8h; ônibus 12 min às 8h.
- No banco: agregados de relatos por hora/tipo com **k-anonimato (k = 3)**; hábitos do usuário calculados sob demanda.

## Etapa 6 — Disponibilização

`loadGold.ts` (idempotente): sincroniza o catálogo de fontes; insere `dataset_versions`, `ingestion_jobs` e `quality_checks`; faz *upsert* de agências, linhas, paradas e calendário (preserva linhas referenciadas por dados de usuários); substitui tabelas derivadas; ativa a nova versão (índice único garante uma ativa por fonte). A API monta o grafo em memória a partir dessas tabelas.

Consumidores: planejador (`POST /api/plan`), mapa (`/api/public/network`), alertas (`/api/community/reports`), relatórios (`/api/me/habits`, `/api/public/analytics`), transparência (`/api/public/transparency`).

## Etapa 7 — Monitoramento e feedback

| Sinal | Onde |
|---|---|
| Qualidade por versão | `quality_checks` + página /transparencia |
| Atualização das fontes | `ingestion_jobs`, `dataset_versions.generated_at`, alerta de vigência |
| Falhas de integração | status do job; carga em transação (falha = nada muda) |
| Tempo de processamento | `duracao_ms` por etapa; latência p50/p95 por rota em `/api/public/status`; `compute_ms` por recomendação |
| Desempenho das recomendações | botão "Foi útil?" → `recommendations.feedback`; alternativa escolhida → `chosen_index` |
| Saúde da comunidade | denúncias, fila de moderação, reputação |

**Ainda não implementado:** agendamento automático de ingestão (cron), alerta ativo quando a fonte fica velha, painel de séries históricas de qualidade. Ver próximos passos no README.
