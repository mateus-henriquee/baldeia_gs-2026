/**
 * Planejador multicritério — Dijkstra dependente do horário sobre o grafo da rede.
 *
 * Custo generalizado de um caminho (segundos-equivalentes):
 *   C = a·viagem + b·espera + c·caminhada + d·embarques + e·lotação + f·ocorrências
 * Cada "perfil" é um conjunto de pesos (a..f). Rodamos vários perfis, removemos
 * resultados repetidos e explicamos as diferenças. Ver docs/metodologia-analitica.md.
 *
 * Premissas declaradas:
 * - Serviço por frequência: espera esperada = metade do intervalo programado.
 * - Serviço por horário fixo: espera até a próxima partida programada.
 * - Caminhada: velocidade e fator de desvio definidos no pipeline (stop_transfers).
 */
import { fmtClock, localParts, minutes, type Weekday } from "../lib/time.js";
import { resolvePlace, type Mode, type Network, type Pattern } from "./network.js";

export type ProfileId = "mais_rapida" | "menos_baldeacoes" | "menos_caminhada" | "menos_movimentada" | "menos_ocorrencias";

export interface Weights { ride: number; wait: number; walk: number; board: number; crowd: number; incident: number }

export const PROFILES: Record<ProfileId, { rotulo: string; descricao: string; pesos: Weights; exige?: "lotacao" | "ocorrencias" }> = {
  mais_rapida: { rotulo: "Mais rápida", descricao: "Minimiza o tempo total estimado (viagem + espera + caminhada).",
    pesos: { ride: 1, wait: 1, walk: 1, board: 90, crowd: 0, incident: 0 } },
  menos_baldeacoes: { rotulo: "Menos baldeações", descricao: "Cada embarque extra custa o equivalente a 20 minutos.",
    pesos: { ride: 1, wait: 1, walk: 1, board: 1200, crowd: 0, incident: 0 } },
  menos_caminhada: { rotulo: "Menos caminhada", descricao: "Cada minuto a pé pesa como 3 minutos.",
    pesos: { ride: 1, wait: 1, walk: 3, board: 240, crowd: 0, incident: 0 } },
  menos_movimentada: { rotulo: "Potencialmente menos movimentada", exige: "lotacao",
    descricao: "Evita embarques em paradas/linhas com relatos ativos de superlotação, ponderados pela confiança.",
    pesos: { ride: 1, wait: 1, walk: 1, board: 120, crowd: 1200, incident: 0 } },
  menos_ocorrencias: { rotulo: "Menos ocorrências reportadas", exige: "ocorrencias",
    descricao: "Evita paradas com relatos ativos (atrasos, interrupções, alagamentos etc.), ponderados pela confiança. Não é um índice de segurança.",
    pesos: { ride: 1, wait: 1, walk: 1, board: 120, crowd: 0, incident: 1200 } },
};

export interface ActiveReport { reportId: string; type: string; stopId: string; routeId: string | null; confianca: number; rotulo: string; isDemo: boolean }

export interface PlanRequest {
  origin: string;
  destination: string;
  departAt: Date;
  modes: Mode[];
  maxWalkM?: number;
  profiles?: ProfileId[];
  reports?: ActiveReport[];
  maxBoardings?: number;
}

interface Label {
  cost: number; time: number; boardings: number;
  ride: number; wait: number; walk: number; walkM: number; crowd: number; incident: number;
  prev: Label | null; leg: LegRef | null; stop: string; byWalk: boolean;
}
type LegRef =
  | { kind: "caminhada"; from: string; to: string; secs: number; distanceM: number }
  | { kind: "transporte"; p: number; i: number; j: number; wait: number; waitKind: "frequencia" | "horario" ; headway?: number; board: number };

