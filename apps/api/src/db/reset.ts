import { rmSync } from "node:fs";
import { config } from "../config.js";

if (config.databaseUrl) {
  console.error("DATABASE_URL definido: este comando só apaga o banco embutido (PGlite). Use seu próprio procedimento no PostgreSQL externo.");
  process.exit(1);
}
rmSync(config.pgliteDir, { recursive: true, force: true });
console.info(`Banco embutido removido (${config.pgliteDir}). Ele será recriado no próximo "npm run dev".`);
