/**
 * Carga da camada Gold (gerada pelo pipeline Python) no banco operacional.
 * Contrato de integração: data/gold/<fonte>/_manifest.json + CSVs + GeoJSON.
 * Idempotente: se a versão do dataset já está ativa, nada é feito.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { config, ROOT } from "../config.js";
import type { Db } from "./client.js";

type Row = Record<string, string>;
type Tx = Pick<Db, "query" | "exec">;

const readCsv = (dir: string, name: string): Row[] =>
  parse(readFileSync(path.join(dir, `${name}.csv`), "utf8"), { columns: true, skip_empty_lines: true }) as Row[];
const bool = (v: string) => v === "True" || v === "true" || v === "1";

async function insertMany(tx: Tx, table: string, cols: string[], rows: unknown[][], conflict = ""): Promise<void> {
  const batch = Math.max(1, Math.floor(1000 / cols.length));
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`);
    await tx.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values.join(",")} ${conflict}`, params);
  }
}

const upsert = (pk: string[], cols: string[]) =>
  `ON CONFLICT (${pk.join(",")}) DO UPDATE SET ${cols.filter((c) => !pk.includes(c)).map((c) => `${c}=EXCLUDED.${c}`).join(",")}`;

export async function syncSourcesCatalog(db: Pick<Db, "query">): Promise<void> {
  const catalog = JSON.parse(readFileSync(config.sourcesCatalog, "utf8"));
  const cols = ["source_id", "name", "owner", "url", "category", "integration_status", "data_format",
    "update_frequency", "license", "limitations", "consulted_on"];
  for (const s of catalog.fontes) {
    await db.query(`INSERT INTO data_sources (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) ${upsert(["source_id"], cols)}`,
      [s.source_id, s.name, s.owner, s.url, s.category, s.integration_status, s.data_format, s.update_frequency,
        s.license, s.limitations, catalog.consultado_em]);
  }
}

export async function loadGold(db: Db, goldDir = config.goldDir): Promise<{ loaded: boolean; version: string }> {
  const manifestPath = path.join(goldDir, "_manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Gold não encontrada em ${goldDir}. Rode: npm run pipeline`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version: string = manifest.dataset_version;
  await syncSourcesCatalog(db);
  const active = await db.query("SELECT 1 FROM dataset_versions WHERE dataset_version_id=$1 AND is_active", [version]);
  if (active.rows.length) return { loaded: false, version };

  const quality = JSON.parse(readFileSync(path.join(goldDir, "quality_report.json"), "utf8"));
  const sourceId: string = manifest.fonte.source_id;

  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO dataset_versions (dataset_version_id, source_id, sha256, pipeline_version, generated_at, manifest)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dataset_version_id) DO UPDATE SET manifest=EXCLUDED.manifest, loaded_at=now()`,
      [version, sourceId, manifest.fonte.sha256, manifest.pipeline_version, manifest.gerado_em, JSON.stringify(manifest)]);
    const ing = manifest.ingestao;
    await tx.query(`INSERT INTO ingestion_jobs (job_id, source_id, dataset_version_id, started_at, finished_at, status, records_received, bronze_path)
      VALUES ($1,$2,$3,$4,$5,'success',$6,$7) ON CONFLICT (job_id) DO NOTHING`,
      [ing.job_id, sourceId, version, ing.iniciado_em, ing.finalizado_em, JSON.stringify(manifest.etapas[0]?.linhas_recebidas ?? {}), ing.bronze_path]);
    await tx.query("DELETE FROM quality_checks WHERE dataset_version_id=$1", [version]);
    await insertMany(tx, "quality_checks",
      ["dataset_version_id", "check_code", "table_name", "dimension", "rule", "records_checked", "records_failed", "action", "severity", "status", "details"],
      quality.verificacoes.map((c: Record<string, unknown>) => [version, c.check_id, c.table, c.dimension, c.rule, c.records_checked,
        c.records_failed, c.action, c.severity, c.status, c.details ?? null]));

    // Referência: upsert (preserva linhas referenciadas por dados de usuários de versões anteriores).
    const ag = readCsv(goldDir, "agencies");
    await insertMany(tx, "agencies", ["agency_id", "dataset_version_id", "name", "url", "timezone", "lang"],
      ag.map((r) => [r.agency_id, version, r.name, r.url, r.timezone, r.lang || null]),
      upsert(["agency_id"], ["agency_id", "dataset_version_id", "name", "url", "timezone", "lang"]));
    const rcols = ["route_id", "agency_id", "dataset_version_id", "short_name", "long_name", "route_type", "mode", "color", "text_color"];
    await insertMany(tx, "routes", rcols, readCsv(goldDir, "routes").map((r) =>
      [r.route_id, r.agency_id, version, r.short_name, r.long_name, Number(r.route_type), r.mode, r.color, r.text_color]), upsert(["route_id"], rcols));
    const scols = ["stop_id", "dataset_version_id", "name", "description", "lat", "lon", "kind", "name_search", "outside_expected_area"];
    await insertMany(tx, "stops", scols, readCsv(goldDir, "stops").map((r) =>
      [r.stop_id, version, r.name, r.description || null, Number(r.lat), Number(r.lon), r.kind, r.name_search, bool(r.fora_area_esperada)]),
      upsert(["stop_id"], scols));
    const ccols = ["service_id", "dataset_version_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date", "expired"];
    await insertMany(tx, "calendar_services", ccols, readCsv(goldDir, "calendar").map((r) =>
      [r.service_id, version, r.monday === "1", r.tuesday === "1", r.wednesday === "1", r.thursday === "1", r.friday === "1",
        r.saturday === "1", r.sunday === "1", r.start_date_iso, r.end_date_iso, bool(r.expirado)]), upsert(["service_id"], ccols));

    // Derivadas: substituídas integralmente pela nova versão.
    await tx.exec("DELETE FROM route_segments; DELETE FROM stop_transfers; DELETE FROM route_shapes; DELETE FROM frequencies; DELETE FROM stop_times;");
    const tcols = ["trip_id", "route_id", "service_id", "direction_id", "headsign", "shape_id"];
    await insertMany(tx, "trips", tcols, readCsv(goldDir, "trips").map((r) =>
      [r.trip_id, r.route_id, r.service_id, Number(r.direction_id), r.headsign || null, r.shape_id || null]), upsert(["trip_id"], tcols));
    await insertMany(tx, "stop_times", ["trip_id", "stop_sequence", "stop_id", "arrival_secs", "departure_secs"],
      readCsv(goldDir, "stop_times").map((r) => [r.trip_id, Number(r.stop_sequence), r.stop_id, Number(r.arrival_secs), Number(r.departure_secs)]));
    await insertMany(tx, "frequencies", ["trip_id", "start_secs", "end_secs", "headway_secs"],
      readCsv(goldDir, "frequencies").map((r) => [r.trip_id, Number(r.start_secs), Number(r.end_secs), Number(r.headway_secs)]));
    await insertMany(tx, "route_segments",
      ["trip_id", "stop_sequence", "from_stop_id", "to_stop_id", "travel_secs", "distance_m", "speed_kmh", "imputed", "anomaly", "robust_z"],
      readCsv(goldDir, "route_segments").map((r) => [r.trip_id, Number(r.stop_sequence), r.from_stop_id, r.to_stop_id, Number(r.travel_secs),
        Number(r.distance_m), Number(r.speed_kmh), bool(r.imputed), bool(r.anomaly), Number(r.robust_z)]));
    await insertMany(tx, "stop_transfers", ["from_stop_id", "to_stop_id", "distance_m", "walk_secs"],
      readCsv(goldDir, "stop_transfers").map((r) => [r.from_stop_id, r.to_stop_id, Number(r.distance_m), Number(r.walk_secs)]));
    const shapes = JSON.parse(readFileSync(path.join(goldDir, "route_shapes.geojson"), "utf8"));
    await insertMany(tx, "route_shapes", ["route_id", "direction_id", "geojson"],
      shapes.features.map((f: { properties: { route_id: string; direction_id: number } }) =>
        [f.properties.route_id, f.properties.direction_id, JSON.stringify(f)]));

    await tx.query("UPDATE dataset_versions SET is_active=false WHERE source_id=$1 AND is_active", [sourceId]);
    await tx.query("UPDATE dataset_versions SET is_active=true WHERE dataset_version_id=$1", [version]);
    await tx.query(`INSERT INTO audit_logs (action, entity, entity_id, metadata) VALUES ('carga_gold','dataset_versions',$1,$2)`,
      [version, JSON.stringify({ origem: path.relative(ROOT, goldDir) })]);
  });
  return { loaded: true, version };
}
