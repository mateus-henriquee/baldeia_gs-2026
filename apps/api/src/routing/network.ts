/**
 * Representação em memória da rede (grafo) construída a partir das tabelas Gold.
 * Nós: paradas/estações. Arestas: (a) trechos de "padrões de viagem" (sequências de
 * paradas de uma linha/sentido) e (b) conexões a pé (stop_transfers).
 */
import type { Db } from "../db/client.js";
import type { Weekday } from "../lib/time.js";

export type Mode = "onibus" | "metro" | "trem" | "outro";

export interface StopNode { id: string; name: string; lat: number; lon: number; kind: "estacao" | "ponto" }
export interface RouteInfo { id: string; shortName: string; longName: string; mode: Mode; color: string; textColor: string }
export interface FrequencyWindow { start: number; end: number; headway: number }
export interface Pattern {
  id: string;
  routeId: string;
  directionId: number;
  headsign: string;
  stops: string[];
  arr: number[];          // segundos relativos à partida na 1ª parada
  dep: number[];
  hopDistance: number[];  // metros do trecho i → i+1
  hopAnomaly: (null | { speedKmh: number })[];
  hopImputed: boolean[];
  serviceIds: Set<string>;
  windows: FrequencyWindow[];   // serviço por frequência (início da viagem na 1ª parada)
  starts: number[];             // serviço por horário fixo (partidas na 1ª parada), ordenado
}
export interface Transfer { to: string; walkSecs: number; distanceM: number }

