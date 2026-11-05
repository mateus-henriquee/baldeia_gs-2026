import type { Db } from "../db/client.js";

export const PURPOSES = {
  historico_viagens: {
    titulo: "Salvar histórico de viagens",
    finalidade: "Guardar trajetos iniciados para você consultá-los e repetir buscas.",
    base_legal: "consentimento (art. 7º, I, LGPD)",
    retencao: "180 dias, depois excluído automaticamente",
  },
  analise_habitos: {
    titulo: "Analisar meus hábitos de deslocamento",
    finalidade: "Calcular horários habituais e sugerir alternativas de horário. Processado só para você; nunca vendido nem compartilhado.",
    base_legal: "consentimento (art. 7º, I, LGPD)",
    retencao: "Calculado sob demanda a partir do histórico; nada adicional é armazenado",
  },
  geolocalizacao: {
    titulo: "Usar minha localização durante a navegação",
    finalidade: "Detectar a parada mais próxima no seu aparelho. Coordenadas não são enviadas ao servidor.",
    base_legal: "consentimento (art. 7º, I, LGPD) + permissão do navegador",
    retencao: "Não armazenada",
  },
  comunidade_publicar: {
    titulo: "Publicar relatos na comunidade",
    finalidade: "Compartilhar ocorrências associadas a uma parada/estação, sem exibir seu nome.",
    base_legal: "consentimento (art. 7º, I, LGPD) e termos de uso",
    retencao: "Texto apagado 30 dias após expirar; tipo/local/horário mantidos de forma agregada",
  },
} as const;
export type Purpose = keyof typeof PURPOSES;

export async function hasConsent(db: Pick<Db, "query">, userId: string, purpose: Purpose): Promise<boolean> {
  const r = (await db.query<{ granted: boolean }>(`SELECT granted FROM user_consents WHERE user_id=$1 AND purpose=$2
    ORDER BY recorded_at DESC, consent_id DESC LIMIT 1`, [userId, purpose])).rows[0];
  return Boolean(r?.granted);
}

export async function consentState(db: Pick<Db, "query">, userId: string) {
  const rows = (await db.query<{ purpose: Purpose; granted: boolean; recorded_at: Date }>(`SELECT DISTINCT ON (purpose) purpose, granted, recorded_at
    FROM user_consents WHERE user_id=$1 ORDER BY purpose, recorded_at DESC, consent_id DESC`, [userId])).rows;
  return (Object.keys(PURPOSES) as Purpose[]).map((p) => {
    const r = rows.find((x) => x.purpose === p);
    return { finalidade_id: p, ...PURPOSES[p], concedido: Boolean(r?.granted), atualizado_em: r?.recorded_at ?? null };
  });
}
