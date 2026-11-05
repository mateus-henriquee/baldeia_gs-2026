import type { Request } from "express";
import type { Db } from "../db/client.js";
import { hashIp } from "../lib/privacy.js";

/** Registro de auditoria: quem (pseudônimo), o quê, quando. Nunca grava senha, token ou coordenadas. */
export async function audit(db: Pick<Db, "query">, req: Request | null, actor: string | null, action: string,
  entity: string, entityId: string | null, metadata: Record<string, unknown>): Promise<void> {
  await db.query(`INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, metadata, ip_hash) VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor, action, entity, entityId, JSON.stringify(metadata), hashIp(req?.ip)]);
}