export interface Network {
  datasetVersion: string;
  calendarExpired: boolean;
  calendarEnd: string | null;
  stops: Map<string, StopNode>;
  routes: Map<string, RouteInfo>;
  patterns: Pattern[];
  byStop: Map<string, { p: number; i: number }[]>;
  transfers: Map<string, Transfer[]>;
  services: Map<string, Set<Weekday>>;
  /** Estações homônimas próximas (ex.: Metrô e CPTM) agrupadas: "estacao:<nome>" → stop_ids. */
  groups: Map<string, { id: string; name: string; lat: number; lon: number; stopIds: string[] }>;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function buildGroups(stops: Map<string, StopNode>): Network["groups"] {
  const groups: Network["groups"] = new Map();
  for (const s of stops.values()) {
    if (s.kind !== "estacao") continue;
    const id = `estacao:${norm(s.name).replace(/[^a-z0-9]+/g, "-")}`;
    const g = groups.get(id);
    // Mesma estação somente se a até ~600 m do primeiro membro (evita homônimos distantes).
    if (g && Math.hypot((g.lat - s.lat) * 111_000, (g.lon - s.lon) * 102_000) < 600) g.stopIds.push(s.id);
    else if (!g) groups.set(id, { id, name: s.name, lat: s.lat, lon: s.lon, stopIds: [s.id] });
  }
  return groups;
}

const DAYS: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export async function loadNetwork(db: Db): Promise<Network> {
  const dv = (await db.query<{ dataset_version_id: string }>(
    "SELECT dataset_version_id FROM dataset_versions WHERE is_active ORDER BY loaded_at DESC LIMIT 1")).rows[0];
  if (!dv) throw new Error("Nenhuma versão de dataset ativa.");

  const stops = new Map<string, StopNode>();
  for (const s of (await db.query<{ stop_id: string; name: string; lat: number; lon: number; kind: "estacao" | "ponto" }>(
    "SELECT stop_id, name, lat, lon, kind FROM stops")).rows) {
    stops.set(s.stop_id, { id: s.stop_id, name: s.name, lat: Number(s.lat), lon: Number(s.lon), kind: s.kind });
  }
  const routes = new Map<string, RouteInfo>();
  for (const r of (await db.query<Record<string, string>>("SELECT * FROM routes")).rows) {
    routes.set(r.route_id, { id: r.route_id, shortName: r.short_name, longName: r.long_name, mode: r.mode as Mode,
      color: `#${r.color}`, textColor: `#${r.text_color}` });
  }
  const services = new Map<string, Set<Weekday>>();
  let calendarExpired = false;
  let calendarEnd: string | null = null;
  for (const c of (await db.query<Record<string, unknown>>("SELECT * FROM calendar_services")).rows) {
    services.set(String(c.service_id), new Set(DAYS.filter((d) => c[d] === true)));
    calendarExpired ||= c.expired === true;
    const end = c.end_date instanceof Date ? c.end_date.toISOString().slice(0, 10) : String(c.end_date).slice(0, 10);
    if (!calendarEnd || end > calendarEnd) calendarEnd = end;
  }

  const trips = (await db.query<{ trip_id: string; route_id: string; service_id: string; direction_id: number; headsign: string | null }>(
    "SELECT trip_id, route_id, service_id, direction_id, headsign FROM trips")).rows;
  const st = (await db.query<{ trip_id: string; stop_sequence: number; stop_id: string; arrival_secs: number; departure_secs: number }>(
    "SELECT trip_id, stop_sequence, stop_id, arrival_secs, departure_secs FROM stop_times ORDER BY trip_id, stop_sequence")).rows;
  const seg = (await db.query<{ trip_id: string; stop_sequence: number; distance_m: string; speed_kmh: string; anomaly: boolean; imputed: boolean }>(
    "SELECT trip_id, stop_sequence, distance_m, speed_kmh, anomaly, imputed FROM route_segments")).rows;
  const freq = (await db.query<{ trip_id: string; start_secs: number; end_secs: number; headway_secs: number }>(
    "SELECT trip_id, start_secs, end_secs, headway_secs FROM frequencies ORDER BY trip_id, start_secs")).rows;

  const stByTrip = new Map<string, typeof st>();
  for (const r of st) (stByTrip.get(r.trip_id) ?? stByTrip.set(r.trip_id, []).get(r.trip_id)!).push(r);
  const segByKey = new Map(seg.map((s) => [`${s.trip_id}|${s.stop_sequence}`, s]));
  const freqByTrip = new Map<string, FrequencyWindow[]>();
  for (const f of freq) (freqByTrip.get(f.trip_id) ?? freqByTrip.set(f.trip_id, []).get(f.trip_id)!)
    .push({ start: f.start_secs, end: f.end_secs, headway: f.headway_secs });

  // Agrupa viagens com a mesma sequência de paradas em um "padrão".
  const patterns: Pattern[] = [];
  const patternByKey = new Map<string, Pattern>();
  for (const t of trips) {
    const times = stByTrip.get(t.trip_id);
    if (!times || times.length < 2) continue;
    const key = `${t.route_id}|${t.direction_id}|${times.map((x) => x.stop_id).join(",")}`;
    const t0 = times[0].departure_secs;
    let p = patternByKey.get(key);
    if (!p) {
      p = {
        id: t.trip_id, routeId: t.route_id, directionId: t.direction_id, headsign: t.headsign ?? "",
        stops: times.map((x) => x.stop_id),
        arr: times.map((x) => x.arrival_secs - t0), dep: times.map((x) => x.departure_secs - t0),
        hopDistance: [], hopAnomaly: [], hopImputed: [],
        serviceIds: new Set(), windows: [], starts: [],
      };
      for (let i = 0; i < times.length - 1; i++) {
        const s = segByKey.get(`${t.trip_id}|${times[i].stop_sequence}`);
        p.hopDistance.push(s ? Number(s.distance_m) : 0);
        p.hopAnomaly.push(s?.anomaly ? { speedKmh: Number(s.speed_kmh) } : null);
        p.hopImputed.push(Boolean(s?.imputed));
      }
      patternByKey.set(key, p);
      patterns.push(p);
    }
    p.serviceIds.add(t.service_id);
    const w = freqByTrip.get(t.trip_id);
    if (w?.length) p.windows.push(...w);
    else p.starts.push(t0);
  }
  for (const p of patterns) p.starts.sort((a, b) => a - b);

  // Garante tempo positivo por trecho usando o tempo (possivelmente imputado) da Gold.
  const travelByKey = new Map((await db.query<{ trip_id: string; stop_sequence: number; travel_secs: number }>(
    "SELECT trip_id, stop_sequence, travel_secs FROM route_segments")).rows.map((r) => [`${r.trip_id}|${r.stop_sequence}`, r.travel_secs]));
  for (const p of patterns) {
    const times = stByTrip.get(p.id)!;
    let clock = 0;
    for (let i = 0; i < times.length; i++) {
      if (i > 0) {
        const travel = travelByKey.get(`${p.id}|${times[i - 1].stop_sequence}`) ?? (p.arr[i] - p.dep[i - 1]);
        clock = p.dep[i - 1] + Math.max(travel, 1);
        const dwell = Math.max(0, p.dep[i] - p.arr[i]);
        p.arr[i] = clock;
        p.dep[i] = clock + dwell;
      }
    }
  }

  const byStop = new Map<string, { p: number; i: number }[]>();
  patterns.forEach((p, pi) => p.stops.forEach((s, i) => {
    if (i === p.stops.length - 1) return;
    (byStop.get(s) ?? byStop.set(s, []).get(s)!).push({ p: pi, i });
  }));

  const transfers = new Map<string, Transfer[]>();
  for (const t of (await db.query<{ from_stop_id: string; to_stop_id: string; walk_secs: number; distance_m: string }>(
    "SELECT from_stop_id, to_stop_id, walk_secs, distance_m FROM stop_transfers")).rows) {
    (transfers.get(t.from_stop_id) ?? transfers.set(t.from_stop_id, []).get(t.from_stop_id)!)
      .push({ to: t.to_stop_id, walkSecs: t.walk_secs, distanceM: Number(t.distance_m) });
  }

  return { datasetVersion: dv.dataset_version_id, calendarExpired, calendarEnd, stops, routes, patterns, byStop, transfers, services,
    groups: buildGroups(stops) };
}

/** Resolve um identificador de local (parada ou grupo de estação) para stop_ids. */
export function resolvePlace(net: Network, id: string): string[] {
  const g = net.groups.get(id);
  if (g) return g.stopIds;
  return net.stops.has(id) ? [id] : [];
}