class Heap {
  private a: Label[] = [];
  get size() { return this.a.length; }
  push(x: Label) { const a = this.a; a.push(x); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= a[i].cost) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop(): Label | undefined { const a = this.a; if (!a.length) return undefined; const top = a[0]; const last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < a.length && a[l].cost < a[m].cost) m = l; if (r < a.length && a[r].cost < a[m].cost) m = r;
      if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

const MAX_WAIT = 2 * 3600;

/** Espera ao embarcar no padrão p na parada i no instante t (segundos do dia). */
export function waitAt(p: Pattern, i: number, t: number): { wait: number; kind: "frequencia" | "horario"; headway?: number } | null {
  let best: { wait: number; kind: "frequencia" | "horario"; headway?: number } | null = null;
  for (const w of p.windows) {
    const first = w.start + p.dep[i];
    const last = w.end + p.dep[i];
    if (t >= first && t < last) {
      const cand = { wait: w.headway / 2, kind: "frequencia" as const, headway: w.headway };
      if (!best || cand.wait < best.wait) best = cand;
    } else if (t < first && first - t <= MAX_WAIT) {
      const cand = { wait: first - t, kind: "frequencia" as const, headway: w.headway };
      if (!best || cand.wait < best.wait) best = cand;
    }
  }
  if (p.starts.length) {
    let lo = 0, hi = p.starts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (p.starts[m] + p.dep[i] < t) lo = m + 1; else hi = m; }
    if (lo < p.starts.length) {
      const wait = p.starts[lo] + p.dep[i] - t;
      if (wait <= MAX_WAIT && (!best || wait < best.wait)) best = { wait, kind: "horario" };
    }
  }
  return best;
}

function runProfile(net: Network, req: PlanRequest & { originIds: string[]; destIds: Set<string> }, weekday: Weekday, t0: number, w: Weights,
  crowdAt: (stop: string, route: string) => number, incidentAt: (stop: string) => number): Label | null {
  const maxWalk = req.maxWalkM ?? 600;
  const maxBoard = req.maxBoardings ?? 4;
  const best = new Map<string, number>();
  const heap = new Heap();
  for (const o of req.originIds) {
    heap.push({ cost: 0, time: t0, boardings: 0, ride: 0, wait: 0, walk: 0, walkM: 0, crowd: 0, incident: 0,
      prev: null, leg: null, stop: o, byWalk: false });
  }
  const allowed = new Set(req.modes);
  while (heap.size) {
    const cur = heap.pop()!;
    const key = `${cur.stop}|${cur.byWalk ? 1 : 0}`;
    if ((best.get(key) ?? Infinity) < cur.cost) continue;
    if (req.destIds.has(cur.stop) && cur.prev) return cur;

    if (!cur.byWalk) {
      for (const tr of net.transfers.get(cur.stop) ?? []) {
        if (tr.distanceM > maxWalk) continue;
        const next: Label = { ...cur, cost: cur.cost + w.walk * tr.walkSecs, time: cur.time + tr.walkSecs,
          walk: cur.walk + tr.walkSecs, walkM: cur.walkM + tr.distanceM, prev: cur, stop: tr.to, byWalk: true,
          leg: { kind: "caminhada", from: cur.stop, to: tr.to, secs: tr.walkSecs, distanceM: tr.distanceM } };
        const k = `${tr.to}|1`;
        if (next.cost < (best.get(k) ?? Infinity)) { best.set(k, next.cost); heap.push(next); }
      }
    }
    if (cur.boardings >= maxBoard) continue;
    for (const { p: pi, i } of net.byStop.get(cur.stop) ?? []) {
      const p = net.patterns[pi];
      const route = net.routes.get(p.routeId);
      if (!route || !allowed.has(route.mode)) continue;
      if (![...p.serviceIds].some((s) => net.services.get(s)?.has(weekday))) continue;
      if (cur.leg?.kind === "transporte" && net.patterns[cur.leg.p].routeId === p.routeId) continue; // sem "reembarque" na mesma linha
      const wt = waitAt(p, i, cur.time);
      if (!wt) continue;
      const crowd = crowdAt(cur.stop, p.routeId);
      let incident = 0;
      for (let j = i + 1; j < p.stops.length; j++) {
        incident += incidentAt(p.stops[j]);
        const ride = p.arr[j] - p.dep[i];
        const boardInc = cur.boardings === 0 ? incidentAt(cur.stop) : 0;
        const inc = incident + boardInc;
        const next: Label = {
          cost: cur.cost + w.wait * wt.wait + w.ride * ride + w.board + w.crowd * crowd + w.incident * inc,
          time: cur.time + wt.wait + ride, boardings: cur.boardings + 1,
          ride: cur.ride + ride, wait: cur.wait + wt.wait, walk: cur.walk, walkM: cur.walkM,
          crowd: cur.crowd + crowd, incident: cur.incident + inc, prev: cur, stop: p.stops[j], byWalk: false,
          leg: { kind: "transporte", p: pi, i, j, wait: wt.wait, waitKind: wt.kind, headway: wt.headway, board: cur.time + wt.wait },
        };
        const k = `${p.stops[j]}|0`;
        if (next.cost < (best.get(k) ?? Infinity)) { best.set(k, next.cost); heap.push(next); }
      }
    }
  }
  return null;
}

