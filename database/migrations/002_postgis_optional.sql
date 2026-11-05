-- Opcional: aplicado apenas com ENABLE_POSTGIS=true e um PostgreSQL com PostGIS
-- (ex.: docker compose up -d). Não é aplicado no modo embutido (PGlite).
-- Status: NÃO testado no ambiente de desenvolvimento original (sem PostGIS disponível).
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED;

CREATE INDEX IF NOT EXISTS ix_stops_geom ON stops USING GIST (geom);

-- Exemplo de consulta habilitada: paradas a até 400 m de um ponto
-- SELECT stop_id, name FROM stops
-- WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(-46.6339, -23.5505), 4326)::geography, 400);
