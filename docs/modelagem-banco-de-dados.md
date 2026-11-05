# Modelagem do banco de dados

- **SGBD:** PostgreSQL 16+. Em desenvolvimento, o mesmo SQL roda no **PGlite** (PostgreSQL compilado para WebAssembly, embutido no Node) — nenhum servidor precisa ser instalado. Com `DATABASE_URL`, a API usa um PostgreSQL externo (ex.: `docker compose up -d`, imagem com PostGIS).
- **Schema físico:** [`database/migrations/001_schema.sql`](../database/migrations/001_schema.sql) · PostGIS opcional: `002_postgis_optional.sql` (**não testado** neste ambiente — sem PostGIS disponível).
- **ERD:** [`entity-relationship.svg`](../apps/web/public/assets/diagrams/entity-relationship.svg), **gerado a partir do SQL** (`npm run diagrams`). O dicionário abaixo também.

## 1. Modelo conceitual

Seis domínios:

1. **Governança e linhagem** — de onde veio cada dado, em que versão, com que qualidade.
2. **Rede de transporte** — linhas, paradas, viagens, horários, frequências, trechos, conexões a pé, traçados, alertas oficiais.
3. **Usuários e consentimento** — conta, preferências, consentimentos por finalidade, favoritos.
4. **Viagens e recomendações** — viagens, etapas, paradas confirmadas, recomendações e feedback.
5. **Comunidade** — relatos, confirmações/contestações, denúncias.
6. **Auditoria** — eventos relevantes, com ator pseudônimo.

Relações essenciais (linguagem natural):
- Uma **fonte** tem muitas **versões de dataset**; cada versão tem muitas **verificações de qualidade** e é referenciada por toda linha da rede.
- Uma **linha** tem muitas **viagens**; cada viagem tem muitos **horários por parada** (e janelas de **frequência**); trechos consecutivos formam **segmentos**.
- Uma **parada** participa de muitos horários, conexões a pé, relatos, favoritos e etapas de viagem.
- Um **usuário** tem preferências (1:1), consentimentos (1:N, log), favoritos, viagens, recomendações, relatos, votos e denúncias.
- Um **relato** pertence a uma parada (e opcionalmente a uma linha) e recebe N confirmações e N denúncias, no máximo uma de cada por usuário.

## 2. Modelo lógico — chaves e cardinalidades

| Relação | Cardinalidade | Chave | Observação |
|---|---|---|---|
| data_sources → dataset_versions | 1:N | `dataset_versions.source_id` | índice único parcial: 1 versão ativa por fonte |
| dataset_versions → quality_checks | 1:N | `(dataset_version_id, check_code)` único | `ON DELETE CASCADE` |
| dataset_versions → agencies/routes/stops/calendar_services | 1:N | `dataset_version_id` | rastreabilidade linha a linha |
| agencies → routes | 1:N | `routes.agency_id` | |
| routes → trips | 1:N | `trips.route_id` | |
| calendar_services → trips | 1:N | `trips.service_id` | |
| trips → stop_times | 1:N | PK `(trip_id, stop_sequence)` | identificador composto natural do GTFS |
| stop_times → route_segments | 1:0..1 | FK composta `(trip_id, stop_sequence)` | segmento começa naquela parada |
| stops → stop_transfers | 1:N (×2) | PK `(from_stop_id, to_stop_id)` | `CHECK from <> to` |
| users → user_preferences | 1:1 | PK = FK `user_id` | |
| users → user_consents | 1:N | | append-only |
| users → favorite_places, journeys | 1:N | | `ON DELETE CASCADE` |
| journeys → journey_legs / journey_checkpoints | 1:N | PK compostas | |
| users → recommendations | 0..1:N | `user_id` **nulo** sem consentimento | |
| users → community_reports | 0..1:N | `ON DELETE SET NULL` | autoria anonimizada na exclusão |
| community_reports → report_confirmations / report_flags | 1:N | PK `(report_id, user_id)` | 1 voto e 1 denúncia por usuário |

