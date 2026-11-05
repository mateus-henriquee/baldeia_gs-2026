import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config.js";
import type { Db } from "./db/client.js";
import { errorHandler, HttpError } from "./lib/http.js";
import { metricsMiddleware } from "./lib/metrics.js";
import { authenticate, authRouter } from "./modules/auth.js";
import { communityRouter } from "./modules/community.js";
import { meRouter } from "./modules/me.js";
import { planningRouter } from "./modules/planning.js";
import { publicRouter } from "./modules/public.js";
import { loadNetwork, type Network } from "./routing/network.js";

export function createApp(db: Db) {
  let network: Promise<Network> | null = null;
  const getNet = () => (network ??= loadNetwork(db).catch((e) => { network = null; throw e; }));
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://tile.openstreetmap.org", ...(config.mapTileOrigin ? [config.mapTileOrigin] : [])],
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'"],
        "connect-src": ["'self'"],
        // Só força HTTPS quando servido por HTTPS (evita quebrar o modo produção em http://localhost).
        "upgrade-insecure-requests": config.httpsOnly ? [] : null,
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }, // exigido pela política de tiles do OSM
  }));
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  app.use(metricsMiddleware);
  app.use("/api", rateLimit({ windowMs: 15 * 60000, limit: config.isTest ? 10000 : 600, standardHeaders: "draft-7", legacyHeaders: false }));

  // Proteção CSRF simples: requisições que alteram estado devem vir da mesma origem e em JSON.
  app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    const host = req.get("host");
    if (origin && host && new URL(origin).host !== host && !/^localhost:51\d\d$/.test(new URL(origin).host))
      return next(new HttpError(403, "Origem não permitida.", "origem"));
    if (Number(req.headers["content-length"] ?? 0) > 0 && !req.is("application/json"))
      return next(new HttpError(415, "Envie JSON.", "tipo_conteudo"));
    next();
  });
  app.use("/api", authenticate(db));

  app.use("/api/auth", authRouter(db));
  app.use("/api/public", publicRouter(db, getNet));
  app.use("/api/plan", planningRouter(db, getNet));
  app.use("/api/community", communityRouter(db));
  app.use("/api/me", meRouter(db, getNet));
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Rota não encontrada.", "nao_encontrado")));

  // Produção: serve o front-end compilado (SPA).
  if (existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
  }
  app.use(errorHandler);
  return { app, getNet };
}
