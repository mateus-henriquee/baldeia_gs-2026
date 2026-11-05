import { readFileSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { snapshot } from "../lib/metrics.js";
import type { Network } from "../routing/network.js";
import { PROFILES } from "../routing/planner.js";
import { REPORT_TYPES } from "../community/trust.js";

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const K_ANON = 3;

export function publicRouter(db: Db, getNet: () => Promise<Network>): Router {
  const r = Router();

  r.get("/health", async (_req, res) => {
    const ok = await db.query("SELECT 1 AS ok");
    res.json({ status: ok.rows.length ? "ok" : "erro", banco: db.kind, horario: new Date().toISOString() });
  });

  /** Busca de locais: estações (agrupadas por nome) e pontos de ônibus. */
  r.get("/places", async (req, res) => {
    const q = norm(String(req.query.q ?? "")).slice(0, 60);
    const net = await getNet();
    if (q.length < 2) return res.json({ locais: [] });
    const stations = [...net.groups.values()].filter((g) => norm(g.name).includes(q))
      .sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 8).map((g) => ({ id: g.id, nome: g.name, tipo: "estacao", lat: g.lat, lon: g.lon,
        modos: [...new Set(g.stopIds.flatMap((s) => net.byStop.get(s)?.map((x) => net.routes.get(net.patterns[x.p].routeId)?.mode) ?? []))] }));
    const stops = [...net.stops.values()].filter((s) => s.kind === "ponto" && norm(s.name).includes(q)).slice(0, 6)
      .map((s) => ({ id: s.id, nome: s.name, tipo: "ponto", lat: s.lat, lon: s.lon, modos: ["onibus"] }));
    res.json({ locais: [...stations, ...stops] });
  });

  r.get("/network", async (_req, res) => {
    const net = await getNet();
    const shapes = (await db.query<{ geojson: unknown }>("SELECT geojson FROM route_shapes ORDER BY route_id, direction_id")).rows.map((x) => x.geojson);
    res.set("Cache-Control", "public, max-age=3600");
    res.json({
      dataset: net.datasetVersion,
      linhas: [...net.routes.values()].map((x) => ({ id: x.id, nome: x.shortName, descricao: x.longName, modo: x.mode, cor: x.color, cor_texto: x.textColor })),
      estacoes: [...net.groups.values()].map((g) => ({ id: g.id, nome: g.name, lat: g.lat, lon: g.lon, paradas: g.stopIds })),
      pontos: [...net.stops.values()].filter((s) => s.kind === "ponto").map((s) => ({ id: s.id, nome: s.name, lat: s.lat, lon: s.lon })),
      tracados: { type: "FeatureCollection", features: shapes },
    });
  });

  r.get("/stops/:id/routes", async (req, res) => {
    const rows = (await db.query("SELECT v.route_id AS id, r.short_name AS nome, v.mode AS modo FROM v_stop_routes v JOIN routes r USING (route_id) WHERE v.stop_id=$1 ORDER BY 2",
      [req.params.id])).rows;
    res.json({ linhas: rows });
  });

  r.get("/meta", (_req, res) => {
    res.json({
      perfis: Object.entries(PROFILES).map(([id, p]) => ({ id, rotulo: p.rotulo, descricao: p.descricao, pesos: p.pesos, exige: p.exige ?? null })),
      tipos_relato: Object.entries(REPORT_TYPES).map(([id, t]) => ({ id, ...t })),
      demo: config.seedDemo,
    });
  });

  /** Transparência: fontes, versão ativa, qualidade, linhagem e análises (sem dados pessoais). */
  r.get("/transparency", async (_req, res) => {
    const fontes = (await db.query("SELECT * FROM data_sources ORDER BY category, integration_status, name")).rows;
    const versao = (await db.query<{ dataset_version_id: string; manifest: Record<string, unknown>; loaded_at: Date }>(
      "SELECT dataset_version_id, manifest, loaded_at FROM dataset_versions WHERE is_active ORDER BY loaded_at DESC LIMIT 1")).rows[0];
    const qualidade = versao ? (await db.query(`SELECT check_code, table_name, dimension, rule, records_checked, records_failed, action, severity, status, details
      FROM quality_checks WHERE dataset_version_id=$1 ORDER BY status DESC, table_name, check_code`, [versao.dataset_version_id])).rows : [];
    const jobs = (await db.query("SELECT job_id, source_id, started_at, finished_at, status, records_received, bronze_path FROM ingestion_jobs ORDER BY started_at DESC LIMIT 10")).rows;
    const feedback = (await db.query<{ total: number; util: number; nao_util: number; p50: number }>(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE feedback='util')::int AS util, count(*) FILTER (WHERE feedback='nao_util')::int AS nao_util,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY compute_ms), 0)::float AS p50 FROM recommendations`)).rows[0];
    res.json({ fontes, versao_ativa: versao ? { id: versao.dataset_version_id, carregada_em: versao.loaded_at, manifesto: versao.manifest } : null,
      qualidade, ingestoes: jobs, recomendacoes: feedback });
  });

  r.get("/analytics", async (_req, res) => {
    const gold = JSON.parse(readFileSync(path.join(config.goldDir, "analytics.json"), "utf8"));
    const hourly = (await db.query<{ type: string; hour: number; reports: number; reporters: number; demo: boolean }>(`
      SELECT type, EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour, count(*)::int AS reports,
             count(DISTINCT user_id)::int AS reporters, BOOL_OR(is_demo) AS demo
      FROM community_reports WHERE status <> 'removido' GROUP BY 1,2 ORDER BY 1,2`)).rows;
    res.json({ oferta: gold, comunidade: {
      aviso: `Agregado por hora e tipo. Faixas com menos de ${K_ANON} relatores distintos são omitidas (anonimato).`,
      inclui_sinteticos: hourly.some((h) => h.demo),
      por_hora: hourly.filter((h) => h.reporters >= K_ANON) } });
  });

  r.get("/status", (_req, res) => res.json(snapshot()));
  return r;
}
