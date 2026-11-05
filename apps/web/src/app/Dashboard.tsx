import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PlaceSearch } from "../components/PlaceSearch";
import { RouteResults } from "../components/RouteResults";
import { TransitMap, type NetworkData } from "../components/TransitMap";
import { PageTitle, Source } from "../components/ui";
import { api, errorText, type Alternative, type Mode, type Place, type PlanResult, type Report } from "../lib/api";
import { localInputToIso, MODE_LABEL, nowLocalInput, timeAgo, TRUST_LABEL } from "../lib/format";
import { saveTrip } from "../lib/trip";

export interface Favorite { id: string; rotulo: string; nome: string; local: { id: string; nome: string; lat: number; lon: number } }
export const favToPlace = (f: Favorite): Place => ({ id: f.local.id, nome: f.local.nome, tipo: f.local.id.startsWith("estacao:") ? "estacao" : "ponto", lat: f.local.lat, lon: f.local.lon, modos: [] });

let networkCache: NetworkData | null = null;
export function useNetwork() {
  const [n, setN] = useState<NetworkData | null>(networkCache);
  useEffect(() => { if (!networkCache) api<NetworkData>("/public/network").then((d) => { networkCache = d; setN(d); }).catch(() => {}); }, []);
  return n;
}

export default function Dashboard() {
  const network = useNetwork();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [o, setO] = useState<Place | null>(null);
  const [d, setD] = useState<Place | null>(null);
  const [when, setWhen] = useState(nowLocalInput());
  const [modes, setModes] = useState<Mode[]>(["onibus", "metro", "trem"]);
  const [res, setRes] = useState<PlanResult | null>(null);
  const [sel, setSel] = useState<Alternative | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [favs, setFavs] = useState<Favorite[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ relatos: Report[] }>("/community/reports").then((r) => setReports(r.relatos)).catch(() => {});
    api<{ favoritos: Favorite[] }>("/me/favorites").then((r) => {
      setFavs(r.favoritos);
      const to = params.get("destino");
      const f = r.favoritos.find((x) => x.id === to);
      if (f) setD(favToPlace(f));
    }).catch(() => {});
  }, [params]);

  const plan = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!o || !d) { setErr("Escolha origem e destino a partir da lista de sugestões."); return; }
    setBusy(true); setErr(""); setSel(null);
    try {
      const r = await api<PlanResult>("/plan", { body: { origem: o.id, destino: d.id, partida: localInputToIso(when), modos: modes } });
      setRes(r); setSel(r.alternativas[0] ?? null);
    } catch (x) { setErr(errorText(x)); }
    setBusy(false);
  };

  const start = async (alt: Alternative) => {
    let journeyId: string | null = null;
    if (res?.recomendacao_id) {
      const r = await api<{ salvo: boolean; id?: string }>("/me/journeys", { body: { recomendacao_id: res.recomendacao_id, alternativa_id: alt.id, partida: localInputToIso(when) } }).catch(() => null);
      journeyId = r?.id ?? null;
    }
    saveTrip({ alt, origem: o!.nome, destino: d!.nome, iniciada_em: new Date().toISOString(), journeyId, confirmed: [], pendingSync: [], demo: true });
    nav("/app/navegacao");
  };

  const onStation = useCallback((id: string, nome: string) => {
    const p: Place = { id, nome, tipo: "estacao", lat: 0, lon: 0, modos: [] };
    setO((cur) => { if (!cur) return p; setD(p); return cur; });
  }, []);
  const quick = favs.map((f) => ({ label: `★ ${f.nome}`, place: favToPlace(f) }));

  return (
    <>
      <PageTitle title="Planejar trajeto"><Source kind="demo">rede de amostra · horários históricos</Source></PageTitle>
      <div className="dash">
        <div className="dash__left">
          <form className="panel planner" onSubmit={plan} aria-label="Planejar trajeto">
            <PlaceSearch label="De onde?" value={o} onChange={setO} quick={quick} />
            <button type="button" className="link-btn small swap" onClick={() => { setO(d); setD(o); }}>⇅ Inverter</button>
            <PlaceSearch label="Para onde?" value={d} onChange={setD} quick={quick} />
            <div className="field"><label htmlFor="when">Saída</label><input id="when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              <span className="hint">Usa o padrão semanal programado do GTFS para o dia escolhido.</span></div>
            <div className="field"><span className="label" id="modes-l">Modos</span>
              <div className="chips" role="group" aria-labelledby="modes-l">
                {(["onibus", "metro", "trem"] as Mode[]).map((m) => (
                  <button key={m} type="button" className="chip" aria-pressed={modes.includes(m)}
                    onClick={() => setModes((cur) => cur.includes(m) ? (cur.length > 1 ? cur.filter((x) => x !== m) : cur) : [...cur, m])}>{MODE_LABEL[m]}</button>
                ))}
              </div></div>
            {err && <p className="error" role="alert">{err}</p>}
            <button className="btn" disabled={busy}>{busy ? "Calculando…" : "Comparar rotas"}</button>
            <p className="small muted" style={{ margin: 0 }}>Dica: clique em estações no mapa para preencher origem e destino.</p>
          </form>
          {res && <RouteResults result={res} onStart={start} />}
          {res && res.alternativas.length > 1 && (
            <div className="chips" aria-label="Mostrar no mapa">{res.alternativas.map((a, i) => (
              <button key={a.id} className="chip" aria-pressed={sel?.id === a.id} onClick={() => setSel(a)}>Mapa: opção {i + 1}</button>))}</div>
          )}
        </div>
        <div className="dash__right">
          <TransitMap network={network} reports={reports} route={sel} onStationClick={onStation} height="min(62vh, 560px)" />
          <section className="panel" aria-labelledby="alerts-t">
            <div className="app-head" style={{ marginBottom: 8 }}><h2 id="alerts-t" style={{ fontSize: "1.15rem", margin: 0 }}>Alertas agora</h2><Link to="/app/comunidade" className="small">Ver todos</Link></div>
            <p className="small muted">Oficiais: nenhuma fonte integrada. Abaixo, relatos da <Source kind="comunidade" />.</p>
            <ul className="list">{reports.slice(0, 4).map((r) => (
              <li key={r.id} className="small"><strong>{r.tipo_rotulo}</strong> — {r.local.nome} · {timeAgo(r.criado_em)} · {TRUST_LABEL[r.confianca.rotulo]} {r.demo && <Source kind="demo">sintético</Source>}</li>
            ))}{!reports.length && <li className="small muted">Nenhum relato ativo.</li>}</ul>
          </section>
        </div>
      </div>
    </>
  );
}
