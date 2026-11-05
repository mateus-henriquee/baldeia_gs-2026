-- =====================================================================
-- Baldeia — modelo físico (PostgreSQL 16+ / PGlite)
-- Convenções: snake_case, PK explícitas, FKs nomeadas, datas ISO (timestamptz em UTC).
-- Documentação: docs/modelagem-banco-de-dados.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GOVERNANÇA E LINHAGEM
-- ---------------------------------------------------------------------
CREATE TABLE data_sources (
  source_id         text PRIMARY KEY,
  name              text NOT NULL,
  owner             text NOT NULL,
  url               text NOT NULL,
  category          text NOT NULL CHECK (category IN ('oficial','geografica','comunitaria','comportamental','demonstrativa')),
  integration_status text NOT NULL CHECK (integration_status IN ('integrada','integrada_amostra','planejada','indisponivel')),
  data_format       text,
  update_frequency  text,
  license           text,
  limitations       text,
  consulted_on      date
);

CREATE TABLE dataset_versions (
  dataset_version_id text PRIMARY KEY,
  source_id          text NOT NULL REFERENCES data_sources(source_id),
  sha256             char(64) NOT NULL,
  pipeline_version   text NOT NULL,
  generated_at       timestamptz NOT NULL,
  loaded_at          timestamptz NOT NULL DEFAULT now(),
  is_active          boolean NOT NULL DEFAULT false,
  manifest           jsonb NOT NULL
);
CREATE UNIQUE INDEX ux_dataset_versions_active ON dataset_versions(source_id) WHERE is_active;

CREATE TABLE ingestion_jobs (
  job_id             text PRIMARY KEY,
  source_id          text NOT NULL REFERENCES data_sources(source_id),
  dataset_version_id text REFERENCES dataset_versions(dataset_version_id),
  started_at         timestamptz NOT NULL,
  finished_at        timestamptz,
  status             text NOT NULL CHECK (status IN ('running','success','failed')),
  records_received   jsonb NOT NULL DEFAULT '{}'::jsonb,
  bronze_path        text
);

CREATE TABLE quality_checks (
  quality_check_id   bigserial PRIMARY KEY,
  dataset_version_id text NOT NULL REFERENCES dataset_versions(dataset_version_id) ON DELETE CASCADE,
  check_code         text NOT NULL,
  table_name         text NOT NULL,
  dimension          text NOT NULL CHECK (dimension IN ('completude','validade','unicidade','consistencia','atualidade','precisao')),
  rule               text NOT NULL,
  records_checked    integer NOT NULL CHECK (records_checked >= 0),
  records_failed     integer NOT NULL CHECK (records_failed >= 0),
  action             text NOT NULL,
  severity           text NOT NULL CHECK (severity IN ('info','aviso','erro')),
  status             text NOT NULL CHECK (status IN ('aprovado','aprovado_com_ressalvas','reprovado')),
  details            text,
  UNIQUE (dataset_version_id, check_code)
);

-- ---------------------------------------------------------------------
-- 2. REDE DE TRANSPORTE (referência, carregada da camada Gold)
-- ---------------------------------------------------------------------
CREATE TABLE agencies (
  agency_id          text PRIMARY KEY,
  dataset_version_id text NOT NULL REFERENCES dataset_versions(dataset_version_id),
  name               text NOT NULL,
  url                text,
  timezone           text NOT NULL,
  lang               text
);

CREATE TABLE routes (
  route_id           text PRIMARY KEY,
  agency_id          text NOT NULL REFERENCES agencies(agency_id),
  dataset_version_id text NOT NULL REFERENCES dataset_versions(dataset_version_id),
  short_name         text,
  long_name          text,
  route_type         smallint NOT NULL,
  mode               text NOT NULL CHECK (mode IN ('onibus','metro','trem','outro')),
  color              char(6) NOT NULL,
  text_color         char(6) NOT NULL
);

