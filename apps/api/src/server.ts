import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { config } from "./config.js";
import { applyRetention } from "./lib/retention.js";

const db = await bootstrap();
const { app, getNet } = createApp(db);
await getNet(); // pré-carrega o grafo
if (config.jwtSecretEphemeral) console.warn("[aviso] JWT_SECRET não definido: usando segredo temporário (sessões caem ao reiniciar). Veja .env.example.");
setInterval(() => { applyRetention(db).catch((e) => console.error("[retenção]", e)); }, 6 * 3600 * 1000).unref();

const server = app.listen(config.port, () => {
  console.info(`[api] Baldeia ouvindo em http://localhost:${config.port}`);
});
const shutdown = async () => { server.close(); await db.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