## 3. Modelo físico — decisões

| Decisão | Justificativa |
|---|---|
| PKs textuais nas tabelas GTFS (`stop_id`, `route_id`…) | identificadores do operador; preservam rastreabilidade e facilitam recarga |
| PKs `uuid` (`gen_random_uuid()`) em dados de usuário | não sequenciais: não revelam volume nem permitem enumeração |
| Horários em **segundos inteiros** (`arrival_secs`) | GTFS permite > 24h; aritmética simples e exata |
| `lat/lon double precision` + índice `(lat, lon)` | funciona em PGlite e PostgreSQL puro; PostGIS (`geography` + GiST) é opcional |
| `route_segments` e `stop_transfers` materializadas | derivadas na Gold (camada analítica/serviço); separam operacional de analítico; recriadas a cada versão |
| *Upsert* de paradas/linhas na recarga | dados de usuários referenciam paradas; apagar quebraria integridade histórica |
| `user_consents` append-only | prova de consentimento e histórico de revogações (responsabilização) |
| Favoritos apontam para `stop_id` | minimização: não guardamos endereço residencial |
| `journey_checkpoints` sem coordenadas | GPS nunca chega ao servidor |
| `audit_logs` sem FK | trilha sobrevive à exclusão do usuário; ator vira pseudônimo |
| `CHECK` de domínio em textos enumerados | integridade no banco, não só na aplicação |
| Views `v_stop_routes`, `v_report_hourly` | camada analítica sobre dados operacionais, sem duplicação |

**Normalização:** tabelas operacionais em 3FN. Exceções conscientes (desnormalização controlada): `route_segments` (derivável de `stop_times`, materializada para desempenho e para carregar flags de qualidade) e `reporter_weight`/`voter_weight` (fotografia do peso no momento do voto — mudar a reputação depois não reescreve o passado).

**Índices:** `stops(lat, lon)`, `stops(name_search)`, `stop_times(stop_id)`, `trips(route_id)`, `community_reports(status, expires_at)`, `(stop_id, created_at)`, `(user_id, created_at)`, `journeys(user_id, created_at)`, `audit_logs(occurred_at)`, `user_consents(user_id, purpose, recorded_at)`; com PostGIS, GiST em `stops.geom`.

## 4. Regras de integridade

- Domínios: `mode`, `kind`, `category`, `integration_status`, `dimension`, `severity`, `status`, `purpose`, `label`, `type`, `vote`, `reason`, `role`.
- Faixas: `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`, `reputation ∈ [0, 1]`, `max_walk_m ∈ [0, 2000]`, `headway_secs > 0`, `travel_secs > 0`.
- Coerência: `departure_secs ≥ arrival_secs`; `end_date ≥ start_date`; `end_secs > start_secs`; `expires_at > created_at`; origem ≠ destino; `(kind = 'transporte') ⇔ route_id IS NOT NULL` em `journey_legs`.
- Unicidade: e-mail normalizado; favorito por nome; 1 voto e 1 denúncia por usuário/relato; 1 versão ativa por fonte.

## 5. Dicionário de dados

Gerado de `001_schema.sql` por `docs/diagrams/gen_dictionary.py`. "Nulo = sim" indica coluna opcional.

<!-- DICIONARIO:INICIO -->

#### `data_sources` — Catálogo de fontes pesquisadas e estado real de integração.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `source_id` | text | não | PK | Fonte de dados (catálogo). |
| `name` | text | não |  |  |
| `owner` | text | não |  |  |
| `url` | text | não |  |  |
| `category` | text | não |  | oficial / geografica / comunitaria / comportamental / demonstrativa |
| `integration_status` | text | não |  | integrada / integrada_amostra / planejada / indisponivel |
| `data_format` | text | sim |  |  |
| `update_frequency` | text | sim |  |  |
| `license` | text | sim |  |  |
| `limitations` | text | sim |  |  |
| `consulted_on` | date | sim |  | Data da consulta. |