CREATE TABLE stops (
  stop_id            text PRIMARY KEY,
  dataset_version_id text NOT NULL REFERENCES dataset_versions(dataset_version_id),
  name               text NOT NULL,
  description        text,
  lat                double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon                double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  kind               text NOT NULL CHECK (kind IN ('estacao','ponto')),
  name_search        text NOT NULL,
  outside_expected_area boolean NOT NULL DEFAULT false
);
CREATE INDEX ix_stops_lat_lon ON stops(lat, lon);
CREATE INDEX ix_stops_name_search ON stops(name_search);

CREATE TABLE calendar_services (
  service_id         text PRIMARY KEY,
  dataset_version_id text NOT NULL REFERENCES dataset_versions(dataset_version_id),
  monday boolean NOT NULL, tuesday boolean NOT NULL, wednesday boolean NOT NULL, thursday boolean NOT NULL,
  friday boolean NOT NULL, saturday boolean NOT NULL, sunday boolean NOT NULL,
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  expired            boolean NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE trips (
  trip_id            text PRIMARY KEY,
  route_id           text NOT NULL REFERENCES routes(route_id),
  service_id         text NOT NULL REFERENCES calendar_services(service_id),
  direction_id       smallint NOT NULL CHECK (direction_id IN (0,1)),
  headsign           text,
  shape_id           text
);
CREATE INDEX ix_trips_route ON trips(route_id);

CREATE TABLE stop_times (
  trip_id            text NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  stop_sequence      integer NOT NULL,
  stop_id            text NOT NULL REFERENCES stops(stop_id),
  arrival_secs       integer NOT NULL CHECK (arrival_secs >= 0),
  departure_secs     integer NOT NULL CHECK (departure_secs >= arrival_secs),
  PRIMARY KEY (trip_id, stop_sequence)
);
CREATE INDEX ix_stop_times_stop ON stop_times(stop_id);

CREATE TABLE frequencies (
  trip_id            text NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  start_secs         integer NOT NULL,
  end_secs           integer NOT NULL,
  headway_secs       integer NOT NULL CHECK (headway_secs > 0),
  PRIMARY KEY (trip_id, start_secs),
  CHECK (end_secs > start_secs)
);

-- Tabela derivada (Gold) para servir o roteador; rastreável via trips → dataset_version.
CREATE TABLE route_segments (
  trip_id            text NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  stop_sequence      integer NOT NULL,
  from_stop_id       text NOT NULL REFERENCES stops(stop_id),
  to_stop_id         text NOT NULL REFERENCES stops(stop_id),
  travel_secs        integer NOT NULL CHECK (travel_secs > 0),
  distance_m         numeric(10,1) NOT NULL CHECK (distance_m >= 0),
  speed_kmh          numeric(7,2) NOT NULL,
  imputed            boolean NOT NULL DEFAULT false,
  anomaly            boolean NOT NULL DEFAULT false,
  robust_z           numeric(7,2),
  PRIMARY KEY (trip_id, stop_sequence),
  FOREIGN KEY (trip_id, stop_sequence) REFERENCES stop_times(trip_id, stop_sequence) ON DELETE CASCADE
);

CREATE TABLE stop_transfers (
  from_stop_id       text NOT NULL REFERENCES stops(stop_id),
  to_stop_id         text NOT NULL REFERENCES stops(stop_id),
  distance_m         numeric(8,1) NOT NULL CHECK (distance_m >= 0),
  walk_secs          integer NOT NULL CHECK (walk_secs >= 0),
  PRIMARY KEY (from_stop_id, to_stop_id),
  CHECK (from_stop_id <> to_stop_id)
);

CREATE TABLE route_shapes (
  route_id           text NOT NULL REFERENCES routes(route_id),
  direction_id       smallint NOT NULL,
  geojson            jsonb NOT NULL,
  PRIMARY KEY (route_id, direction_id)
);

-- Alertas oficiais (GTFS Realtime Alerts). Sem integração ativa na demonstração: fica vazia.
CREATE TABLE service_alerts (
  alert_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          text NOT NULL REFERENCES data_sources(source_id),
  external_id        text,
  header_text        text NOT NULL,
  description_text   text,
  cause              text,
  effect             text,
  route_id           text REFERENCES routes(route_id),
  stop_id            text REFERENCES stops(stop_id),
  active_from        timestamptz NOT NULL,
  active_until       timestamptz,
  received_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

-- ---------------------------------------------------------------------
-- 3. USUÁRIOS, PREFERÊNCIAS E CONSENTIMENTOS (dados pessoais)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  user_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  email_normalized   text NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  display_name       varchar(40) NOT NULL,
  role               text NOT NULL DEFAULT 'usuario' CHECK (role IN ('usuario','moderador','admin')),
  email_verified_at  timestamptz,
  verification_token_hash char(64),
  token_version      integer NOT NULL DEFAULT 0,
  reputation         numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (reputation BETWEEN 0 AND 1),
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_login_at      timestamptz
);

CREATE TABLE user_preferences (
  user_id            uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  preferred_modes    text[] NOT NULL DEFAULT ARRAY['onibus','metro','trem'],
  max_walk_m         integer NOT NULL DEFAULT 400 CHECK (max_walk_m BETWEEN 0 AND 2000),
  prefer_less_walking boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Log append-only: o estado vigente de cada finalidade é o registro mais recente.
CREATE TABLE user_consents (
  consent_id         bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  purpose            text NOT NULL CHECK (purpose IN ('historico_viagens','analise_habitos','geolocalizacao','comunidade_publicar')),
  granted            boolean NOT NULL,
  legal_basis        text NOT NULL,
  policy_version     text NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_user_consents_user_purpose ON user_consents(user_id, purpose, recorded_at DESC);

-- Favoritos apontam para uma parada/estação, não para um endereço (minimização de dados).
CREATE TABLE favorite_places (
  favorite_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  label              text NOT NULL CHECK (label IN ('casa','trabalho','faculdade','escola','outro')),
  custom_name        varchar(40) NOT NULL,
  stop_id            text NOT NULL REFERENCES stops(stop_id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, custom_name)
);

-- ---------------------------------------------------------------------
-- 4. VIAGENS E RECOMENDAÇÕES
-- ---------------------------------------------------------------------
CREATE TABLE journeys (
  journey_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  origin_stop_id     text NOT NULL REFERENCES stops(stop_id),
  destination_stop_id text NOT NULL REFERENCES stops(stop_id),
  requested_departure timestamptz NOT NULL,
  profile            text NOT NULL,
  status             text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada','em_andamento','concluida','cancelada')),
  planned_duration_secs integer NOT NULL CHECK (planned_duration_secs > 0),
  transfers          smallint NOT NULL DEFAULT 0,
  saved_to_history   boolean NOT NULL DEFAULT false,
  is_demo            boolean NOT NULL DEFAULT false,
  dataset_version_id text NOT NULL REFERENCES dataset_versions(dataset_version_id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  CHECK (origin_stop_id <> destination_stop_id)
);
CREATE INDEX ix_journeys_user_created ON journeys(user_id, created_at DESC);

CREATE TABLE journey_legs (
  journey_id         uuid NOT NULL REFERENCES journeys(journey_id) ON DELETE CASCADE,
  leg_index          smallint NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('caminhada','transporte')),
  route_id           text REFERENCES routes(route_id),
  from_stop_id       text NOT NULL REFERENCES stops(stop_id),
  to_stop_id         text NOT NULL REFERENCES stops(stop_id),
  departure_secs     integer NOT NULL,
  arrival_secs       integer NOT NULL,
  wait_secs          integer NOT NULL DEFAULT 0,
  stop_ids           text[] NOT NULL,
  PRIMARY KEY (journey_id, leg_index),
  CHECK ((kind = 'transporte') = (route_id IS NOT NULL)),
  CHECK (arrival_secs >= departure_secs)
);

-- Acompanhamento manual/GPS: registra apenas a parada confirmada, nunca coordenadas.
CREATE TABLE journey_checkpoints (
  journey_id         uuid NOT NULL REFERENCES journeys(journey_id) ON DELETE CASCADE,
  stop_id            text NOT NULL REFERENCES stops(stop_id),
  method             text NOT NULL CHECK (method IN ('manual','gps')),
  confirmed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_id, stop_id)
);

CREATE TABLE recommendations (
  recommendation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users(user_id) ON DELETE CASCADE,
  journey_id         uuid REFERENCES journeys(journey_id) ON DELETE SET NULL,
  dataset_version_id text NOT NULL REFERENCES dataset_versions(dataset_version_id),
  request            jsonb NOT NULL,
  alternatives       jsonb NOT NULL,
  criteria_availability jsonb NOT NULL,
  chosen_index       smallint,
  feedback           text CHECK (feedback IN ('util','nao_util')),
  compute_ms         numeric(8,1) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_recommendations_created ON recommendations(created_at DESC);

-- ---------------------------------------------------------------------
-- 5. COMUNIDADE
-- ---------------------------------------------------------------------
CREATE TABLE community_reports (
  report_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users(user_id) ON DELETE SET NULL,  -- autoria anonimizada na exclusão da conta
  type               text NOT NULL CHECK (type IN ('superlotacao','linha_parada','atraso','interrupcao','enchente','acidente','assalto','problema_estacao')),
  stop_id            text NOT NULL REFERENCES stops(stop_id),
  route_id           text REFERENCES routes(route_id),
  description        varchar(280),
  reporter_weight    numeric(4,3) NOT NULL CHECK (reporter_weight BETWEEN 0 AND 1),
  status             text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','oculto_moderacao','removido')),
  moderation_note    text,
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX ix_reports_active ON community_reports(status, expires_at);
CREATE INDEX ix_reports_stop ON community_reports(stop_id, created_at DESC);
CREATE INDEX ix_reports_user_created ON community_reports(user_id, created_at DESC);

CREATE TABLE report_confirmations (
  report_id          uuid NOT NULL REFERENCES community_reports(report_id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  vote               text NOT NULL CHECK (vote IN ('confirma','contesta')),
  voter_weight       numeric(4,3) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

CREATE TABLE report_flags (
  report_id          uuid NOT NULL REFERENCES community_reports(report_id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reason             text NOT NULL CHECK (reason IN ('falso','ofensivo','dados_pessoais','spam','outro')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

-- ---------------------------------------------------------------------
-- 6. AUDITORIA (sem FK para sobreviver à exclusão; actor é pseudônimo após exclusão)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  audit_id           bigserial PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  actor_user_id      uuid,
  action             text NOT NULL,
  entity             text NOT NULL,
  entity_id          text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash            char(64)
);
CREATE INDEX ix_audit_occurred ON audit_logs(occurred_at DESC);

-- ---------------------------------------------------------------------
-- 7. CAMADA ANALÍTICA (views sobre dados operacionais)
-- ---------------------------------------------------------------------
CREATE VIEW v_stop_routes AS
SELECT DISTINCT st.stop_id, t.route_id, r.mode
FROM stop_times st
JOIN trips t ON t.trip_id = st.trip_id
JOIN routes r ON r.route_id = t.route_id;

-- Agregado por hora e tipo; sem identificação de usuário. A API só exibe faixas com
-- pelo menos k relatores distintos (k-anonimato simples).
CREATE VIEW v_report_hourly AS
SELECT type,
       stop_id,
       EXTRACT(ISODOW FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS iso_dow,
       EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour,
       COUNT(*)::int AS reports,
       COUNT(DISTINCT user_id)::int AS distinct_reporters,
       BOOL_OR(is_demo) AS includes_demo
FROM community_reports
WHERE status <> 'removido'
GROUP BY 1,2,3,4;
