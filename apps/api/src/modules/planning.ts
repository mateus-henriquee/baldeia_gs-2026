import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { HttpError, parse } from "../lib/http.js";
import { inc } from "../lib/metrics.js";
import { localParts } from "../lib/time.js";
import type { Mode, Network } from "../routing/network.js";
import { plan, PROFILES, type ProfileId, type PlanResult } from "../routing/planner.js";
import { activeReports, toRoutingReports } from "./community.js";
import { hasConsent } from "./consents.js";

const PlanBody = z.object({
  origem: z.string().min(1).max(80),
  destino: z.string().min(1).max(80),
  partida: z.string().datetime({ offset: true }).optional(),
  modos: z.array(z.enum(["onibus", "metro", "trem"])).min(1).default(["onibus", "metro", "trem"]),
  perfis: z.array(z.enum(Object.keys(PROFILES) as [ProfileId, ...ProfileId[]])).optional(),
  caminhada_max_m: z.number().int().min(100).max(1500).optional(),
});

export async function runPlan(db: Db, net: Network, body: z.infer<typeof PlanBody>, req: Request | null, persist = true) {
  const user = req?.user;
  let maxWalk = body.caminhada_max_m;
  if (user && !maxWalk) {
    const p = (await db.query<{ max_walk_m: number }>("SELECT max_walk_m FROM user_preferences WHERE user_id=$1", [user.user_id])).rows[0];
    maxWalk = p?.max_walk_m;
  }
  const reports = toRoutingReports(await activeReports(db));
  let result: PlanResult;
  try {
    result = plan(net, { origin: body.origem, destination: body.destino, departAt: body.partida ? new Date(body.partida) : new Date(),
      modes: body.modos as Mode[], profiles: body.perfis, maxWalkM: maxWalk ?? 600, reports });
  } catch (e) {
    throw new HttpError(400, (e as Error).message, "consulta_invalida");
  }
  inc("planejamentos");
  let recommendationId: string | null = null;
  if (persist) {
    // Minimização: só vincula ao usuário (e guarda origem/destino) com consentimento de histórico.
    const linked = user ? await hasConsent(db, user.user_id, "historico_viagens") : false;
    const lp = localParts(body.partida ? new Date(body.partida) : new Date());
    const request = { modos: body.modos, perfis: body.perfis ?? null, dia_semana: lp.weekday, hora: Math.floor(lp.secs / 3600),
      ...(linked ? { origem: body.origem, destino: body.destino } : {}) };
    const summary = result.alternativas.map((a) => ({ id: a.id, perfis: a.perfis, metricas: a.metricas,
      pernas: a.pernas.map((l) => ({ tipo: l.tipo, de: l.de.id, para: l.para.id, linha: l.linha?.id ?? null, partida_s: l.partida_s, chegada_s: l.chegada_s,
        espera_s: (l.espera_min ?? 0) * 60, paradas: l.paradas?.map((p) => p.id) ?? [l.de.id, l.para.id] })) }));
    recommendationId = (await db.query<{ recommendation_id: string }>(`INSERT INTO recommendations (user_id, dataset_version_id, request, alternatives, criteria_availability, compute_ms)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING recommendation_id`,
      [linked ? user!.user_id : null, net.datasetVersion, JSON.stringify(request), JSON.stringify(summary), JSON.stringify(result.criterios), result.compute_ms])).rows[0].recommendation_id;
  }
  return { ...result, recomendacao_id: recommendationId };
}

export function planningRouter(db: Db, getNet: () => Promise<Network>): Router {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60000, limit: config.isTest ? 1000 : 40, standardHeaders: "draft-7", legacyHeaders: false,
    message: { erro: "Muitas consultas por minuto. Aguarde um pouco.", codigo: "limite" } });

  r.post("/", limiter, async (req, res) => {
    const body = parse(PlanBody, req.body);
    res.json(await runPlan(db, await getNet(), body, req));
  });

  r.post("/:id/feedback", async (req, res) => {
    const body = parse(z.object({ feedback: z.enum(["util", "nao_util"]), escolhida: z.number().int().min(0).max(10).optional() }), req.body);
    const u = await db.query(`UPDATE recommendations SET feedback=$2, chosen_index=COALESCE($3, chosen_index) WHERE recommendation_id=$1 RETURNING 1`,
      [req.params.id, body.feedback, body.escolhida ?? null]);
    if (!u.rows.length) throw new HttpError(404, "Recomendação não encontrada.", "nao_encontrado");
    inc(`feedback_${body.feedback}`);
    res.json({ ok: true });
  });
  return r;
}