#### `dataset_versions` — Versão de cada carga da Gold; uma ativa por fonte.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `dataset_version_id` | text | não | PK | Versão do dataset que originou o registro (linhagem). |
| `source_id` | text | não | FK → data_sources | Fonte de dados (catálogo). |
| `sha256` | char(64) | não |  | Hash do arquivo de origem. |
| `pipeline_version` | text | não |  |  |
| `generated_at` | timestamptz | não |  |  |
| `loaded_at` | timestamptz | não |  |  |
| `is_active` | boolean | não |  | Versão em uso pelo produto. |
| `manifest` | jsonb | não |  | Manifesto de linhagem (_manifest.json). |

#### `ingestion_jobs` — Execuções de ingestão (Bronze).

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `job_id` | text | não | PK | Identificador do registro. |
| `source_id` | text | não | FK → data_sources | Fonte de dados (catálogo). |
| `dataset_version_id` | text | sim | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `started_at` | timestamptz | não |  |  |
| `finished_at` | timestamptz | sim |  |  |
| `status` | text | não |  | Regra: status IN ('running','success','failed') |
| `records_received` | jsonb | não |  | Linhas recebidas por arquivo. |
| `bronze_path` | text | sim |  | Pasta imutável do dado bruto. |

#### `quality_checks` — Resultado de cada regra de qualidade por versão.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `quality_check_id` | bigserial | não | PK | Identificador do registro. |
| `dataset_version_id` | text | não | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `check_code` | text | não |  |  |
| `table_name` | text | não |  |  |
| `dimension` | text | não |  | completude / validade / unicidade / consistencia / atualidade / precisao |
| `rule` | text | não |  |  |
| `records_checked` | integer | não |  | Regra: records_checked >= 0 |
| `records_failed` | integer | não |  | Regra: records_failed >= 0 |
| `action` | text | não |  | quarentena / alerta / imputacao / bloqueio / nenhuma |
| `severity` | text | não |  | Regra: severity IN ('info','aviso','erro') |
| `status` | text | não |  | aprovado / aprovado_com_ressalvas / reprovado |
| `details` | text | sim |  |  |

#### `agencies` — Operadores do feed.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `agency_id` | text | não | PK | Identificador do registro. |
| `dataset_version_id` | text | não | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `name` | text | não |  |  |
| `url` | text | sim |  |  |
| `timezone` | text | não |  |  |
| `lang` | text | sim |  |  |

#### `routes` — Linhas de transporte.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `route_id` | text | não | PK | Linha (GTFS). |
| `agency_id` | text | não | FK → agencies |  |
| `dataset_version_id` | text | não | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `short_name` | text | sim |  |  |
| `long_name` | text | sim |  |  |
| `route_type` | smallint | não |  |  |
| `mode` | text | não |  | onibus / metro / trem / outro (derivado de route_type). |
| `color` | char(6) | não |  | Cor da linha (hex). |
| `text_color` | char(6) | não |  |  |

#### `stops` — Paradas e estações.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `stop_id` | text | não | PK | Parada/estação (GTFS). |
| `dataset_version_id` | text | não | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `name` | text | não |  |  |
| `description` | text | sim |  |  |
| `lat` | double | não |  | Latitude WGS84. |
| `lon` | double | não |  | Longitude WGS84. |
| `kind` | text | não |  | estacao (metrô/trem) / ponto (ônibus). |
| `name_search` | text | não |  | Nome normalizado para busca. |
| `outside_expected_area` | boolean | não |  |  |

#### `calendar_services` — Dias de operação de cada serviço.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `service_id` | text | não | PK | Identificador do registro. |
| `dataset_version_id` | text | não | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `monday` | boolean | não |  |  |
| `tuesday` | boolean | não |  |  |
| `wednesday` | boolean | não |  |  |
| `thursday` | boolean | não |  |  |
| `friday` | boolean | não |  |  |
| `saturday` | boolean | não |  |  |
| `sunday` | boolean | não |  |  |
| `start_date` | date | não |  |  |
| `end_date` | date | não |  |  |
| `expired` | boolean | não |  | Calendário fora de vigência na data da carga. |

