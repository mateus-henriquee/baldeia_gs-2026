/**
 * Viagem em andamento guardada NO APARELHO (localStorage), para funcionar sem internet.
 * Coordenadas de GPS nunca são gravadas — apenas o índice da parada confirmada.
 */
import type { Alternative } from "./api";

export interface CurrentTrip {
  alt: Alternative; origem: string; destino: string; iniciada_em: string;
  journeyId: string | null; confirmed: string[]; pendingSync: string[]; demo: boolean;
}
const KEY = "baldeia:viagem-atual";

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
export const loadTrip = (): CurrentTrip | null => safe(() => JSON.parse(localStorage.getItem(KEY) ?? "null"), null);
export const saveTrip = (t: CurrentTrip | null) => safe(() => (t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY)), undefined);

/** Sequência linear de paradas da viagem (com a etapa a que pertencem). */
export function tripStops(alt: Alternative) {
  const out: { id: string; nome: string; lat: number; lon: number; legIndex: number; chegada: string; acao: string }[] = [];
  alt.pernas.forEach((leg, li) => {
    const stops = leg.paradas ?? [{ ...leg.de, chegada: leg.partida }, { ...leg.para, chegada: leg.chegada }];
    stops.forEach((s, si) => {
      if (out.length && out[out.length - 1].id === s.id) return;
      let acao = "Passar por";
      if (si === 0) acao = leg.tipo === "caminhada" ? "Começar a caminhar em" : `Embarcar na linha ${leg.linha?.nome} em`;
      else if (si === stops.length - 1) acao = li === alt.pernas.length - 1 ? "Chegada em" : leg.tipo === "caminhada" ? "Chegar a pé em" : "Desembarcar em";
      out.push({ id: s.id, nome: s.nome, lat: s.lat, lon: s.lon, legIndex: li, chegada: "chegada" in s ? s.chegada : leg.chegada, acao });
    });
  });
  return out;
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
