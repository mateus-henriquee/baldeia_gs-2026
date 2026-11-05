import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PlaceSearch } from "../components/PlaceSearch";
import { Bars, Empty, PageTitle, Source } from "../components/ui";
import { api, errorText, type Place, type Report } from "../lib/api";
import { useAuth } from "../lib/auth";
import { MODE_LABEL, TRUST_LABEL } from "../lib/format";
import type { Favorite } from "./Dashboard";

const LABELS = ["casa", "trabalho", "faculdade", "escola", "outro"] as const;
const LABEL_TXT: Record<string, string> = { casa: "Casa", trabalho: "Trabalho", faculdade: "Faculdade", escola: "Escola", outro: "Outro" };

// ------------------------------------------------------------ favoritos
export function Favorites() {
  const nav = useNavigate();
  const [list, setList] = useState<Favorite[]>([]);
  const [rotulo, setRotulo] = useState<(typeof LABELS)[number]>("casa");
  const [nome, setNome] = useState("Casa");
  const [place, setPlace] = useState<Place | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => { api<{ favoritos: Favorite[] }>("/me/favorites").then((r) => setList(r.favoritos)).catch(() => {}); }, []);
  useEffect(load, [load]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!place) { setMsg("Escolha a estação ou ponto mais próximo na lista."); return; }
    try { await api("/me/favorites", { body: { rotulo, nome, local_id: place.id } }); setMsg("Salvo."); setPlace(null); load(); } catch (x) { setMsg(errorText(x)); }
  };
  return (
    <>
      <PageTitle title="Destinos favoritos" />
      <div className="grid-2">
        <form className="panel planner" onSubmit={add}>
          <div className="field"><span className="label" id="lbl">Tipo</span>
            <div className="chips" role="group" aria-labelledby="lbl">{LABELS.map((l) => (
              <button key={l} type="button" className="chip" aria-pressed={rotulo === l} onClick={() => { setRotulo(l); setNome(LABEL_TXT[l]); }}>{LABEL_TXT[l]}</button>))}</div></div>
          <div className="field"><label htmlFor="fn">Nome</label><input id="fn" className="input" maxLength={40} value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <PlaceSearch label="Estação ou ponto de referência" value={place} onChange={setPlace} />
          <p className="hint">Por privacidade, guardamos a estação/ponto — nunca o seu endereço.</p>
          {msg && <p className="small" role="status">{msg}</p>}
          <button className="btn">Salvar favorito</button>
        </form>
        <section>
          {list.length ? <ul className="list">{list.map((f) => (
            <li key={f.id} className="report">
              <div className="report__top"><span className="alt__tag">{LABEL_TXT[f.rotulo]}</span><strong>{f.nome}</strong><span className="muted small">{f.local.nome}</span></div>
              <div className="report__actions">
                <button className="btn btn--small" onClick={() => nav(`/app?destino=${f.id}`)}>Ir para cá</button>
                <button className="chip" onClick={async () => { await api(`/me/favorites/${f.id}`, { method: "DELETE" }); load(); }}>Remover</button>
              </div>
            </li>))}</ul> : <Empty title="Nenhum favorito ainda.">Salve casa, trabalho ou faculdade para buscar com um toque.</Empty>}
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------ histórico
interface Journey { id: string; origem: string; destino: string; partida: string; perfil: string; status: string; duracao_min: number; baldeacoes: number; demo: boolean }
export function History() {
  const [d, setD] = useState<{ historico_ativo: boolean; viagens: Journey[] } | null>(null);
  useEffect(() => { api<typeof d>("/me/journeys").then(setD).catch(() => {}); }, []);
  return (
    <>
      <PageTitle title="Histórico de viagens" />
      {d && !d.historico_ativo && <p className="notice">O histórico está desativado. As viagens ficam só no seu aparelho. Ative em <Link to="/app/privacidade">Privacidade</Link>.</p>}
      {d?.viagens.length ? (
        <div className="panel" style={{ overflowX: "auto" }}><table className="table"><thead><tr><th>Data</th><th>Trajeto</th><th>Duração</th><th>Baldeações</th><th>Status</th></tr></thead>
          <tbody>{d.viagens.map((j) => <tr key={j.id}><td>{new Date(j.partida).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
            <td>{j.origem} → {j.destino} {j.demo && <Source kind="demo">sintético</Source>}</td><td>{j.duracao_min} min</td><td>{j.baldeacoes}</td><td>{j.status.replace("_", " ")}</td></tr>)}</tbody></table>
          <p className="small muted">Viagens com mais de 180 dias são excluídas automaticamente.</p></div>
      ) : d && <Empty title="Nenhuma viagem salva." />}
    </>
  );
}

// ------------------------------------------------------------ relatórios (hábitos + rede)
interface Habits {
  disponivel: boolean; motivo?: string; inclui_dados_demo?: boolean; metodo?: string;
  destinos?: { destino: string; viagens: number; saida_habitual: string; faixa_central: string }[];
  por_dia?: { dia: string; viagens: number; duracao_media_min: number | null }[];
  duracao?: { media_min: number; desvio_padrao_min: number; min: number; max: number; n: number };
  movimento_reportado?: { por_hora: { hour: number; reports: number; reporters: number; demo: boolean }[]; aviso: string };
  sugestoes?: { texto: string; evidencia: string; demo: boolean }[];
  lugares_para_aguardar?: { disponivel: boolean; motivo: string };
}
export function Reports() {
  const [h, setH] = useState<Habits | null>(null);
  const [an, setAn] = useState<{ oferta: { oferta_por_hora: { por_modo: Record<string, { horas: { hora: number; linhas_sentido: number; intervalo_mediano_min: number }[] }> } };
    comunidade: { aviso: string; inclui_sinteticos: boolean; por_hora: { type: string; hour: number; reports: number }[] } } | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => { api<Habits>("/me/habits").then(setH).catch(() => {}); }, []);
  useEffect(() => { load(); api<typeof an>("/public/analytics").then(setAn).catch(() => {}); }, [load]);
  const demoHistory = async () => {
    try { const r = await api<{ criadas: number }>("/me/demo-history", { body: {} }); setMsg(`${r.criadas} viagens sintéticas criadas.`); load(); } catch (e) { setMsg(errorText(e)); }
  };
  const byHour = (() => {
    const m = new Map<number, number>();
    for (const r of an?.comunidade.por_hora ?? []) if (r.type === "superlotacao") m.set(r.hour, (m.get(r.hour) ?? 0) + r.reports);
    return Array.from({ length: 19 }, (_, i) => i + 5).map((hr) => ({ x: `${hr}h`, y: m.get(hr) ?? 0 }));
  })();
  return (
    <>
      <PageTitle title="Relatórios" />
      <section className="panel" aria-labelledby="hab-t">
        <div className="app-head"><h2 id="hab-t" style={{ fontSize: "1.3rem", margin: 0 }}>Seus hábitos</h2>{h?.inclui_dados_demo && <Source kind="demo">inclui viagens sintéticas</Source>}</div>
        {h && !h.disponivel && <>
          <p className="notice">{h.motivo}</p>
          <p className="small">Para demonstrar a análise, gere um histórico sintético (rotulado) — requer o histórico ativado. <button className="btn btn--small" onClick={demoHistory}>Gerar histórico de demonstração</button></p>
          {msg && <p className="small">{msg}</p>}
        </>}
        {h?.disponivel && <>
          <p className="small muted">{h.metodo}</p>
          {h.sugestoes?.map((s) => <div key={s.texto} className="notice notice--info" style={{ margin: "0.75rem 0" }}><strong>{s.texto}</strong><br /><span className="small">{s.evidencia}</span> {s.demo && <Source kind="demo">dados sintéticos</Source>}</div>)}
          {!h.sugestoes?.length && <p className="small">Sem sugestão de horário: os dados disponíveis não mostram diferença relevante de movimento reportado perto do seu horário habitual.</p>}
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div><h3>Horários habituais</h3>
              <table className="table"><thead><tr><th>Destino</th><th>Viagens</th><th>Saída típica</th><th>Faixa central</th></tr></thead>
                <tbody>{h.destinos?.map((x) => <tr key={x.destino}><td>{x.destino}</td><td>{x.viagens}</td><td><strong>{x.saida_habitual}</strong></td><td>{x.faixa_central}</td></tr>)}</tbody></table>
              {h.duracao && <p className="small" style={{ marginTop: 12 }}>Duração planejada: média <strong>{h.duracao.media_min} min</strong>, desvio-padrão {h.duracao.desvio_padrao_min} min (mín. {h.duracao.min}, máx. {h.duracao.max}; n = {h.duracao.n}).</p>}
            </div>
            <div><h3>Viagens por dia da semana</h3>
              <Bars data={(h.por_dia ?? []).map((x) => ({ x: x.dia.slice(0, 3), y: x.viagens }))} label="Viagens por dia da semana" />
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>Lugares para aguardar: {h.lugares_para_aguardar?.motivo}</p>
        </>}
      </section>
      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel">
          <h2 style={{ fontSize: "1.15rem" }}>Superlotação reportada por hora <Source kind="comunidade" /> {an?.comunidade.inclui_sinteticos && <Source kind="demo">inclui sintéticos</Source>}</h2>
          <Bars data={byHour} label="Relatos de superlotação por hora do dia" unit=" relatos" />
          <p className="small muted">{an?.comunidade.aviso} Relatos indicam percepção, não medem lotação.</p>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: "1.15rem" }}>Intervalo mediano programado por hora (min) <Source kind="oficial">GTFS programado</Source></h2>
          {an && Object.entries(an.oferta.oferta_por_hora.por_modo).map(([mode, v]) => (
            <div key={mode} style={{ marginBottom: 12 }}><strong className="small">{MODE_LABEL[mode]}</strong>
              <Bars data={v.horas.map((x) => ({ x: `${x.hora}h`, y: x.intervalo_mediano_min }))} label={`Intervalo mediano programado de ${MODE_LABEL[mode]} por hora`} unit=" min" /></div>
          ))}
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------ privacidade
interface Consent { finalidade_id: string; titulo: string; finalidade: string; base_legal: string; retencao: string; concedido: boolean; atualizado_em: string | null }
export function Privacy() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [c, setC] = useState<Consent[]>([]);
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { api<{ finalidades: Consent[] }>("/me/consents").then((r) => setC(r.finalidades)).catch(() => {}); }, []);
  const toggle = async (id: string, v: boolean) => {
    if (!v && id === "historico_viagens" && !window.confirm("Desativar o histórico apaga todas as viagens salvas. Continuar?")) return;
    const r = await api<{ finalidades: Consent[] }>("/me/consents", { method: "PUT", body: { finalidade: id, concedido: v } });
    setC(r.finalidades);
  };
  const del = async () => {
    try { await api("/me", { method: "DELETE", body: { confirmacao: confirm } }); await refresh(); nav("/"); } catch (e) { setMsg(errorText(e)); }
  };
  return (
    <>
      <PageTitle title="Privacidade e meus dados" />
      <section className="panel">
        <h2 style={{ fontSize: "1.2rem" }}>Consentimentos por finalidade</h2>
        <ul className="list">{c.map((x) => (
          <li key={x.finalidade_id} className="report">
            <label className="check" style={{ fontSize: "1rem" }}><input type="checkbox" checked={x.concedido} onChange={(e) => toggle(x.finalidade_id, e.target.checked)} /><strong>{x.titulo}</strong></label>
            <span className="small">{x.finalidade}</span>
            <span className="small muted">Base legal: {x.base_legal} · Retenção: {x.retencao}{x.atualizado_em ? ` · atualizado ${new Date(x.atualizado_em).toLocaleString("pt-BR")}` : ""}</span>
          </li>))}</ul>
      </section>
      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel">
          <h2 style={{ fontSize: "1.2rem" }}>Baixar meus dados</h2>
          <p className="small">Cópia completa (JSON): conta, preferências, consentimentos, favoritos, viagens, relatos, votos e registros de auditoria.</p>
          <a className="btn" href="/api/me/export" download>Baixar JSON</a>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: "1.2rem" }}>Excluir conta</h2>
          <p className="small">Apaga conta, viagens, favoritos, consentimentos e votos. Seus relatos permanecem sem autoria, para não distorcer alertas já confirmados.</p>
          <div className="field"><label htmlFor="cf">Digite EXCLUIR para confirmar</label><input id="cf" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          {msg && <p className="error">{msg}</p>}
          <button className="btn btn--danger" disabled={confirm !== "EXCLUIR"} onClick={del} style={{ marginTop: 10 }}>Excluir definitivamente</button>
        </section>
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>Leia a <Link to="/privacidade">política de privacidade</Link>. Tudo isto segue princípios da LGPD, sem constituir certificação jurídica.</p>
    </>
  );
}