#### `trips` — Viagens-modelo (padrões) por linha e sentido.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `trip_id` | text | não | PK | Viagem-modelo (GTFS). |
| `route_id` | text | não | FK → routes | Linha (GTFS). |
| `service_id` | text | não | FK → calendar_services |  |
| `direction_id` | smallint | não |  | Sentido (0/1). |
| `headsign` | text | sim |  |  |
| `shape_id` | text | sim |  |  |

#### `stop_times` — Horários relativos/absolutos por parada da viagem.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `trip_id` | text | não | PK FK → trips | Viagem-modelo (GTFS). |
| `stop_sequence` | integer | não | PK | Identificador do registro. |
| `stop_id` | text | não | FK → stops | Parada/estação (GTFS). |
| `arrival_secs` | integer | não |  | Segundos desde o início do dia de serviço (aceita ≥ 86400). |
| `departure_secs` | integer | não |  | Regra: departure_secs >= arrival_secs |

#### `frequencies` — Janelas de serviço por frequência.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `trip_id` | text | não | PK FK → trips | Viagem-modelo (GTFS). |
| `start_secs` | integer | não | PK | Identificador do registro. |
| `end_secs` | integer | não |  |  |
| `headway_secs` | integer | não |  | Intervalo programado entre veículos. |

#### `route_segments` — Trechos parada→parada (Gold) usados pelo roteador.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `trip_id` | text | não | PK FK → trips | Viagem-modelo (GTFS). |
| `stop_sequence` | integer | não | PK FK → stop_times |  |
| `from_stop_id` | text | não | FK → stops |  |
| `to_stop_id` | text | não | FK → stops |  |
| `travel_secs` | integer | não |  | Regra: travel_secs > 0 |
| `distance_m` | numeric(10,1) | não |  | Regra: distance_m >= 0 |
| `speed_kmh` | numeric(7,2) | não |  |  |
| `imputed` | boolean | não |  | Tempo imputado pelo pipeline. |
| `anomaly` | boolean | não |  | Velocidade atípica (/z robusto/ > 3,5). |
| `robust_z` | numeric(7,2) | sim |  | Z-score robusto da velocidade no modo. |

#### `stop_transfers` — Conexões a pé ≤ 400 m (premissa).

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `from_stop_id` | text | não | PK FK → stops |  |
| `to_stop_id` | text | não | PK FK → stops |  |
| `distance_m` | numeric(8,1) | não |  | Regra: distance_m >= 0 |
| `walk_secs` | integer | não |  | Tempo estimado (fator 1,3; 1,1 m/s). |

#### `route_shapes` — Traçado simplificado (GeoJSON) por linha e sentido.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `route_id` | text | não | PK FK → routes | Linha (GTFS). |
| `direction_id` | smallint | não | PK | Regra: direction_id IN (0,1) |
| `geojson` | jsonb | não |  |  |

#### `service_alerts` — Alertas oficiais (GTFS-RT). Vazia: sem fonte integrada.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `alert_id` | uuid | não | PK | Identificador do registro. |
| `source_id` | text | não | FK → data_sources | Fonte de dados (catálogo). |
| `external_id` | text | sim |  |  |
| `header_text` | text | não |  |  |
| `description_text` | text | sim |  |  |
| `cause` | text | sim |  |  |
| `effect` | text | sim |  |  |
| `route_id` | text | sim | FK → routes | Linha (GTFS). |
| `stop_id` | text | sim | FK → stops | Parada/estação (GTFS). |
| `active_from` | timestamptz | não |  |  |
| `active_until` | timestamptz | sim |  |  |
| `received_at` | timestamptz | não |  |  |

