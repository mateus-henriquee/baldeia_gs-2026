/**
 * Confiabilidade de relatos comunitários — regras transparentes (docs/governanca-e-etica.md §5.4).
 *
 * Princípios:
 * - Um relato nunca vira "verdade": o rótulo máximo da comunidade é "corroborado".
 * - Confirmações têm retorno decrescente (peso √n) e o apoio comunitário tem teto (0,85).
 * - Contestações pesam tanto quanto confirmações; um "cético" fixo entra no denominador.
 * - A informação envelhece: o frescor decai exponencialmente conforme o tipo de ocorrência.
 */
export const REPORT_TYPES = {
  superlotacao:     { rotulo: "Superlotação",              meiaVidaMin: 20,  validadeMin: 45 },
  atraso:           { rotulo: "Atraso",                    meiaVidaMin: 20,  validadeMin: 45 },
  linha_parada:     { rotulo: "Linha parada",              meiaVidaMin: 45,  validadeMin: 120 },
  interrupcao:      { rotulo: "Interrupção",               meiaVidaMin: 45,  validadeMin: 120 },
  acidente:         { rotulo: "Acidente",                  meiaVidaMin: 45,  validadeMin: 120 },
  enchente:         { rotulo: "Alagamento/enchente",       meiaVidaMin: 90,  validadeMin: 180 },
  assalto:          { rotulo: "Assalto/situação suspeita", meiaVidaMin: 45,  validadeMin: 120 },
  problema_estacao: { rotulo: "Problema na estação/ponto", meiaVidaMin: 360, validadeMin: 1440 },
} as const;
export type ReportType = keyof typeof REPORT_TYPES;

export const COMMUNITY_CAP = 0.85;
export const SKEPTIC_PRIOR = 1;
export const FLAGS_TO_HIDE = 3;

export interface TrustInput {
  type: ReportType;
  createdAt: Date;
  reporterWeight: number;       // reputação do autor (0..1), já reduzida se conta não verificada
  confirmWeights: number[];     // pesos de quem confirmou (autor nunca incluso)
  contestWeights: number[];
  officialMatch?: boolean;      // alerta oficial compatível (GTFS-RT Alerts) — não há fonte na demo
  now?: Date;
}

export interface TrustResult {
  apoio: number;                // 0..1 — quanto a comunidade sustenta o relato
  frescor: number;              // 0..1 — decaimento temporal
  confianca: number;            // apoio × frescor: usado pelo roteador
  rotulo: "confirmado_oficial" | "corroborado" | "nao_verificado" | "contestado";
  confirmacoes: number;
  contestacoes: number;
  explicacao: string[];
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const round = (x: number) => Math.round(x * 1000) / 1000;

export function computeTrust(i: TrustInput): TrustResult {
  const now = i.now ?? new Date();
  const ageMin = Math.max(0, (now.getTime() - i.createdAt.getTime()) / 60000);
  const { meiaVidaMin } = REPORT_TYPES[i.type];
  const frescor = Math.pow(0.5, ageMin / meiaVidaMin);

  // Retorno decrescente: n confirmações de peso médio w contam como w·√n.
  const diminishing = (ws: number[]) => (ws.length ? (sum(ws) / ws.length) * Math.sqrt(ws.length) : 0);
  const c = diminishing(i.confirmWeights);
  const d = diminishing(i.contestWeights);
  let apoio = (i.reporterWeight + c) / (i.reporterWeight + c + d + SKEPTIC_PRIOR);
  apoio = Math.min(apoio, COMMUNITY_CAP);
  if (i.officialMatch) apoio = Math.max(apoio, 0.95);

  let rotulo: TrustResult["rotulo"] = "nao_verificado";
  if (i.officialMatch) rotulo = "confirmado_oficial";
  else if (i.contestWeights.length > 0 && apoio < 0.35) rotulo = "contestado";
  else if (i.confirmWeights.length >= 2 && apoio >= 0.6) rotulo = "corroborado";

  const explicacao = [
    `Reputação do autor: ${round(i.reporterWeight)}`,
    `${i.confirmWeights.length} confirmação(ões) e ${i.contestWeights.length} contestação(ões) independentes (retorno decrescente: √n)`,
    `Apoio comunitário limitado a ${COMMUNITY_CAP} — só fonte oficial confirma de fato`,
    `Frescor: meia-vida de ${meiaVidaMin} min para "${REPORT_TYPES[i.type].rotulo}" (idade: ${Math.round(ageMin)} min)`,
  ];
  return { apoio: round(apoio), frescor: round(frescor), confianca: round(apoio * frescor), rotulo,
    confirmacoes: i.confirmWeights.length, contestacoes: i.contestWeights.length, explicacao };
}

/** Reputação bayesiana simples: (relatos mantidos + 1) / (relatos avaliados + 2). */
export function reputationFrom(kept: number, removed: number): number {
  return round((kept + 1) / (kept + removed + 2));
}
