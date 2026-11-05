import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { computeTrust, FLAGS_TO_HIDE, REPORT_TYPES, reputationFrom, type ReportType } from "../community/trust.js";
import type { Db } from "../db/client.js";
import { seedDemoReports } from "../db/demo.js";
import { HttpError, parse } from "../lib/http.js";
import { inc } from "../lib/metrics.js";
import { scrubPersonalData } from "../lib/privacy.js";
import type { ActiveReport } from "../routing/planner.js";
import { audit } from "./audit.js";
import { requireRole, requireUser } from "./auth.js";
import { hasConsent } from "./consents.js";

interface ReportRow {
  report_id: string; user_id: string | null; type: ReportType; stop_id: string; route_id: string | null; description: string | null;
  reporter_weight: string; status: string; is_demo: boolean; created_at: Date | string; expires_at: Date | string;
  stop_name: string; lat: number; lon: number; route_name: string | null; confirm_w: string[]; contest_w: string[]; flags: number;
  moderation_note: string | null;
}

const BASE_SQL = `
SELECT r.report_id, r.user_id, r.type, r.stop_id, r.route_id, r.description, r.reporter_weight, r.status, r.is_demo,
       r.created_at, r.expires_at, r.moderation_note, s.name AS stop_name, s.lat, s.lon, ro.short_name AS route_name,
       COALESCE(array_agg(c.voter_weight) FILTER (WHERE c.vote='confirma'), '{}') AS confirm_w,
       COALESCE(array_agg(c.voter_weight) FILTER (WHERE c.vote='contesta'), '{}') AS contest_w,
       (SELECT count(*)::int FROM report_flags f WHERE f.report_id = r.report_id) AS flags
FROM community_reports r
JOIN stops s ON s.stop_id = r.stop_id
LEFT JOIN routes ro ON ro.route_id = r.route_id
LEFT JOIN report_confirmations c ON c.report_id = r.report_id`;
const GROUP = " GROUP BY r.report_id, s.name, s.lat, s.lon, ro.short_name";

function present(r: ReportRow, viewer?: string) {
  const t = computeTrust({ type: r.type, createdAt: new Date(r.created_at), reporterWeight: Number(r.reporter_weight),
    confirmWeights: r.confirm_w.map(Number), contestWeights: r.contest_w.map(Number) });
  return {
    id: r.report_id, tipo: r.type, tipo_rotulo: REPORT_TYPES[r.type].rotulo,
    origem: "comunidade" as const, demo: r.is_demo,
    local: { stop_id: r.stop_id, nome: r.stop_name, lat: Number(r.lat), lon: Number(r.lon) },
    linha: r.route_id ? { id: r.route_id, nome: r.route_name } : null,
    descricao: r.description, criado_em: new Date(r.created_at).toISOString(), expira_em: new Date(r.expires_at).toISOString(),
    status: r.status, denuncias: r.flags, nota_moderacao: r.moderation_note,
    confianca: t, meu: viewer ? r.user_id === viewer : false,
  };
}

/** Relatos ativos com confiança calculada — usados pelo mapa, alertas e roteador. */
export async function activeReports(db: Db, viewer?: string): Promise<ReturnType<typeof present>[]> {
  const rows = (await db.query<ReportRow>(`${BASE_SQL} WHERE r.status='ativo' AND r.expires_at > now() ${GROUP} ORDER BY r.created_at DESC LIMIT 500`)).rows;
  return rows.map((r) => present(r, viewer));
}

export function toRoutingReports(list: Awaited<ReturnType<typeof activeReports>>): ActiveReport[] {
  return list.map((r) => ({ reportId: r.id, type: r.tipo, stopId: r.local.stop_id, routeId: r.linha?.id ?? null,
    confianca: r.confianca.confianca, rotulo: r.confianca.rotulo, isDemo: r.demo }));
}

async function recomputeReputation(db: Pick<Db, "query">, userId: string | null) {
  if (!userId) return;
  const s = (await db.query<{ kept: number; removed: number }>(`SELECT count(*) FILTER (WHERE status <> 'removido')::int AS kept,
    count(*) FILTER (WHERE status = 'removido')::int AS removed FROM community_reports WHERE user_id=$1`, [userId])).rows[0];
  await db.query("UPDATE users SET reputation=$2 WHERE user_id=$1", [userId, reputationFrom(s.kept, s.removed)]);
}