#### `users` — Contas.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `user_id` | uuid | não | PK | Usuário titular/autor. |
| `email` | text | não |  |  |
| `email_normalized` | text | não |  | E-mail em minúsculas (unicidade). |
| `password_hash` | text | não |  | bcrypt; nunca exportado. |
| `display_name` | varchar(40) | não |  |  |
| `role` | text | não |  | Regra: role IN ('usuario','moderador','admin') |
| `email_verified_at` | timestamptz | sim |  |  |
| `verification_token_hash` | char(64) | sim |  | SHA-256 do token de verificação. |
| `token_version` | integer | não |  | Invalida sessões ao incrementar. |
| `reputation` | numeric(4,3) | não |  | Reputação bayesiana (0–1) para relatos. |
| `is_demo` | boolean | não |  | Registro sintético de demonstração. |
| `created_at` | timestamptz | não |  | Momento de criação (UTC). |
| `last_login_at` | timestamptz | sim |  |  |

#### `user_preferences` — Preferências de trajeto.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `user_id` | uuid | não | PK FK → users | Usuário titular/autor. |
| `preferred_modes` | text[] | não |  |  |
| `max_walk_m` | integer | não |  | Caminhada máxima por conexão. |
| `prefer_less_walking` | boolean | não |  |  |
| `updated_at` | timestamptz | não |  |  |

#### `user_consents` — Log append-only de consentimentos por finalidade.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `consent_id` | bigserial | não | PK | Identificador do registro. |
| `user_id` | uuid | não | FK → users | Usuário titular/autor. |
| `purpose` | text | não |  | historico_viagens / analise_habitos / geolocalizacao / comunidade_publicar |
| `granted` | boolean | não |  |  |
| `legal_basis` | text | não |  | Base legal registrada. |
| `policy_version` | text | não |  |  |
| `recorded_at` | timestamptz | não |  |  |

#### `favorite_places` — Destinos favoritos (apontam para parada, não endereço).

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `favorite_id` | uuid | não | PK | Identificador do registro. |
| `user_id` | uuid | não | FK → users | Usuário titular/autor. |
| `label` | text | não |  | casa / trabalho / faculdade / escola / outro |
| `custom_name` | varchar(40) | não |  |  |
| `stop_id` | text | não | FK → stops | Parada/estação (GTFS). |
| `created_at` | timestamptz | não |  | Momento de criação (UTC). |

#### `journeys` — Viagens iniciadas (somente com consentimento de histórico).

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `journey_id` | uuid | não | PK | Identificador do registro. |
| `user_id` | uuid | não | FK → users | Usuário titular/autor. |
| `origin_stop_id` | text | não | FK → stops |  |
| `destination_stop_id` | text | não | FK → stops |  |
| `requested_departure` | timestamptz | não |  |  |
| `profile` | text | não |  |  |
| `status` | text | não |  | Regra: status IN ('running','success','failed') |
| `planned_duration_secs` | integer | não |  | Duração planejada. |
| `transfers` | smallint | não |  |  |
| `saved_to_history` | boolean | não |  | Salva por consentimento. |
| `is_demo` | boolean | não |  | Registro sintético de demonstração. |
| `dataset_version_id` | text | não | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `created_at` | timestamptz | não |  | Momento de criação (UTC). |
| `started_at` | timestamptz | sim |  |  |
| `completed_at` | timestamptz | sim |  |  |

#### `journey_legs` — Etapas (caminhada/transporte) de uma viagem.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `journey_id` | uuid | não | PK FK → journeys |  |
| `leg_index` | smallint | não | PK | Identificador do registro. |
| `kind` | text | não |  | Regra: kind IN ('estacao','ponto') |
| `route_id` | text | sim | FK → routes | Linha (GTFS). |
| `from_stop_id` | text | não | FK → stops |  |
| `to_stop_id` | text | não | FK → stops |  |
| `departure_secs` | integer | não |  | Regra: departure_secs >= arrival_secs |
| `arrival_secs` | integer | não |  | Regra: arrival_secs >= 0 |
| `wait_secs` | integer | não |  |  |
| `stop_ids` | text[] | não |  | Sequência de paradas da etapa. |

