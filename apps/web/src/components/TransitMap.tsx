import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Alternative, Report } from "../lib/api";

export interface NetworkData {
  linhas: { id: string; nome: string; modo: string; cor: string }[];
  estacoes: { id: string; nome: string; lat: number; lon: number; paradas: string[] }[];
  pontos: { id: string; nome: string; lat: number; lon: number }[];
  tracados: { type: "FeatureCollection"; features: GeoJSON.Feature[] };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// URL configurável (política de uso de tiles do OSM: em produção, use provedor próprio/comercial).
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL) · Rede: GTFS SPTrans (amostra histórica)';

export function TransitMap({ network, reports = [], route, onStationClick, height = 460 }: {
  network: NetworkData | null; reports?: Report[]; route?: Alternative | null; onStationClick?: (id: string, nome: string) => void; height?: number | string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ base?: L.LayerGroup; reports?: L.LayerGroup; route?: L.LayerGroup }>({});

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([-23.55, -46.63], 12);
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: ATTRIBUTION, referrerPolicy: "strict-origin-when-cross-origin" } as L.TileLayerOptions).addTo(map.current);
    map.current.on("focus", () => map.current?.scrollWheelZoom.enable());
    map.current.on("blur", () => map.current?.scrollWheelZoom.disable());
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !network) return;
    layers.current.base?.remove();
    const g = L.layerGroup();
    L.geoJSON(network.tracados as GeoJSON.FeatureCollection, {
      style: (f) => ({ color: (f?.properties as { color: string }).color, weight: (f?.properties as { mode: string }).mode === "onibus" ? 2.5 : 4.5, opacity: 0.75 }),
    }).addTo(g);
    for (const s of network.estacoes) {
      L.circleMarker([s.lat, s.lon], { radius: 4.5, color: "#101418", weight: 2, fillColor: "#fff", fillOpacity: 1 })
        .bindTooltip(s.nome).on("click", () => onStationClick?.(s.id, s.nome)).addTo(g);
    }
    g.addTo(m);
    layers.current.base = g;
  }, [network, onStationClick]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layers.current.reports?.remove();
    const g = L.layerGroup();
    for (const r of reports) {
      const icon = L.divIcon({ className: "", html: `<span class="map-report ${r.demo ? "is-demo" : ""}" style="opacity:${0.45 + r.confianca.confianca * 0.55}">!</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
      L.marker([r.local.lat, r.local.lon], { icon, keyboard: true, title: `${r.tipo_rotulo} — ${r.local.nome}` })
        .bindPopup(`<strong>${esc(r.tipo_rotulo)}</strong> · ${esc(r.local.nome)}<br><small>Comunidade${r.demo ? " · DEMONSTRAÇÃO (sintético)" : ""} · confiança ${Math.round(r.confianca.confianca * 100)}%</small>`)
        .addTo(g);
    }
    g.addTo(m);
    layers.current.reports = g;
  }, [reports]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layers.current.route?.remove();
    if (!route) return;
    const g = L.layerGroup();
    const all: L.LatLngExpression[] = [];
    for (const leg of route.pernas) {
      const pts: L.LatLngExpression[] = (leg.paradas ?? [leg.de, leg.para]).map((p) => [p.lat, p.lon]);
      all.push(...pts);
      L.polyline(pts, { color: "#101418", weight: 10, opacity: 0.9 }).addTo(g);
      L.polyline(pts, { color: leg.linha?.cor ?? "#ff4d2e", weight: 6, dashArray: leg.tipo === "caminhada" ? "2 8" : undefined }).addTo(g);
    }
    const first = route.pernas[0].de, last = route.pernas[route.pernas.length - 1].para;
    L.circleMarker([first.lat, first.lon], { radius: 9, color: "#101418", weight: 3, fillColor: "#fff", fillOpacity: 1 }).bindTooltip("Partida").addTo(g);
    L.circleMarker([last.lat, last.lon], { radius: 9, color: "#101418", weight: 3, fillColor: "#ff4d2e", fillOpacity: 1 }).bindTooltip("Chegada").addTo(g);
    g.addTo(m);
    layers.current.route = g;
    if (all.length) m.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  }, [route]);

  return <div ref={el} className="map" style={{ height }} role="region" aria-label="Mapa da rede de transporte (amostra) com relatos e trajeto selecionado" tabIndex={0} />;
}
