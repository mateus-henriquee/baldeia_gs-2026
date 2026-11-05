import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Carrega .env da raiz sem dependência externa (formato CHAVE=valor). */
function loadDotEnv(): void {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const [, k, raw] = m;
    if (process.env[k] === undefined) process.env[k] = raw.replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === "production";

let jwtSecret = env.JWT_SECRET ?? "";
let jwtSecretEphemeral = false;
if (jwtSecret.length < 32) {
  if (isProd) throw new Error("JWT_SECRET (>= 32 caracteres) é obrigatório em produção.");
  jwtSecret = randomBytes(48).toString("hex");
  jwtSecretEphemeral = true;
}

export const config = {
  isProd,
  isTest: env.NODE_ENV === "test",
  port: Number(env.API_PORT ?? 3333),
  /** Vazio = PostgreSQL embutido (PGlite) em PGLITE_DIR. Preenchido = PostgreSQL externo. */
  databaseUrl: env.DATABASE_URL ?? "",
  pgliteDir: env.PGLITE_DIR ? path.resolve(ROOT, env.PGLITE_DIR) : path.join(ROOT, "data/app-db"),
  enablePostgis: env.ENABLE_POSTGIS === "true",
  jwtSecret,
  jwtSecretEphemeral,
  sessionDays: 7,
  /** Gera usuários e relatos sintéticos (is_demo = true) para demonstração. */
  seedDemo: (env.SEED_DEMO ?? "true") === "true",
  goldDir: path.join(ROOT, env.GOLD_SOURCE_DIR ?? "data/gold/sptrans_gtfs_amostra"),
  sourcesCatalog: path.join(ROOT, "data/sources/catalog.json"),
  migrationsDir: path.join(ROOT, "database/migrations"),
  webDist: path.join(ROOT, "apps/web/dist"),
  policyVersion: "2026-11-05",
  retention: { journeyDays: 180, reportTextDays: 30, auditDays: 365 },
  trustProxy: env.TRUST_PROXY === "true",
  /** Origem extra permitida no CSP para imagens do mapa (ex.: https://tiles.seu-provedor.com). */
  mapTileOrigin: env.MAP_TILE_ORIGIN ?? "",
  httpsOnly: env.HTTPS_ONLY === "true",
};