const Create = z.object({
  tipo: z.enum(Object.keys(REPORT_TYPES) as [ReportType, ...ReportType[]]),
  stop_id: z.string().min(1).max(40),
  route_id: z.string().min(1).max(40).nullable().optional(),
  descricao: z.string().trim().max(280).optional().default(""),
});

export function communityRouter(db: Db): Router {
  const r = Router();

  r.get("/reports", async (req, res) => {
    const list = await activeReports(db, req.user?.user_id);
    res.json({
      origem: "Relatos comunitários — não verificados por fontes oficiais.",
      oficiais: { disponivel: false, motivo: "Nenhuma fonte oficial de alertas (GTFS Realtime) integrada nesta versão." },
      relatos: list.filter((x) => x.denuncias < FLAGS_TO_HIDE),
    });
  });

  r.post("/reports", async (req, res) => {
    const u = requireUser(req);
    const body = parse(Create, req.body);
    if (!(await hasConsent(db, u.user_id, "comunidade_publicar")))
      throw new HttpError(403, "Aceite as regras da comunidade antes de publicar.", "consentimento_necessario");
    const verified = Boolean(u.email_verified_at);
    const [perHour, perDay] = verified ? [5, 20] : [2, 5];
    const counts = (await db.query<{ h: number; d: number }>(`SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS h,
      count(*)::int AS d FROM community_reports WHERE user_id=$1 AND created_at > now() - interval '1 day'`, [u.user_id])).rows[0];
    if (counts.h >= perHour || counts.d >= perDay)
      throw new HttpError(429, `Limite de publicações atingido (${perHour}/hora, ${perDay}/dia${verified ? "" : " para contas não verificadas"}).`, "limite_publicacao");
    const stop = await db.query("SELECT 1 FROM stops WHERE stop_id=$1", [body.stop_id]);
    if (!stop.rows.length) throw new HttpError(400, "Parada/estação inexistente.", "parada_invalida");
    if (body.route_id) {
      const ok = await db.query("SELECT 1 FROM v_stop_routes WHERE stop_id=$1 AND route_id=$2", [body.stop_id, body.route_id]);
      if (!ok.rows.length) throw new HttpError(400, "Esta linha não atende a parada informada.", "linha_incompativel");
    }
    // Evita duplicidade: mesmo autor, mesmo tipo e local nos últimos 30 min.
    const dup = await db.query(`SELECT 1 FROM community_reports WHERE user_id=$1 AND type=$2 AND stop_id=$3 AND created_at > now() - interval '30 minutes'`,
      [u.user_id, body.tipo, body.stop_id]);
    if (dup.rows.length) throw new HttpError(409, "Você já reportou isto aqui recentemente. Confirme o relato existente.", "duplicado");
    const scrub = scrubPersonalData(body.descricao);
    const weight = Math.max(0.1, u.reputation * (verified ? 1 : 0.5));
    const row = (await db.query<{ report_id: string }>(`INSERT INTO community_reports (user_id, type, stop_id, route_id, description, reporter_weight, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(mins => $7)) RETURNING report_id`,
      [u.user_id, body.tipo, body.stop_id, body.route_id ?? null, scrub.text || null, weight.toFixed(3), REPORT_TYPES[body.tipo].validadeMin])).rows[0];
    await audit(db, req, u.user_id, "relato_criado", "community_reports", row.report_id, { tipo: body.tipo, dados_pessoais_removidos: scrub.removed });
    inc("relatos_criados");
    res.status(201).json({ id: row.report_id, dados_pessoais_removidos: scrub.removed });
  });

  r.post("/reports/:id/vote", async (req, res) => {
    const u = requireUser(req);
    const { voto } = parse(z.object({ voto: z.enum(["confirma", "contesta"]) }), req.body);
    const rep = (await db.query<{ user_id: string | null }>(`SELECT user_id FROM community_reports WHERE report_id=$1 AND status='ativo' AND expires_at > now()`,
      [req.params.id])).rows[0];
    if (!rep) throw new HttpError(404, "Relato não encontrado ou expirado.", "nao_encontrado");
    if (rep.user_id === u.user_id) throw new HttpError(400, "Você não pode confirmar o próprio relato.", "autoconfirmacao");
    const weight = Math.max(0.1, u.reputation * (u.email_verified_at ? 1 : 0.5));
    await db.query(`INSERT INTO report_confirmations (report_id, user_id, vote, voter_weight) VALUES ($1,$2,$3,$4)
      ON CONFLICT (report_id, user_id) DO UPDATE SET vote=EXCLUDED.vote, voter_weight=EXCLUDED.voter_weight, created_at=now()`,
      [req.params.id, u.user_id, voto, weight.toFixed(3)]);
    res.json({ ok: true });
  });

  r.post("/reports/:id/flag", async (req, res) => {
    const u = requireUser(req);
    const { motivo } = parse(z.object({ motivo: z.enum(["falso", "ofensivo", "dados_pessoais", "spam", "outro"]) }), req.body);
    const exists = await db.query("SELECT 1 FROM community_reports WHERE report_id=$1", [req.params.id]);
    if (!exists.rows.length) throw new HttpError(404, "Relato não encontrado.", "nao_encontrado");
    await db.query(`INSERT INTO report_flags (report_id, user_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [req.params.id, u.user_id, motivo]);
    const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM report_flags WHERE report_id=$1", [req.params.id])).rows[0].n;
    if (n >= FLAGS_TO_HIDE) await db.query("UPDATE community_reports SET status='oculto_moderacao' WHERE report_id=$1 AND status='ativo'", [req.params.id]);
    await audit(db, req, u.user_id, "relato_denunciado", "community_reports", String(req.params.id), { motivo });
    res.json({ ok: true, oculto: n >= FLAGS_TO_HIDE });
  });

  // ---- moderação
  r.get("/moderation/queue", async (req, res) => {
    requireRole(req, "moderador", "admin");
    const rows = (await db.query<ReportRow>(`${BASE_SQL} WHERE r.status='oculto_moderacao'
      OR (r.status='ativo' AND EXISTS (SELECT 1 FROM report_flags f WHERE f.report_id=r.report_id)) ${GROUP} ORDER BY r.created_at DESC LIMIT 100`)).rows;
    const reasons = (await db.query<{ report_id: string; reason: string; n: number }>(
      "SELECT report_id, reason, count(*)::int AS n FROM report_flags GROUP BY 1,2")).rows;
    res.json({ fila: rows.map((x) => ({ ...present(x), motivos: reasons.filter((m) => m.report_id === x.report_id) })) });
  });

  r.post("/moderation/reports/:id", async (req, res) => {
    const mod = requireRole(req, "moderador", "admin");
    const { acao, nota } = parse(z.object({ acao: z.enum(["restaurar", "remover"]), nota: z.string().trim().min(3).max(280) }), req.body);
    const row = (await db.query<{ user_id: string | null }>(`UPDATE community_reports SET status=$2, moderation_note=$3 WHERE report_id=$1 RETURNING user_id`,
      [req.params.id, acao === "remover" ? "removido" : "ativo", nota])).rows[0];
    if (!row) throw new HttpError(404, "Relato não encontrado.", "nao_encontrado");
    if (acao === "restaurar") await db.query("DELETE FROM report_flags WHERE report_id=$1", [req.params.id]);
    await recomputeReputation(db, row.user_id);
    await audit(db, req, mod.user_id, `moderacao_${acao}`, "community_reports", String(req.params.id), { nota });
    res.json({ ok: true });
  });

  // ---- demonstração
  r.post("/demo/refresh", async (req, res) => {
    requireUser(req);
    if (!config.seedDemo) throw new HttpError(404, "Modo demonstração desativado.", "demo_off");
    const n = await seedDemoReports(db);
    res.json({ criados: n, aviso: "Relatos SINTÉTICOS de demonstração (is_demo = true)." });
  });
  return r;
}
