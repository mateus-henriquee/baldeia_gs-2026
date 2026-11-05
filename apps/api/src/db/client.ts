/**
 * Abstração mínima de banco: o mesmo SQL roda no PostgreSQL embutido (PGlite, WASM)
 * e em um PostgreSQL externo (pg). Ver docs/arquitetura-do-sistema.md.
 */
import { mkdirSync } from "node:fs";
import { config } from "../config.js";

export interface QueryResult<T> { rows: T[] }

export interface Db {
  kind: "pglite" | "postgres";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Executa SQL com múltiplos comandos, sem parâmetros. */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Pick<Db, "query" | "exec">) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createDb(opts: { memory?: boolean } = {}): Promise<Db> {
  if (config.databaseUrl && !opts.memory) {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: config.databaseUrl, max: 10 });
    return {
      kind: "postgres",
      query: async (sql, params) => ({ rows: (await pool.query(sql, params as unknown[])).rows }),
      exec: async (sql) => { await pool.query(sql); },
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn({
            query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows }),
            exec: async (sql) => { await client.query(sql); },
          });
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  let dataDir: string | undefined;
  if (!opts.memory) {
    mkdirSync(config.pgliteDir, { recursive: true });
    dataDir = config.pgliteDir;
  }
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  return {
    kind: "pglite",
    query: async (sql, params) => ({ rows: (await lite.query(sql, params as unknown[])).rows as never[] }),
    exec: async (sql) => { await lite.exec(sql); },
    transaction: (fn) => lite.transaction(async (tx) => fn({
      query: async (sql, params) => ({ rows: (await tx.query(sql, params as unknown[])).rows as never[] }),
      exec: async (sql) => { await tx.exec(sql); },
    })),
    close: () => lite.close(),
  };
}
