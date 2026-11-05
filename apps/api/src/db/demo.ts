/**
 * Dados SINTÉTICOS de demonstração (is_demo = true em todas as linhas).
 * Gerados com semente fixa para reprodutibilidade. Nunca representam ocorrências reais.
 * Desative com SEED_DEMO=false.
 */
import bcrypt from "bcryptjs";
import type { Db } from "./client.js";
import { REPORT_TYPES, type ReportType } from "../community/trust.js";

export const DEMO_ACCOUNTS = [
  { email: "demo@baldeia.dev", password: "baldeia-demo-2026", name: "Pessoa Demo", role: "usuario" },
  { email: "moderacao@baldeia.dev", password: "baldeia-mod-2026", name: "Moderação Demo", role: "moderador" },
] as const;

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DEMO_TEXT: Record<ReportType, string[]> = {
  superlotacao: ["Plataforma cheia, demorei a conseguir embarcar.", "Vagão muito cheio neste horário."],
  atraso: ["Intervalo maior que o normal entre trens.", "Ônibus demorando mais que o habitual."],
  linha_parada: ["Trens parados há alguns minutos."],
  interrupcao: ["Circulação com velocidade reduzida."],
  acidente: ["Trânsito parado por acidente próximo ao ponto."],
  enchente: ["Água acumulada na calçada perto do acesso."],
  assalto: ["Situação suspeita relatada perto do acesso; atenção."],
  problema_estacao: ["Escada rolante parada.", "Elevador fora de serviço."],
};

async function stationIds(db: Pick<Db, "query">, names: string[]): Promise<{ stop_id: string; name: string }[]> {
  return (await db.query<{ stop_id: string; name: string }>(
    "SELECT DISTINCT ON (name) stop_id, name FROM stops WHERE kind='estacao' AND name = ANY($1) ORDER BY name, stop_id", [names])).rows;
}

export async function ensureDemoUsers(db: Db): Promise<void> {
  for (const a of DEMO_ACCOUNTS) {
    const exists = await db.query("SELECT 1 FROM users WHERE email_normalized=$1", [a.email]);
    if (exists.rows.length) continue;
    const hash = await bcrypt.hash(a.password, 10);
    const u = (await db.query<{ user_id: string }>(`INSERT INTO users (email, email_normalized, password_hash, display_name, role, email_verified_at, is_demo)
      VALUES ($1,$1,$2,$3,$4,now(),true) RETURNING user_id`, [a.email, hash, a.name, a.role])).rows[0];
    await db.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [u.user_id]);
    for (const purpose of ["historico_viagens", "analise_habitos", "comunidade_publicar"]) {
      await db.query(`INSERT INTO user_consents (user_id, purpose, granted, legal_basis, policy_version)
        VALUES ($1,$2,true,'consentimento (art. 7º, I) — conta de demonstração','demo')`, [u.user_id, purpose]);
    }
  }
  // Pessoas sintéticas que publicam/confirmam relatos de demonstração.
  const crowd = await db.query("SELECT count(*)::int AS n FROM users WHERE is_demo AND email_normalized LIKE 'sintetico%'");
  if ((crowd.rows[0] as { n: number }).n === 0) {
    const hash = await bcrypt.hash(`sintetico-${Date.now()}-${Math.random()}`, 4);  // senha descartável: contas sem login
    for (let i = 1; i <= 8; i++) {
      await db.query(`INSERT INTO users (email, email_normalized, password_hash, display_name, email_verified_at, reputation, is_demo)
        VALUES ($1,$1,$2,$3,now(),$4,true)`, [`sintetico${i}@baldeia.dev`, hash, `Sintético ${i}`, (0.45 + i * 0.05).toFixed(3)]);
    }
  }
}

/** Gera relatos sintéticos ativos (recentes) e um histórico de 28 dias para análises agregadas. */
export async function seedDemoReports(db: Db, opts: { history?: boolean } = {}): Promise<number> {
  const rand = rng(20261105 + (opts.history ? 0 : Date.now() % 1000));
  const users = (await db.query<{ user_id: string; reputation: string }>(
    "SELECT user_id, reputation FROM users WHERE is_demo AND email_normalized LIKE 'sintetico%' ORDER BY email_normalized")).rows;
  const stations = await stationIds(db, ["Sé", "Paraíso", "Luz", "Brás", "Tatuapé", "Consolação", "República", "Barra Funda", "Ana Rosa", "Santa Cecília"]);
  if (!users.length || !stations.length) return 0;
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const types: ReportType[] = ["superlotacao", "superlotacao", "superlotacao", "atraso", "atraso", "problema_estacao", "interrupcao", "enchente"];
  let n = 0;

  const insert = async (type: ReportType, stop: string, createdAt: Date, author: { user_id: string; reputation: string }, votes: number, contests: number) => {
    const expires = new Date(createdAt.getTime() + REPORT_TYPES[type].validadeMin * 60000);
    const r = (await db.query<{ report_id: string }>(`INSERT INTO community_reports (user_id, type, stop_id, description, reporter_weight, is_demo, created_at, expires_at)
      VALUES ($1,$2,$3,$4,$5,true,$6,$7) RETURNING report_id`,
      [author.user_id, type, stop, pick(DEMO_TEXT[type]), author.reputation, createdAt.toISOString(), expires.toISOString()])).rows[0];
    const voters = users.filter((u) => u.user_id !== author.user_id).sort(() => rand() - 0.5);
    for (let k = 0; k < votes + contests && k < voters.length; k++) {
      await db.query(`INSERT INTO report_confirmations (report_id, user_id, vote, voter_weight, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [r.report_id, voters[k].user_id, k < votes ? "confirma" : "contesta", voters[k].reputation, new Date(createdAt.getTime() + (k + 1) * 60000).toISOString()]);
    }
    n++;
  };

  const now = Date.now();
  // Ativos: criados entre 3 e 25 minutos atrás.
  for (let i = 0; i < 10; i++) {
    const type = pick(types);
    await insert(type, pick(stations).stop_id, new Date(now - (3 + rand() * 22) * 60000), pick(users), Math.floor(rand() * 4), rand() < 0.2 ? 1 : 0);
  }
  if (opts.history) {
    // Histórico sintético: concentração artificial nos picos (7–9h e 17–19h) para demonstrar a análise.
    for (let d = 1; d <= 28; d++) {
      const day = new Date(now - d * 86400000);
      if ([0, 6].includes(day.getUTCDay())) continue;
      for (let k = 0; k < 6; k++) {
        const peak = rand() < 0.75;
        const hourLocal = peak ? (rand() < 0.5 ? 7 + Math.floor(rand() * 2) : 17 + Math.floor(rand() * 2)) : 6 + Math.floor(rand() * 16);
        const created = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hourLocal + 3, Math.floor(rand() * 60)));
        await insert(pick(types), pick(stations).stop_id, created, pick(users), Math.floor(rand() * 3), 0);
      }
    }
  }
  return n;
}

export async function seedDemo(db: Db): Promise<void> {
  await ensureDemoUsers(db);
  const has = await db.query("SELECT 1 FROM community_reports WHERE is_demo LIMIT 1");
  if (!has.rows.length) await seedDemoReports(db, { history: true });
  else {
    const active = await db.query("SELECT 1 FROM community_reports WHERE is_demo AND status='ativo' AND expires_at > now() LIMIT 1");
    if (!active.rows.length) await seedDemoReports(db);
  }
}