export interface Leg {
  tipo: "caminhada" | "transporte";
  de: { id: string; nome: string; lat: number; lon: number };
  para: { id: string; nome: string; lat: number; lon: number };
  partida: string; chegada: string; partida_s: number; chegada_s: number; duracao_min: number;
  caminhada_m?: number;
  linha?: { id: string; nome: string; descricao: string; modo: Mode; cor: string; cor_texto: string; sentido: string };
  espera_min?: number; espera_tipo?: "estimada_por_frequencia" | "proxima_partida_programada"; intervalo_min?: number;
  paradas?: { id: string; nome: string; lat: number; lon: number; chegada: string }[];
  avisos_dados?: string[];
}

export interface Alternative {
  id: string;
  perfis: ProfileId[];
  rotulos: string[];
  metricas: { total_min: number; viagem_min: number; espera_min: number; caminhada_min: number; caminhada_m: number;
    baldeacoes: number; embarques: number; relatos_lotacao: number; relatos_ocorrencias: number; partida: string; chegada: string };
  componentes_s: { viagem: number; espera: number; caminhada: number; embarques: number; lotacao: number; ocorrencias: number };
  pernas: Leg[];
  explicacao: { fatores: { fator: string; valor: string; fonte: string }[]; motivos: string[]; avisos: string[] };
}

function buildLegs(net: Network, end: Label): Leg[] {
  const refs: { leg: LegRef; at: number }[] = [];
  for (let l: Label | null = end; l?.prev; l = l.prev) refs.unshift({ leg: l.leg!, at: l.prev.time });
  const s = (id: string) => { const n = net.stops.get(id)!; return { id, nome: n.name, lat: n.lat, lon: n.lon }; };
  return refs.map(({ leg, at }) => {
    if (leg.kind === "caminhada") {
      return { tipo: "caminhada", de: s(leg.from), para: s(leg.to), partida: fmtClock(at), chegada: fmtClock(at + leg.secs),
        partida_s: at, chegada_s: at + leg.secs, duracao_min: minutes(leg.secs), caminhada_m: Math.round(leg.distanceM),
        avisos_dados: ["Tempo de caminhada estimado (premissa: 1,1 m/s e desvio de 30% sobre a linha reta)."] };
    }
    const p = net.patterns[leg.p];
    const r = net.routes.get(p.routeId)!;
    const avisos: string[] = [];
    for (let k = leg.i; k < leg.j; k++) {
      const a = p.hopAnomaly[k];
      if (a) avisos.push(`O feed registra ${Math.round(a.speedKmh)} km/h entre ${net.stops.get(p.stops[k])?.name} e ${net.stops.get(p.stops[k + 1])?.name} — valor atípico; o tempo deste trecho pode estar subestimado.`);
      if (p.hopImputed[k]) avisos.push(`Tempo entre ${net.stops.get(p.stops[k])?.name} e ${net.stops.get(p.stops[k + 1])?.name} foi imputado pelo pipeline (feed sem tempo positivo).`);
    }
    const tripStart = leg.board - p.dep[leg.i];
    const arrive = tripStart + p.arr[leg.j];
    return {
      tipo: "transporte", de: s(p.stops[leg.i]), para: s(p.stops[leg.j]),
      partida: fmtClock(leg.board), chegada: fmtClock(arrive), partida_s: leg.board, chegada_s: arrive,
      duracao_min: minutes(arrive - leg.board),
      linha: { id: r.id, nome: r.shortName, descricao: r.longName, modo: r.mode, cor: r.color, cor_texto: r.textColor, sentido: p.headsign },
      espera_min: minutes(leg.wait), espera_tipo: leg.waitKind === "frequencia" ? "estimada_por_frequencia" : "proxima_partida_programada",
      intervalo_min: leg.headway ? minutes(leg.headway) : undefined,
      paradas: p.stops.slice(leg.i, leg.j + 1).map((id, k) => ({ ...s(id), chegada: fmtClock(tripStart + p.arr[leg.i + k]) })),
      avisos_dados: avisos,
    };
  });
}

