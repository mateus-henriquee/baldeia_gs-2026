export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: { campo: string; mensagem: string }[]) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Sem conexão com o servidor. Verifique se a API está rodando (npm run dev).", "offline");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.erro ?? "Erro inesperado.", data.codigo, data.detalhes);
  return data as T;
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? (e.details?.length ? `${e.message} ${e.details.map((d) => d.mensagem).join(" ")}` : e.message) : "Algo deu errado.";

// ------------------------------------------------------------- tipos da API
export type Mode = "onibus" | "metro" | "trem";
export interface Place { id: string; nome: string; tipo: "estacao" | "ponto"; lat: number; lon: number; modos: string[] }
export interface StopRef { id: string; nome: string; lat: number; lon: number }
export interface Leg {
  tipo: "caminhada" | "transporte"; de: StopRef; para: StopRef; partida: string; chegada: string; partida_s: number; chegada_s: number;
  duracao_min: number; caminhada_m?: number;
  linha?: { id: string; nome: string; descricao: string; modo: Mode; cor: string; cor_texto: string; sentido: string };
  espera_min?: number; espera_tipo?: "estimada_por_frequencia" | "proxima_partida_programada"; intervalo_min?: number;
  paradas?: (StopRef & { chegada: string })[]; avisos_dados?: string[];
}
export interface Alternative {
  id: string; perfis: string[]; rotulos: string[];
  metricas: { total_min: number; viagem_min: number; espera_min: number; caminhada_min: number; caminhada_m: number; baldeacoes: number;
    embarques: number; relatos_lotacao: number; relatos_ocorrencias: number; partida: string; chegada: string };
  componentes_s: { viagem: number; espera: number; caminhada: number; embarques: number; lotacao: number; ocorrencias: number };
  pernas: Leg[];
  explicacao: { fatores: { fator: string; valor: string; fonte: string }[]; motivos: string[]; avisos: string[] };
}
export interface PlanResult {
  dataset: { versao: string; aviso: string | null };
  consulta: { origem: string; destino: string; partida: string; dia_semana: string; modos: Mode[] };
  criterios: Record<string, { disponivel: boolean; fonte?: string; motivo?: string }>;
  alternativas: Alternative[]; sem_resultado?: string; compute_ms: number; recomendacao_id: string | null;
}
export interface Report {
  id: string; tipo: string; tipo_rotulo: string; origem: "comunidade"; demo: boolean;
  local: StopRef & { stop_id: string }; linha: { id: string; nome: string } | null; descricao: string | null;
  criado_em: string; expira_em: string; status: string; denuncias: number; meu: boolean;
  confianca: { apoio: number; frescor: number; confianca: number; rotulo: "confirmado_oficial" | "corroborado" | "nao_verificado" | "contestado";
    confirmacoes: number; contestacoes: number; explicacao: string[] };
}
export interface User { id: string; email: string; nome: string; papel: "usuario" | "moderador" | "admin"; verificado: boolean; reputacao: number; demo: boolean }
