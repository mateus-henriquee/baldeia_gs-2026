import { useCallback, useEffect, useState } from "react";
import { PlaceSearch } from "../components/PlaceSearch";
import { TransitMap } from "../components/TransitMap";
import { Empty, PageTitle, Source, Tip } from "../components/ui";
import { api, ApiError, errorText, type Place, type Report } from "../lib/api";
import { useAuth } from "../lib/auth";
import { pct, timeAgo, timeLeft, TRUST_LABEL } from "../lib/format";
import { useNetwork } from "./Dashboard";

interface Meta { tipos_relato: { id: string; rotulo: string; validadeMin: number }[]; demo: boolean }

function NewReport({ meta, onDone }: { meta: Meta; onDone: () => void }) {
  const network = useNetwork();
  const [place, setPlace] = useState<Place | null>(null);
  const [tipo, setTipo] = useState("superlotacao");
  const [routes, setRoutes] = useState<{ id: string; nome: string; stop: string }[]>([]);
  const [route, setRoute] = useState("");
  const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState("");
  const [needConsent, setNeedConsent] = useState(false);

  useEffect(() => {
    setRoutes([]); setRoute("");
    if (!place) return;
    const stops = place.id.startsWith("estacao:") ? network?.estacoes.find((e) => e.id === place.id)?.paradas ?? [] : [place.id];
    Promise.all(stops.map((s) => api<{ linhas: { id: string; nome: string }[] }>(`/public/stops/${encodeURIComponent(s)}/routes`).then((r) => r.linhas.map((l) => ({ ...l, stop: s })))))
      .then((all) => setRoutes(all.flat())).catch(() => {});
  }, [place, network]);

  const stopId = () => {
    if (!place) return null;
    if (route) return routes.find((r) => r.id === route)?.stop ?? null;
    return place.id.startsWith("estacao:") ? network?.estacoes.find((e) => e.id === place.id)?.paradas[0] ?? null : place.id;
  };
  const send = async () => {
    const stop_id = stopId();
    if (!stop_id) { setMsg("Escolha a estação/ponto na lista."); return; }
    try {
      const r = await api<{ dados_pessoais_removidos: number }>("/community/reports", { body: { tipo, stop_id, route_id: route || null, descricao: desc } });
      setMsg(r.dados_pessoais_removidos ? `Publicado. Removemos ${r.dados_pessoais_removidos} dado(s) pessoal(is) do texto.` : "Publicado. Obrigado!");
      setDesc(""); setNeedConsent(false); onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "consentimento_necessario") setNeedConsent(true);
      setMsg(errorText(e));
    }
  };
  const accept = async () => { await api("/me/consents", { method: "PUT", body: { finalidade: "comunidade_publicar", concedido: true } }); setNeedConsent(false); await send(); };
  return (
    <form className="panel planner" onSubmit={(e) => { e.preventDefault(); void send(); }} aria-labelledby="new-t">
      <h2 id="new-t" style={{ fontSize: "1.15rem", margin: 0 }}>Reportar ocorrência</h2>
      <div className="field"><label htmlFor="tipo">O que está acontecendo?</label>
        <select id="tipo" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {meta.tipos_relato.map((t) => <option key={t.id} value={t.id}>{t.rotulo} (expira em {t.validadeMin >= 60 ? `${t.validadeMin / 60} h` : `${t.validadeMin} min`})</option>)}
        </select></div>
      <PlaceSearch label="Onde? (estação ou ponto)" value={place} onChange={setPlace} />
      {routes.length > 0 && <div className="field"><label htmlFor="rt">Linha (opcional)</label>
        <select id="rt" className="input" value={route} onChange={(e) => setRoute(e.target.value)}><option value="">Não sei / todas</option>
          {routes.map((r) => <option key={r.id + r.stop} value={r.id}>{r.nome}</option>)}</select></div>}
      <div className="field"><label htmlFor="ds">Detalhes (opcional)</label>
        <textarea id="ds" className="input" rows={2} maxLength={280} value={desc} onChange={(e) => setDesc(e.target.value)} aria-describedby="ds-h" />
        <span id="ds-h" className="hint">Não inclua nomes, telefones, placas ou fotos de pessoas. Removemos dados pessoais detectados. {desc.length}/280</span></div>
      {needConsent && (
        <div className="notice notice--info small">
          <strong>Regras da comunidade:</strong> relate só o que presenciou; o relato fica associado à parada (não à sua localização), sem seu nome, e expira sozinho. Relatos falsos podem ser removidos e reduzem sua reputação.
          <div style={{ marginTop: 8 }}><button type="button" className="btn btn--small" onClick={accept}>Aceito e quero publicar</button></div>
        </div>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
      <button className="btn">Publicar relato</button>
    </form>
  );
}

function ReportItem({ r, onChange, canVote }: { r: Report; onChange: () => void; canVote: boolean }) {
  const [msg, setMsg] = useState("");
  const act = async (path: string, body: object) => { try { await api(path, { body }); setMsg("Registrado."); onChange(); } catch (e) { setMsg(errorText(e)); } };
  const c = r.confianca;
  return (
    <li className="report">
      <div className="report__top">
        <span className="report__type">{r.tipo_rotulo}</span><span>· {r.local.nome}{r.linha ? ` · ${r.linha.nome}` : ""}</span>
        <Source kind="comunidade" />{r.demo && <Source kind="demo">sintético</Source>}
      </div>
      {r.descricao && <p className="small" style={{ margin: 0 }}>“{r.descricao}”</p>}
      <div className="small muted">{timeAgo(r.criado_em)} · {timeLeft(r.expira_em)} · {c.confirmacoes} confirmação(ões), {c.contestacoes} contestação(ões)</div>
      <div className="small"><strong>{TRUST_LABEL[c.rotulo]}</strong> · confiança {pct(c.confianca)} <Tip text={c.explicacao.join(" · ")} label="Como calculamos a confiança" /></div>
      <div className="report__meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.confianca * 100)} aria-label="Confiança"><span style={{ width: pct(c.confianca) }} /></div>
      {canVote && !r.meu && (
        <div className="report__actions">
          <button className="chip" onClick={() => act(`/community/reports/${r.id}/vote`, { voto: "confirma" })}>Confirmo</button>
          <button className="chip" onClick={() => act(`/community/reports/${r.id}/vote`, { voto: "contesta" })}>Não está acontecendo</button>
          <label className="sr-only" htmlFor={`fl-${r.id}`}>Denunciar</label>
          <select id={`fl-${r.id}`} className="chip" defaultValue="" onChange={(e) => e.target.value && act(`/community/reports/${r.id}/flag`, { motivo: e.target.value })}>
            <option value="" disabled>Denunciar…</option><option value="falso">Falso</option><option value="ofensivo">Ofensivo</option>
            <option value="dados_pessoais">Expõe dados pessoais</option><option value="spam">Spam</option><option value="outro">Outro</option>
          </select>
          {msg && <span className="small muted">{msg}</span>}
        </div>
      )}
      {r.meu && <span className="small muted">Seu relato</span>}
    </li>
  );
}

export default function Community() {
  const network = useNetwork();
  const { user } = useAuth();
  const [list, setList] = useState<Report[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filter, setFilter] = useState("todos");
  const load = useCallback(() => { api<{ relatos: Report[] }>("/community/reports").then((r) => setList(r.relatos)).catch(() => {}); }, []);
  useEffect(() => { load(); api<Meta>("/public/meta").then(setMeta).catch(() => {}); }, [load]);
  const shown = filter === "todos" ? list : list.filter((r) => r.tipo === filter);
  const refreshDemo = async () => { await api("/community/demo/refresh", { body: {} }).catch(() => {}); load(); };
  return (
    <>
      <PageTitle title="Comunidade">{meta?.demo && <button className="btn btn--small btn--ghost" onClick={refreshDemo}>Gerar relatos de demonstração</button>}</PageTitle>
      <p className="notice small">Relatos comunitários <strong>não são verificados</strong> por fontes oficiais. Confirmações aumentam a confiança com retorno decrescente e teto de 85%; contestações reduzem. Ausência de relatos não significa ausência de problemas.</p>
      <div className="dash" style={{ marginTop: 16 }}>
        <div className="dash__left">
          {meta && <NewReport meta={meta} onDone={load} />}
          <div className="chips" role="group" aria-label="Filtrar por tipo">
            <button className="chip" aria-pressed={filter === "todos"} onClick={() => setFilter("todos")}>Todos ({list.length})</button>
            {meta?.tipos_relato.filter((t) => list.some((r) => r.tipo === t.id)).map((t) => (
              <button key={t.id} className="chip" aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>{t.rotulo}</button>))}
          </div>
          {shown.length ? <ul className="list">{shown.map((r) => <ReportItem key={r.id} r={r} onChange={load} canVote={Boolean(user)} />)}</ul>
            : <Empty title="Nenhum relato ativo.">Os relatos expiram automaticamente.</Empty>}
        </div>
        <div className="dash__right"><TransitMap network={network} reports={shown} height="min(70vh, 620px)" /></div>
      </div>
    </>
  );
}
