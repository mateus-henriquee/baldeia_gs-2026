import { config } from "../config.js";
import type { Db } from "../db/client.js";

/** Política de retenção (docs/governanca-e-etica.md §6). Executada na inicialização e a cada 6 h. */
export async function applyRetention(db: Db): Promise<Record<string, number>> {
  const { journeyDays, reportTextDays, auditDays } = config.retention;
  const count = async (sql: string, p: unknown[]) => (await db.query(`${sql} RETURNING 1`, p)).rows.length;
  const out = {
    viagens_excluidas: await count("DELETE FROM journeys WHERE requested_departure < now() - make_interval(days => $1)", [journeyDays]),
    textos_de_relatos_apagados: await count(`UPDATE community_reports SET description=NULL WHERE description IS NOT NULL
      AND expires_at < now() - make_interval(days => $1)`, [reportTextDays]),
    recomendacoes_anonimas_excluidas: await count("DELETE FROM recommendations WHERE user_id IS NULL AND created_at < now() - interval '90 days'", []),
    logs_excluidos: await count("DELETE FROM audit_logs WHERE occurred_at < now() - make_interval(days => $1)", [auditDays]),
  };
  if (Object.values(out).some((n) => n > 0)) {
    await db.query("INSERT INTO audit_logs (action, entity, metadata) VALUES ('retencao_aplicada','sistema',$1)", [JSON.stringify(out)]);
  }
  return out;
}
