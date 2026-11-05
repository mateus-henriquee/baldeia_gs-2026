import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { Db } from "./client.js";

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  const files = readdirSync(config.migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const optionalPostgis = file.includes("postgis");
    if (optionalPostgis && !(db.kind === "postgres" && config.enablePostgis)) continue;
    const sql = readFileSync(path.join(config.migrationsDir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}
