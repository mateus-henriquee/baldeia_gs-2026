import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TransitMap } from "../components/TransitMap";
import { Empty, PageTitle, Source } from "../components/ui";
import { api } from "../lib/api";
import { distanceM, loadTrip, saveTrip, tripStops, type CurrentTrip } from "../lib/trip";
import { useNetwork } from "./Dashboard";

const GPS_MATCH_M = 150;

export default function Navigate() {
  const network = useNetwork();
  const [trip, setTrip] = useState<CurrentTrip | null>(loadTrip());
  const [online, setOnline] = useState(navigator.onLine);
  const [gps, setGps] = useState<"off" | "on" | "negado" | "indisponivel">("off");
  const [gpsInfo, setGpsInfo] = useState("");
  const watch = useRef<number | null>(null);
  const stops = useMemo(() => (trip ? tripStops(trip.alt) : []), [trip]);
  const nextIdx = trip ? Math.min(stops.length - 1, trip.confirmed.length) : 0;
  const next = stops[nextIdx];
  const done = trip && trip.confirmed.length >= stops.length;

  const update = (t: CurrentTrip | null) => { setTrip(t); saveTrip(t); };

  const sync = async (t: CurrentTrip) => {
    if (!t.journeyId || !t.pendingSync.length || !navigator.onLine) return;
    const left: string[] = [];
    for (const s of t.pendingSync) {
      const [stop, metodo] = s.split("|");
      await api(`/me/journeys/${t.journeyId}/checkpoints`, { body: { stop_id: stop, metodo } }).catch(() => left.push(s));
    }
    update({ ...t, pendingSync: left });
  };
  useEffect(() => {
    const on = () => { setOnline(true); const t = loadTrip(); if (t) void sync(t); };
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = (method: "manual" | "gps") => {
    if (!trip || !next) return;
    const t = { ...trip, confirmed: [...trip.confirmed, next.id], pendingSync: trip.journeyId ? [...trip.pendingSync, `${next.id}|${method}`] : [] };
    update(t);
    void sync(t);
    if (t.confirmed.length >= stops.length && t.journeyId) void api(`/me/journeys/${t.journeyId}`, { method: "PATCH", body: { status: "concluida" } }).catch(() => {});
  };
  const undo = () => { if (trip?.confirmed.length) update({ ...trip, confirmed: trip.confirmed.slice(0, -1) }); };

  // GPS: compara a posição com as próximas paradas NO APARELHO; nada é enviado.
  useEffect(() => () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); }, []);
  const toggleGps = async () => {
    if (gps === "on") { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); watch.current = null; setGps("off"); return; }
    if (!("geolocation" in navigator)) { setGps("indisponivel"); return; }
    await api("/me/consents", { method: "PUT", body: { finalidade: "geolocalizacao", concedido: true } }).catch(() => {});
    watch.current = navigator.geolocation.watchPosition((pos) => {
      setGps("on");
      const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const t = loadTrip();
      if (!t) return;
      const list = tripStops(t.alt);
      const idx = t.confirmed.length;
      const near = list.slice(idx, idx + 3).findIndex((s) => distanceM(here, s) <= GPS_MATCH_M);
      const nearest = Math.min(...list.map((s) => distanceM(here, s)));
      setGpsInfo(near >= 0 ? `Você está perto de ${list[idx + near].nome}.` : `Parada mais próxima do trajeto a ${(nearest / 1000).toFixed(1)} km — longe da rede de amostra? Use o modo manual.`);
      if (near >= 0) {
        const confirmed = [...t.confirmed, ...list.slice(idx, idx + near + 1).map((s) => s.id)];
        const nt = { ...t, confirmed, pendingSync: t.journeyId ? [...t.pendingSync, ...list.slice(idx, idx + near + 1).map((s) => `${s.id}|gps`)] : [] };
        setTrip(nt); saveTrip(nt); void sync(nt);
      }
    }, (e) => { setGps(e.code === 1 ? "negado" : "indisponivel"); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  };

  if (!trip) return (<><PageTitle title="Navegação" /><Empty title="Nenhuma viagem em andamento.">Planeje um trajeto e toque em “Iniciar navegação”. <Link to="/app">Planejar</Link></Empty></>);

  const leg = next ? trip.alt.pernas[next.legIndex] : null;
  return (
    <>
      <PageTitle title={`${trip.origem} → ${trip.destino}`}>
        <span className="chips">
          <span className={`src ${online ? "src--oficial" : "src--demo"}`}>{online ? "online" : "offline — instruções salvas no aparelho"}</span>
          {trip.journeyId ? <Source kind="estimado">salvo no histórico</Source> : <Source kind="demo">só no aparelho</Source>}
        </span>
      </PageTitle>
      <div className="dash">
        <div className="dash__left">
          {done ? (
            <div className="nav-now"><span>Viagem concluída</span><span className="nav-now__big">Você chegou a {trip.destino}.</span>
              <button className="btn btn--signal" onClick={() => update(null)}>Encerrar</button></div>
          ) : next && (
            <div className="nav-now" aria-live="assertive">
              <span className="small">Próxima instrução · previsto {next.chegada}</span>
              <span className="nav-now__big">{next.acao} {next.nome}</span>
              {leg?.linha && <span><span className="line-pill" style={{ background: leg.linha.cor, color: leg.linha.cor_texto }}>{leg.linha.nome}</span> sentido {leg.linha.sentido}</span>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button className="btn btn--signal" onClick={() => confirm("manual")}>Cheguei / passei aqui ✓</button>
                {trip.confirmed.length > 0 && <button className="btn btn--ghost" style={{ borderColor: "#4a505b", color: "#fff" }} onClick={undo}>Desfazer</button>}
              </div>
            </div>
          )}
          <section className="panel">
            <div className="app-head" style={{ marginBottom: 6 }}><h2 style={{ fontSize: "1.1rem", margin: 0 }}>Acompanhamento</h2>
              <button className="btn btn--small btn--ghost" onClick={toggleGps} aria-pressed={gps === "on"}>{gps === "on" ? "Desligar GPS" : "Usar GPS"}</button></div>
            <p className="small muted">Sem sinal? Confirme cada parada manualmente — as próximas instruções se atualizam mesmo offline. Com GPS, a posição é comparada às paradas <strong>no seu aparelho</strong> e não é enviada.</p>
            {gps === "negado" && <p className="error small">Permissão de localização negada. Continue no modo manual.</p>}
            {gps === "indisponivel" && <p className="error small">Localização indisponível neste dispositivo.</p>}
            {gpsInfo && <p className="small">{gpsInfo}</p>}
            <ol className="nav-stops">
              {stops.map((s, i) => (
                <li key={`${s.id}-${i}`} className={i < trip.confirmed.length ? "is-done" : i === nextIdx ? "is-next" : ""}>
                  <span className="nav-dot" aria-hidden="true" />
                  <span>{s.acao} {s.nome}<span className="sr-only">{i < trip.confirmed.length ? " (confirmada)" : ""}</span></span>
                  <span className="small muted">{s.chegada}</span>
                </li>
              ))}
            </ol>
          </section>
          <div className="photo-ph">Fotografias de referência das estações: nenhuma fonte com direito de uso adequado foi integrada. Previsto: acervo próprio ou imagens com licença aberta, com crédito.</div>
          <button className="link-btn small" onClick={() => update(null)}>Cancelar viagem</button>
        </div>
        <div className="dash__right"><TransitMap network={network} route={trip.alt} height="min(70vh, 620px)" /></div>
      </div>
    </>
  );
}
