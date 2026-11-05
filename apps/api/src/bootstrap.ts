import { config } from "./config.js";
import { createDb, type Db } from "./db/client.js";
import { seedDemo } from "./db/demo.js";
import { loadGold } from "./db/loadGold.js";
import { migrate } from "./db/migrate.js";
import { applyRetention } from "./lib/retention.js";

/** Prepara o banco: migrações → carga Gold → demo (opcional) → retenção. */
export async function bootstrap(opts: { memory?: boolean; demo?: boolean } = {}): Promise<Db> {
  const db = await createDb({ memory: opts.memory });
  const applied = await migrate(db);
  const gold = await loadGold(db);
  if (opts.demo ?? config.seedDemo) await seedDemo(db);
  const ret = await applyRetention(db);
  if (!config.isTest) {
    console.info(`[db] ${db.kind}${db.kind === "pglite" ? ` em ${config.pgliteDir}` : ""}; migrações aplicadas: ${applied.join(", ") || "nenhuma nova"}`);
    console.info(`[gold] versão ${gold.version} ${gold.loaded ? "carregada" : "já ativa"}`);
    console.info(`[retenção] ${JSON.stringify(ret)}`);
  }
  return db;
}
