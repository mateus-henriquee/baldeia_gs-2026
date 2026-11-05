import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { HttpError, parse } from "../lib/http.js";
import { audit } from "./audit.js";

export const COOKIE = "baldeia_sessao";
export interface AuthUser { user_id: string; email: string; display_name: string; role: "usuario" | "moderador" | "admin";
  email_verified_at: string | null; reputation: number; token_version: number; is_demo: boolean }
declare module "express-serve-static-core" { interface Request { user?: AuthUser } }

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function setSession(res: Response, u: { user_id: string; token_version: number }) {
  const token = jwt.sign({ sub: u.user_id, tv: u.token_version }, config.jwtSecret, { expiresIn: `${config.sessionDays}d` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.isProd && config.httpsOnly, maxAge: config.sessionDays * 86400000, path: "/" });
}

export function authenticate(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return next();
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { sub: string; tv: number };
      const u = (await db.query<AuthUser>(`SELECT user_id, email, display_name, role, email_verified_at, reputation::float AS reputation,
        token_version, is_demo FROM users WHERE user_id=$1`, [payload.sub])).rows[0];
      if (u && u.token_version === payload.tv) req.user = { ...u, reputation: Number(u.reputation) };
    } catch { /* token inválido/expirado: segue anônimo */ }
    next();
  };
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, "Faça login para continuar.", "nao_autenticado");
  return req.user;
}
export function requireRole(req: Request, ...roles: AuthUser["role"][]): AuthUser {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw new HttpError(403, "Acesso restrito.", "sem_permissao");
  return u;
}

const password = z.string().min(10, "Mínimo de 10 caracteres.").max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use letras e números.");
const Register = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(254),
  password,
  display_name: z.string().trim().min(2).max(40),
  accept_terms: z.literal(true, { message: "É preciso aceitar os termos e a política de privacidade." }),
  consents: z.object({ historico_viagens: z.boolean().default(false), analise_habitos: z.boolean().default(false) }).default({ historico_viagens: false, analise_habitos: false }),
});
const Login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });

export function authRouter(db: Db): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60000, limit: config.isTest ? 1000 : 20, standardHeaders: "draft-7", legacyHeaders: false,
    message: { erro: "Muitas tentativas. Aguarde alguns minutos.", codigo: "limite" } });

  r.post("/register", limiter, async (req, res) => {
    const body = parse(Register, req.body);
    const exists = await db.query("SELECT 1 FROM users WHERE email_normalized=$1", [body.email]);
    if (exists.rows.length) throw new HttpError(409, "Já existe uma conta com este e-mail.", "email_em_uso");
    const hash = await bcrypt.hash(body.password, config.isTest ? 4 : 11);
    const verifyToken = randomBytes(24).toString("hex");
    const u = await db.transaction(async (tx) => {
      const row = (await tx.query<{ user_id: string; token_version: number }>(`INSERT INTO users (email, email_normalized, password_hash, display_name, verification_token_hash)
        VALUES ($1,$1,$2,$3,$4) RETURNING user_id, token_version`, [body.email, hash, body.display_name, sha256(verifyToken)])).rows[0];
      await tx.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [row.user_id]);
      for (const [purpose, granted] of Object.entries(body.consents)) {
        await tx.query(`INSERT INTO user_consents (user_id, purpose, granted, legal_basis, policy_version) VALUES ($1,$2,$3,'consentimento (art. 7º, I, LGPD)',$4)`,
          [row.user_id, purpose, granted, config.policyVersion]);
      }
      return row;
    });
    await audit(db, req, u.user_id, "cadastro", "users", u.user_id, { consentimentos: body.consents });
    setSession(res, u);
    // Sem servidor de e-mail no ambiente local: o link é exibido no console e devolvido fora de produção.
    const link = `/verificar-email?token=${verifyToken}`;
    if (!config.isTest) console.info(`[verificação de e-mail] ${body.email}: ${link}`);
    res.status(201).json({ ok: true, verificacao_dev: config.isProd ? undefined : link });
  });

  r.post("/login", limiter, async (req, res) => {
    const body = parse(Login, req.body);
    const u = (await db.query<{ user_id: string; password_hash: string; token_version: number }>(
      "SELECT user_id, password_hash, token_version FROM users WHERE email_normalized=$1", [body.email])).rows[0];
    // Compara mesmo sem usuário (tempo semelhante; evita enumeração de contas).
    const ok = await bcrypt.compare(body.password, u?.password_hash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    if (!u || !ok) {
      await audit(db, req, null, "login_falhou", "users", null, {});
      throw new HttpError(401, "E-mail ou senha incorretos.", "credenciais");
    }
    await db.query("UPDATE users SET last_login_at=now() WHERE user_id=$1", [u.user_id]);
    await audit(db, req, u.user_id, "login", "users", u.user_id, {});
    setSession(res, u);
    res.json({ ok: true });
  });

  r.post("/logout", async (req, res) => {
    if (req.user) await audit(db, req, req.user.user_id, "logout", "users", req.user.user_id, {});
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  /** Encerra todas as sessões (invalida tokens antigos incrementando token_version). */
  r.post("/logout-all", async (req, res) => {
    const u = requireUser(req);
    await db.query("UPDATE users SET token_version = token_version + 1 WHERE user_id=$1", [u.user_id]);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  r.get("/me", (req, res) => {
    const u = req.user;
    res.json({ usuario: u ? { id: u.user_id, email: u.email, nome: u.display_name, papel: u.role, verificado: Boolean(u.email_verified_at),
      reputacao: u.reputation, demo: u.is_demo } : null });
  });

  r.post("/verify-email", limiter, async (req, res) => {
    const { token } = parse(z.object({ token: z.string().regex(/^[a-f0-9]{48}$/) }), req.body);
    const u = (await db.query<{ user_id: string }>(`UPDATE users SET email_verified_at=now(), verification_token_hash=NULL
      WHERE verification_token_hash=$1 RETURNING user_id`, [sha256(token)])).rows[0];
    if (!u) throw new HttpError(400, "Link inválido ou já utilizado.", "token_invalido");
    await audit(db, req, u.user_id, "email_verificado", "users", u.user_id, {});
    res.json({ ok: true });
  });
  return r;
}
