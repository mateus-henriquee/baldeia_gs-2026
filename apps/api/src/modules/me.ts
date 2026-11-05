import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { HttpError, parse } from "../lib/http.js";
import { localParts } from "../lib/time.js";
import { resolvePlace, type Network } from "../routing/network.js";
import { plan } from "../routing/planner.js";
import { audit } from "./audit.js";
import { COOKIE, requireUser } from "./auth.js";
import { consentState, hasConsent, PURPOSES, type Purpose } from "./consents.js";
import { K_ANON } from "./public.js";

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const DOW = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export function meRouter(db: Db, getNet: () => Promise<Network>): Router {
  const r = Router();

  // ---------- preferências
  r.get("/preferences", async (req, res) => {
    const u = requireUser(req);
    res.json((await db.query("SELECT preferred_modes, max_walk_m, prefer_less_walking FROM user_preferences WHERE user_id=$1", [u.user_id])).rows[0]);
  });
  r.put("/preferences", async (req, res) => {
    const u = requireUser(req);
    const b = parse(z.object({ preferred_modes: z.array(z.enum(["onibus", "metro", "trem"])).min(1),
      max_walk_m: z.number().int().min(100).max(1500), prefer_less_walking: z.boolean() }), req.body);
    await db.query(`UPDATE user_preferences SET preferred_modes=$2, max_walk_m=$3, prefer_less_walking=$4, updated_at=now() WHERE user_id=$1`,
      [u.user_id, b.preferred_modes, b.max_walk_m, b.prefer_less_walking]);
    res.json({ ok: true });
  });

  // ---------- consentimentos (log append-only)
  r.get("/consents", async (req, res) => {
    const u = requireUser(req);
    res.json({ politica_versao: config.policyVersion, finalidades: await consentState(db, u.user_id) });
  });
  r.put("/consents", async (req, res) => {
    const u = requireUser(req);
    const b = parse(z.object({ finalidade: z.enum(Object.keys(PURPOSES) as [Purpose, ...Purpose[]]), concedido: z.boolean() }), req.body);
    await db.query(`INSERT INTO user_consents (user_id, purpose, granted, legal_basis, policy_version) VALUES ($1,$2,$3,$4,$5)`,
      [u.user_id, b.finalidade, b.concedido, PURPOSES[b.finalidade].base_legal, config.policyVersion]);
    // Revogar o histórico apaga o que foi salvo com base nele.
    if (b.finalidade === "historico_viagens" && !b.concedido) {
      await db.query("DELETE FROM journeys WHERE user_id=$1", [u.user_id]);
      await db.query("UPDATE recommendations SET user_id=NULL, request = request - 'origem' - 'destino' WHERE user_id=$1", [u.user_id]);
    }
    await audit(db, req, u.user_id, b.concedido ? "consentimento_concedido" : "consentimento_revogado", "user_consents", b.finalidade, {});
    res.json({ ok: true, finalidades: await consentState(db, u.user_id) });
  });

  // ---------- favoritos
  r.get("/favorites", async (req, res) => {
    const u = requireUser(req);
    const net = await getNet();
    const rows = (await db.query<{ favorite_id: string; label: string; custom_name: string; stop_id: string }>(
      "SELECT favorite_id, label, custom_name, stop_id FROM favorite_places WHERE user_id=$1 ORDER BY created_at", [u.user_id])).rows;
    res.json({ favoritos: rows.map((f) => {
      const s = net.stops.get(f.stop_id);
      const g = [...net.groups.values()].find((x) => x.stopIds.includes(f.stop_id));
      return { id: f.favorite_id, rotulo: f.label, nome: f.custom_name, local: { id: g?.id ?? f.stop_id, nome: g?.name ?? s?.name, lat: s?.lat, lon: s?.lon } };
    }) });
  });
  r.post("/favorites", async (req, res) => {
    const u = requireUser(req);
    const b = parse(z.object({ rotulo: z.enum(["casa", "trabalho", "faculdade", "escola", "outro"]), nome: z.string().trim().min(1).max(40),
      local_id: z.string().min(1).max(80) }), req.body);
    const ids = resolvePlace(await getNet(), b.local_id);
    if (!ids.length) throw new HttpError(400, "Local inválido.", "local_invalido");
    const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM favorite_places WHERE user_id=$1", [u.user_id])).rows[0].n;
    if (n >= 20) throw new HttpError(400, "Limite de 20 favoritos.", "limite");
    try {
      const row = (await db.query<{ favorite_id: string }>(`INSERT INTO favorite_places (user_id, label, custom_name, stop_id) VALUES ($1,$2,$3,$4) RETURNING favorite_id`,
        [u.user_id, b.rotulo, b.nome, ids[0]])).rows[0];
      res.status(201).json({ id: row.favorite_id });
    } catch {
      throw new HttpError(409, "Você já tem um favorito com esse nome.", "duplicado");
    }
  });
  r.delete("/favorites/:id", async (req, res) => {
    const u = requireUser(req);
    await db.query("DELETE FROM favorite_places WHERE favorite_id=$1 AND user_id=$2", [req.params.id, u.user_id]);
    res.json({ ok: true });
  });

  // ---------- viagens (histórico, somente com consentimento)
  r.post("/journeys", async (req, res) => {
    const u = requireUser(req);
    const b = parse(z.object({ recomendacao_id: z.string().uuid(), alternativa_id: z.string().max(10), partida: z.string().datetime({ offset: true }) }), req.body);
    if (!(await hasConsent(db, u.user_id, "historico_viagens")))
      return res.json({ salvo: false, motivo: "Histórico desativado: a navegação funciona só no seu aparelho." });
    const rec = (await db.query<{ alternatives: { id: string; perfis: string[]; metricas: { total_min: number; baldeacoes: number };
      pernas: { tipo: string; de: string; para: string; linha: string | null; partida_s: number; chegada_s: number; espera_s: number; paradas: string[] }[] }[];
      dataset_version_id: string; user_id: string | null }>("SELECT alternatives, dataset_version_id, user_id FROM recommendations WHERE recommendation_id=$1", [b.recomendacao_id])).rows[0];
    if (!rec || rec.user_id !== u.user_id) throw new HttpError(404, "Recomendação não encontrada.", "nao_encontrado");
    const alt = rec.alternatives.find((a) => a.id === b.alternativa_id);
    if (!alt) throw new HttpError(400, "Alternativa inválida.", "alternativa_invalida");
    const legs = alt.pernas;
    const id = await db.transaction(async (tx) => {
      const j = (await tx.query<{ journey_id: string }>(`INSERT INTO journeys (user_id, origin_stop_id, destination_stop_id, requested_departure, profile,
        status, planned_duration_secs, transfers, saved_to_history, dataset_version_id, started_at)
        VALUES ($1,$2,$3,$4,$5,'em_andamento',$6,$7,true,$8,now()) RETURNING journey_id`,
        [u.user_id, legs[0].de, legs[legs.length - 1].para, b.partida, alt.perfis[0], Math.max(60, alt.metricas.total_min * 60), alt.metricas.baldeacoes, rec.dataset_version_id])).rows[0];
      for (const [i, l] of legs.entries()) {
        await tx.query(`INSERT INTO journey_legs (journey_id, leg_index, kind, route_id, from_stop_id, to_stop_id, departure_secs, arrival_secs, wait_secs, stop_ids)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [j.journey_id, i, l.tipo, l.linha, l.de, l.para, Math.round(l.partida_s), Math.round(l.chegada_s), Math.round(l.espera_s), l.paradas]);
      }
      await tx.query("UPDATE recommendations SET journey_id=$2, chosen_index=$3 WHERE recommendation_id=$1",
        [b.recomendacao_id, j.journey_id, rec.alternatives.indexOf(alt)]);
      return j.journey_id;
    });
    res.status(201).json({ salvo: true, id });
  });

  r.post("/journeys/:id/checkpoints", async (req, res) => {
    const u = requireUser(req);
    const b = parse(z.object({ stop_id: z.string().max(40), metodo: z.enum(["manual", "gps"]) }), req.body);
    const own = await db.query("SELECT 1 FROM journeys WHERE journey_id=$1 AND user_id=$2", [req.params.id, u.user_id]);
    if (!own.rows.length) throw new HttpError(404, "Viagem não encontrada.", "nao_encontrado");
    await db.query(`INSERT INTO journey_checkpoints (journey_id, stop_id, method) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [req.params.id, b.stop_id, b.metodo]);
    res.json({ ok: true });
  });

  r.patch("/journeys/:id", async (req, res) => {
    const u = requireUser(req);
    const b = parse(z.object({ status: z.enum(["concluida", "cancelada"]) }), req.body);
    await db.query(`UPDATE journeys SET status=$3, completed_at=CASE WHEN $3='concluida' THEN now() ELSE completed_at END WHERE journey_id=$1 AND user_id=$2`,
      [req.params.id, u.user_id, b.status]);
    res.json({ ok: true });
  });

  r.get("/journeys", async (req, res) => {
    const u = requireUser(req);
    const net = await getNet();
    const rows = (await db.query<{ journey_id: string; origin_stop_id: string; destination_stop_id: string; requested_departure: Date; profile: string;
      status: string; planned_duration_secs: number; transfers: number; is_demo: boolean; created_at: Date }>(`SELECT journey_id, origin_stop_id, destination_stop_id,
      requested_departure, profile, status, planned_duration_secs, transfers, is_demo, created_at FROM journeys WHERE user_id=$1 ORDER BY requested_departure DESC LIMIT 200`, [u.user_id])).rows;
    res.json({ historico_ativo: await hasConsent(db, u.user_id, "historico_viagens"), viagens: rows.map((j) => ({
      id: j.journey_id, origem: net.stops.get(j.origin_stop_id)?.name, destino: net.stops.get(j.destination_stop_id)?.name,
      partida: j.requested_departure, perfil: j.profile, status: j.status, duracao_min: Math.round(j.planned_duration_secs / 60),
      baldeacoes: j.transfers, demo: j.is_demo })) });
  });

  // ---------- hábitos (estatística descritiva sobre o próprio histórico)
  r.get("/habits", async (req, res) => {
    const u = requireUser(req);
    if (!(await hasConsent(db, u.user_id, "analise_habitos")) || !(await hasConsent(db, u.user_id, "historico_viagens")))
      return res.json({ disponivel: false, motivo: "Ative “Salvar histórico” e “Analisar meus hábitos” em Privacidade para ver esta análise." });
    const net = await getNet();
    const js = (await db.query<{ journey_id: string; destination_stop_id: string; requested_departure: Date; planned_duration_secs: number; is_demo: boolean }>(
      `SELECT journey_id, destination_stop_id, requested_departure, planned_duration_secs, is_demo FROM journeys WHERE user_id=$1 AND status <> 'cancelada'`, [u.user_id])).rows;
    const MIN_N = 5;
    if (js.length < MIN_N) return res.json({ disponivel: false, motivo: `Dados insuficientes: são necessárias pelo menos ${MIN_N} viagens no histórico (você tem ${js.length}).` });

    const items = js.map((j) => { const lp = localParts(new Date(j.requested_departure));
      return { ...j, min: lp.secs / 60, dow: lp.isoDow, dur: j.planned_duration_secs / 60 }; });
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const g = [...net.groups.values()].find((x) => x.stopIds.includes(it.destination_stop_id));
      const key = g?.name ?? net.stops.get(it.destination_stop_id)?.name ?? it.destination_stop_id;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
    }
    const destinos = [...groups.entries()].filter(([, v]) => v.length >= 3).map(([nome, v]) => {
      const mins = v.map((x) => x.min);
      return { destino: nome, viagens: v.length, saida_habitual: clock(quantile(mins, 0.5)),
        faixa_central: `${clock(quantile(mins, 0.25))}–${clock(quantile(mins, 0.75))}`, iqr_min: Math.round(quantile(mins, 0.75) - quantile(mins, 0.25)),
        hora_habitual: Math.floor(quantile(mins, 0.5) / 60) };
    }).sort((a, b) => b.viagens - a.viagens);

    const durs = items.map((x) => x.dur);
    const mean = durs.reduce((s, x) => s + x, 0) / durs.length;
    const sd = Math.sqrt(durs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, durs.length - 1));
    const porDia = [1, 2, 3, 4, 5, 6, 7].map((d) => { const v = items.filter((x) => x.dow === d);
      return { dia: DOW[d], viagens: v.length, duracao_media_min: v.length ? Math.round(v.reduce((s, x) => s + x.dur, 0) / v.length) : null }; });

    // Movimento reportado (agregado de todos os usuários, k-anonimato) nas estações de embarque do usuário.
    const boardStops = (await db.query<{ stop_id: string }>(`SELECT DISTINCT l.from_stop_id AS stop_id FROM journey_legs l JOIN journeys j USING (journey_id)
      WHERE j.user_id=$1 AND l.kind='transporte'`, [u.user_id])).rows.map((x) => x.stop_id);
    const crowd = (await db.query<{ hour: number; reports: number; reporters: number; demo: boolean }>(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour,
      count(*)::int AS reports, count(DISTINCT user_id)::int AS reporters, BOOL_OR(is_demo) AS demo
      FROM community_reports WHERE type='superlotacao' AND status <> 'removido' AND stop_id = ANY($1) AND created_at > now() - interval '28 days'
      AND EXTRACT(ISODOW FROM created_at AT TIME ZONE 'America/Sao_Paulo') <= 5 GROUP BY 1 ORDER BY 1`, [boardStops])).rows.filter((h) => h.reporters >= K_ANON);
    const byHour = new Map(crowd.map((h) => [h.hour, h.reports]));
    const sugestoes: { texto: string; evidencia: string; demo: boolean }[] = [];
    for (const d of destinos.slice(0, 3)) {
      const h = d.hora_habitual, here = byHour.get(h) ?? 0, before = byHour.get(h - 1) ?? 0, after = byHour.get(h + 1) ?? 0;
      const alt = before <= after ? { h: h - 1, n: before } : { h: h + 1, n: after };
      if (here >= 5 && alt.n <= here * 0.6) {
        sugestoes.push({
          texto: `Você costuma sair para ${d.destino} por volta das ${d.saida_habitual}. Esse horário coincide com mais relatos de superlotação nas estações do seu trajeto. Considere sair entre ${String(alt.h).padStart(2, "0")}h e ${String(alt.h + 1).padStart(2, "0")}h.`,
          evidencia: `Últimos 28 dias úteis: ${here} relatos entre ${h}h e ${h + 1}h contra ${alt.n} entre ${alt.h}h e ${alt.h + 1}h. Relatos comunitários indicam percepção de movimento, não medem lotação; correlação não implica causa.`,
          demo: crowd.some((x) => x.demo) });
      }
    }
    res.json({
      disponivel: true, inclui_dados_demo: items.some((x) => x.is_demo),
      metodo: "Estatística descritiva sobre o seu histórico (mediana e quartis do horário de saída; média e desvio-padrão da duração planejada).",
      destinos, por_dia: porDia,
      duracao: { media_min: Math.round(mean), desvio_padrao_min: Math.round(sd * 10) / 10, min: Math.round(Math.min(...durs)), max: Math.round(Math.max(...durs)), n: durs.length },
      movimento_reportado: { por_hora: crowd, aviso: `Agregado de todos os usuários; horas com menos de ${K_ANON} relatores distintos são omitidas.` },
      sugestoes,
      lugares_para_aguardar: { disponivel: false, motivo: "Fonte de estabelecimentos (OpenStreetMap/Overpass) ainda não integrada — não sugerimos locais sem dados reais." },
    });
  });

  /** Gera histórico SINTÉTICO para demonstrar a análise de hábitos (somente modo demo). */
  r.post("/demo-history", async (req, res) => {
    const u = requireUser(req);
    if (!config.seedDemo) throw new HttpError(404, "Modo demonstração desativado.", "demo_off");
    if (!(await hasConsent(db, u.user_id, "historico_viagens"))) throw new HttpError(403, "Ative o histórico de viagens antes.", "consentimento_necessario");
    const net = await getNet();
    const pairs = [["estacao:vila-madalena", "estacao:se"], ["estacao:se", "estacao:vila-madalena"]].filter(([a, b]) => net.groups.has(a) && net.groups.has(b));
    if (!pairs.length) throw new HttpError(500, "Estações de demonstração ausentes.", "demo");
    let seed = 7, n = 0;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let d = 1; d <= 35 && n < 24; d++) {
      const day = new Date(Date.now() - d * 86400000);
      const lp = localParts(day);
      if (lp.isoDow > 5) continue;
      for (const [k, [o, dst]] of pairs.entries()) {
        const baseMin = k === 0 ? 7 * 60 + 30 : 18 * 60;
        const depMin = baseMin + Math.round((rand() - 0.5) * 30);
        const dep = new Date(`${lp.isoDate}T${clock(depMin)}:00-03:00`);
        const p = plan(net, { origin: o, destination: dst, departAt: dep, modes: ["onibus", "metro", "trem"], profiles: ["mais_rapida"] });
        const alt = p.alternativas[0];
        if (!alt) continue;
        const j = (await db.query<{ journey_id: string }>(`INSERT INTO journeys (user_id, origin_stop_id, destination_stop_id, requested_departure, profile, status,
          planned_duration_secs, transfers, saved_to_history, is_demo, dataset_version_id, created_at)
          VALUES ($1,$2,$3,$4,'mais_rapida','concluida',$5,$6,true,true,$7,$4) RETURNING journey_id`,
          [u.user_id, alt.pernas[0].de.id, alt.pernas[alt.pernas.length - 1].para.id, dep.toISOString(), alt.metricas.total_min * 60, alt.metricas.baldeacoes, net.datasetVersion])).rows[0];
        for (const [i, l] of alt.pernas.entries()) {
          await db.query(`INSERT INTO journey_legs (journey_id, leg_index, kind, route_id, from_stop_id, to_stop_id, departure_secs, arrival_secs, wait_secs, stop_ids)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [j.journey_id, i, l.tipo, l.linha?.id ?? null, l.de.id, l.para.id, Math.round(l.partida_s),
            Math.round(l.chegada_s), (l.espera_min ?? 0) * 60, l.paradas?.map((x) => x.id) ?? [l.de.id, l.para.id]]);
        }
        n++;
      }
    }
    res.json({ criadas: n, aviso: "Viagens SINTÉTICAS (is_demo = true), apenas para demonstrar a análise." });
  });

  // ---------- direitos do titular
  r.get("/export", async (req, res) => {
    const u = requireUser(req);
    const q = async (sql: string) => (await db.query(sql, [u.user_id])).rows;
    const data = {
      gerado_em: new Date().toISOString(),
      aviso: "Cópia dos seus dados pessoais (art. 18, II e V, LGPD).",
      conta: (await q("SELECT user_id, email, display_name, role, email_verified_at, reputation, created_at, last_login_at FROM users WHERE user_id=$1"))[0],
      preferencias: (await q("SELECT preferred_modes, max_walk_m, prefer_less_walking, updated_at FROM user_preferences WHERE user_id=$1"))[0],
      consentimentos: await q("SELECT purpose, granted, legal_basis, policy_version, recorded_at FROM user_consents WHERE user_id=$1 ORDER BY recorded_at"),
      favoritos: await q("SELECT label, custom_name, stop_id, created_at FROM favorite_places WHERE user_id=$1"),
      viagens: await q(`SELECT j.*, (SELECT json_agg(l ORDER BY l.leg_index) FROM journey_legs l WHERE l.journey_id=j.journey_id) AS pernas,
        (SELECT json_agg(c) FROM journey_checkpoints c WHERE c.journey_id=j.journey_id) AS confirmacoes FROM journeys j WHERE j.user_id=$1`),
      recomendacoes: await q("SELECT recommendation_id, request, feedback, created_at FROM recommendations WHERE user_id=$1"),
      relatos: await q("SELECT report_id, type, stop_id, route_id, description, status, created_at, expires_at FROM community_reports WHERE user_id=$1"),
      votos: await q("SELECT report_id, vote, created_at FROM report_confirmations WHERE user_id=$1"),
      denuncias: await q("SELECT report_id, reason, created_at FROM report_flags WHERE user_id=$1"),
      auditoria: await q("SELECT occurred_at, action, entity, entity_id FROM audit_logs WHERE actor_user_id=$1 ORDER BY occurred_at"),
    };
    await audit(db, req, u.user_id, "exportacao_dados", "users", u.user_id, {});
    res.setHeader("Content-Disposition", 'attachment; filename="baldeia-meus-dados.json"');
    res.json(data);
  });

  r.delete("/", async (req, res) => {
    const u = requireUser(req);
    parse(z.object({ confirmacao: z.literal("EXCLUIR") }), req.body);
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM users WHERE user_id=$1", [u.user_id]); // cascata; relatos ficam sem autoria
    });
    await audit(db, req, null, "conta_excluida", "users", null, { relatos_anonimizados: true });
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });
  return r;
}