#### `journey_checkpoints` — Paradas confirmadas (manual/GPS) — sem coordenadas.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `journey_id` | uuid | não | PK FK → journeys |  |
| `stop_id` | text | não | PK FK → stops | Parada/estação (GTFS). |
| `method` | text | não |  | manual / gps |
| `confirmed_at` | timestamptz | não |  |  |

#### `recommendations` — Recomendações calculadas, para monitoramento.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `recommendation_id` | uuid | não | PK | Identificador do registro. |
| `user_id` | uuid | sim | FK → users | Só preenchido com consentimento. |
| `journey_id` | uuid | sim | FK → journeys |  |
| `dataset_version_id` | text | não | FK → dataset_versions | Versão do dataset que originou o registro (linhagem). |
| `request` | jsonb | não |  |  |
| `alternatives` | jsonb | não |  |  |
| `criteria_availability` | jsonb | não |  | Critérios disponíveis e motivos. |
| `chosen_index` | smallint | sim |  |  |
| `feedback` | text | sim |  | util / nao_util |
| `compute_ms` | numeric(8,1) | não |  |  |
| `created_at` | timestamptz | não |  | Momento de criação (UTC). |

#### `community_reports` — Relatos comunitários.

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `report_id` | uuid | não | PK | Identificador do registro. |
| `user_id` | uuid | sim | FK → users | Autor; vira NULL se a conta for excluída. |
| `type` | text | não |  | superlotacao / atraso / linha_parada / interrupcao / enchente / acidente / assalto / problema_estacao |
| `stop_id` | text | não | FK → stops | Parada/estação (GTFS). |
| `route_id` | text | sim | FK → routes | Linha (GTFS). |
| `description` | varchar(280) | sim |  | Até 280 caracteres, com dados pessoais removidos; apagado 30 dias após expirar. |
| `reporter_weight` | numeric(4,3) | não |  | Peso do autor no momento do relato. |
| `status` | text | não |  | ativo / oculto_moderacao / removido |
| `moderation_note` | text | sim |  |  |
| `is_demo` | boolean | não |  | Registro sintético de demonstração. |
| `created_at` | timestamptz | não |  | Momento de criação (UTC). |
| `expires_at` | timestamptz | não |  | Expiração automática por tipo. |

#### `report_confirmations` — Confirmações e contestações (1 por usuário).

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `report_id` | uuid | não | PK FK → community_reports |  |
| `user_id` | uuid | não | PK FK → users | Usuário titular/autor. |
| `vote` | text | não |  | confirma / contesta |
| `voter_weight` | numeric(4,3) | não |  | Peso do votante. |
| `created_at` | timestamptz | não |  | Momento de criação (UTC). |

#### `report_flags` — Denúncias (3 ocultam o relato).

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `report_id` | uuid | não | PK FK → community_reports |  |
| `user_id` | uuid | não | PK FK → users | Usuário titular/autor. |
| `reason` | text | não |  | falso / ofensivo / dados_pessoais / spam / outro |
| `created_at` | timestamptz | não |  | Momento de criação (UTC). |

#### `audit_logs` — Trilha de auditoria (sem FK para sobreviver à exclusão).

| Coluna | Tipo | Nulo | Chave | Descrição |
|---|---|---|---|---|
| `audit_id` | bigserial | não | PK | Identificador do registro. |
| `occurred_at` | timestamptz | não |  |  |
| `actor_user_id` | uuid | sim |  | Pseudônimo do ator. |
| `action` | text | não |  |  |
| `entity` | text | não |  |  |
| `entity_id` | text | sim |  |  |
| `metadata` | jsonb | não |  |  |
| `ip_hash` | char(64) | sim |  | SHA-256 do IP com segredo. |

<!-- DICIONARIO:FIM -->