export interface PlanResult {
  dataset: { versao: string; aviso: string | null };
  consulta: { origem: string; destino: string; partida: string; dia_semana: Weekday; modos: Mode[] };
  criterios: Record<string, { disponivel: boolean; fonte?: string; motivo?: string }>;
  alternativas: Alternative[];
  sem_resultado?: string;
  compute_ms: number;
}

export function plan(net: Network, req: PlanRequest): PlanResult {
  const t = performance.now();
  const originIds = resolvePlace(net, req.origin);
  const destIds = new Set(resolvePlace(net, req.destination));
  if (!originIds.length || !destIds.size) throw new Error("Origem ou destino inexistente.");
  if (originIds.some((o) => destIds.has(o))) throw new Error("Origem e destino são o mesmo local.");
  const { weekday, secs } = localParts(req.departAt);
  const reports = req.reports ?? [];
  const crowdReports = reports.filter((r) => r.type === "superlotacao" && r.confianca >= 0.15);
  const incidentReports = reports.filter((r) => r.type !== "superlotacao" && r.confianca >= 0.15);
  const crowdIdx = new Map<string, ActiveReport[]>();
  for (const r of crowdReports) (crowdIdx.get(r.stopId) ?? crowdIdx.set(r.stopId, []).get(r.stopId)!).push(r);
  const incIdx = new Map<string, number>();
  for (const r of incidentReports) incIdx.set(r.stopId, Math.max(incIdx.get(r.stopId) ?? 0, r.confianca));
  const crowdAt = (stop: string, route: string) =>
    Math.max(0, ...(crowdIdx.get(stop) ?? []).filter((r) => !r.routeId || r.routeId === route).map((r) => r.confianca));
  const incidentAt = (stop: string) => incIdx.get(stop) ?? 0;

  const criterios: PlanResult["criterios"] = {
    tempo: { disponivel: true, fonte: "Horários e frequências programados (GTFS)" },
    baldeacoes: { disponivel: true, fonte: "Estrutura da rede (GTFS)" },
    caminhada: { disponivel: true, fonte: "Distância em linha reta + premissas de caminhada" },
    lotacao: crowdReports.length
      ? { disponivel: true, fonte: `Relatos comunitários ativos de superlotação (${crowdReports.length}), não verificados oficialmente` }
      : { disponivel: false, motivo: "Sem dados suficientes: nenhum relato ativo de superlotação e nenhuma fonte oficial de lotação integrada." },
    ocorrencias: incidentReports.length
      ? { disponivel: true, fonte: `Relatos comunitários ativos (${incidentReports.length}), ponderados por confiança` }
      : { disponivel: false, motivo: "Sem dados suficientes: nenhum relato ativo de ocorrência no momento." },
    seguranca: { disponivel: false, motivo: "Não calculamos “segurança”. Relatos não medem risco real e refletem onde há mais usuários reportando." },
    tempo_real: { disponivel: false, motivo: "Sem integração de tempo real (GTFS Realtime/Olho Vivo) nesta versão." },
  };

  const wanted = req.profiles ?? (Object.keys(PROFILES) as ProfileId[]);
  const found = new Map<string, { end: Label; perfis: ProfileId[] }>();
  for (const pid of wanted) {
    const prof = PROFILES[pid];
    if (prof.exige && !criterios[prof.exige].disponivel) continue;
    const end = runProfile(net, { ...req, originIds, destIds }, weekday, secs, prof.pesos, crowdAt, incidentAt);
    if (!end) continue;
    const sig: string[] = [];
    for (let l: Label | null = end; l?.leg; l = l.prev) sig.unshift(l.leg.kind === "transporte" ? `${l.leg.p}:${l.leg.i}-${l.leg.j}` : `w:${l.leg.to}`);
    const key = sig.join(">");
    const e = found.get(key);
    if (e) e.perfis.push(pid); else found.set(key, { end, perfis: [pid] });
  }

  const alternativas: Alternative[] = [...found.values()].map(({ end, perfis }, idx) => {
    const pernas = buildLegs(net, end);
    const transit = pernas.filter((l) => l.tipo === "transporte");
    const first = pernas[0], last = pernas[pernas.length - 1];
    const total = last.chegada_s - secs;
    const crowdN = transit.filter((l) => crowdAt(l.de.id, l.linha!.id) > 0).length;
    const incN = new Set(transit.flatMap((l) => l.paradas!.map((p) => p.id)).filter((id) => incidentAt(id) > 0)).size;
    const fatores = [
      { fator: "Tempo total estimado", valor: `${minutes(total)} min`, fonte: "GTFS (programado) + premissas" },
      { fator: "Tempo dentro do veículo", valor: `${minutes(end.ride)} min`, fonte: "stop_times (GTFS)" },
      { fator: "Espera", valor: `${minutes(end.wait)} min`, fonte: transit.some((l) => l.espera_tipo === "estimada_por_frequencia") ? "Metade do intervalo programado (frequencies)" : "Próxima partida programada" },
      { fator: "Baldeações", valor: String(Math.max(0, end.boardings - 1)), fonte: "Estrutura da rede" },
      { fator: "Caminhada", valor: `${minutes(end.walk)} min (${Math.round(end.walkM)} m)`, fonte: "Premissas de caminhada" },
    ];
    if (criterios.lotacao.disponivel) fatores.push({ fator: "Embarques com relato de superlotação", valor: String(crowdN), fonte: "Comunidade (não verificado)" });
    if (criterios.ocorrencias.disponivel) fatores.push({ fator: "Paradas com ocorrência reportada", valor: String(incN), fonte: "Comunidade (não verificado)" });
    const avisos = [...new Set(pernas.flatMap((l) => l.avisos_dados ?? []).filter((a) => !a.startsWith("Tempo de caminhada")))];
    return {
      id: `alt${idx + 1}`, perfis, rotulos: perfis.map((p) => PROFILES[p].rotulo),
      metricas: { total_min: minutes(total), viagem_min: minutes(end.ride), espera_min: minutes(end.wait),
        caminhada_min: minutes(end.walk), caminhada_m: Math.round(end.walkM), baldeacoes: Math.max(0, end.boardings - 1),
        embarques: end.boardings, relatos_lotacao: crowdN, relatos_ocorrencias: incN, partida: first.partida, chegada: last.chegada },
      componentes_s: { viagem: end.ride, espera: end.wait, caminhada: end.walk, embarques: end.boardings, lotacao: end.crowd, ocorrencias: end.incident },
      pernas, explicacao: { fatores, motivos: [], avisos },
    };
  });

  // Motivos comparativos (em relação à mais rápida encontrada).
  const fastest = [...alternativas].sort((a, b) => a.metricas.total_min - b.metricas.total_min)[0];
  for (const a of alternativas) {
    a.explicacao.motivos = a.perfis.map((p) => `${PROFILES[p].rotulo}: ${PROFILES[p].descricao}`);
    if (fastest && a !== fastest) {
      const dt = a.metricas.total_min - fastest.metricas.total_min;
      const db = fastest.metricas.baldeacoes - a.metricas.baldeacoes;
      const dw = fastest.metricas.caminhada_m - a.metricas.caminhada_m;
      const parts = [`${dt >= 0 ? "+" : ""}${dt} min em relação à mais rápida`];
      if (db > 0) parts.push(`${db} baldeação(ões) a menos`);
      if (dw > 50) parts.push(`${dw} m a menos de caminhada`);
      if (fastest.metricas.relatos_lotacao > a.metricas.relatos_lotacao) parts.push("evita embarque com relato de superlotação");
      if (fastest.metricas.relatos_ocorrencias > a.metricas.relatos_ocorrencias) parts.push("passa por menos paradas com ocorrências reportadas");
      a.explicacao.motivos.push(`Comparação: ${parts.join("; ")}.`);
    }
  }
  alternativas.sort((a, b) => a.metricas.total_min - b.metricas.total_min);

  return {
    dataset: { versao: net.datasetVersion,
      aviso: net.calendarExpired ? `Horários de um GTFS histórico (vigência até ${net.calendarEnd}). Usamos o padrão semanal programado apenas para demonstração — não reflete a operação de hoje.` : null },
    consulta: { origem: req.origin, destino: req.destination, partida: fmtClock(secs), dia_semana: weekday, modos: req.modes },
    criterios, alternativas,
    sem_resultado: alternativas.length ? undefined : "Nenhum trajeto encontrado para este horário/modos (sem serviço programado ou conexão a pé dentro do limite).",
    compute_ms: Math.round((performance.now() - t) * 10) / 10,
  };
}