// ------------------------------------------------------------ moderação
export function Moderation() {
  const [q, setQ] = useState<(Report & { motivos: { reason: string; n: number }[] })[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const load = useCallback(() => { api<{ fila: typeof q }>("/community/moderation/queue").then((r) => setQ(r.fila)).catch((e) => setErr(errorText(e))); }, []);
  useEffect(load, [load]);
  const act = async (id: string, acao: "restaurar" | "remover") => {
    try { await api(`/community/moderation/reports/${id}`, { body: { acao, nota: notes[id] ?? "" } }); load(); } catch (e) { setErr(errorText(e)); }
  };
  return (
    <>
      <PageTitle title="Fila de moderação" />
      {err && <p className="error">{err}</p>}
      <p className="small muted">Relatos com denúncias. Três denúncias ocultam automaticamente até revisão humana. Toda decisão exige justificativa e fica na auditoria.</p>
      {q.length ? <ul className="list">{q.map((r) => (
        <li key={r.id} className="report">
          <div className="report__top"><strong>{r.tipo_rotulo}</strong> · {r.local.nome} <span className="alt__tag">{r.status.replace("_", " ")}</span>{r.demo && <Source kind="demo">sintético</Source>}</div>
          {r.descricao && <p className="small" style={{ margin: 0 }}>“{r.descricao}”</p>}
          <span className="small">Denúncias: {r.motivos.map((m) => `${m.reason} (${m.n})`).join(", ") || "—"} · {TRUST_LABEL[r.confianca.rotulo]}</span>
          <input className="input" placeholder="Justificativa (obrigatória)" value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} aria-label="Justificativa" />
          <div className="report__actions"><button className="btn btn--small" onClick={() => act(r.id, "restaurar")}>Restaurar</button><button className="btn btn--small btn--danger" onClick={() => act(r.id, "remover")}>Remover</button></div>
        </li>))}</ul> : <Empty title="Fila vazia." />}
    </>
  );
}
