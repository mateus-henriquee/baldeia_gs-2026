import { useState } from "react";
import { api, type Alternative, type Leg, type PlanResult } from "../lib/api";
import { MODE_LABEL } from "../lib/format";
import { Source, Tip } from "./ui";

const CRIT_LABEL: Record<string, string> = {
  tempo: "Tempo", baldeacoes: "Baldeações", caminhada: "Caminhada", lotacao: "Lotação",
  ocorrencias: "Ocorrências", seguranca: "Segurança", tempo_real: "Tempo real",
};

export function Criteria({ c }: { c: PlanResult["criterios"] }) {
  return (
    <ul className="criteria" aria-label="Critérios considerados e disponibilidade de dados">
      {Object.entries(c).map(([k, v]) => (
        <li key={k} className={v.disponivel ? "is-on" : "is-off"}>
          <span aria-hidden="true">{v.disponivel ? "●" : "○"}</span>
          <span>{CRIT_LABEL[k] ?? k}</span>
          <Tip text={v.disponivel ? `Considerado. Fonte: ${v.fonte}` : `Não considerado. ${v.motivo}`} label={`Sobre ${CRIT_LABEL[k] ?? k}`} />
        </li>
      ))}
    </ul>
  );
}

function LegLine({ leg }: { leg: Leg }) {
  if (leg.tipo === "caminhada") {
    const same = leg.de.nome === leg.para.nome;
    return (
      <li className="leg leg--walk">
        <span className="leg__time">{leg.partida}</span>
        <span className="leg__track" aria-hidden="true" />
        <div><strong>{same ? `Baldeação a pé em ${leg.de.nome}` : `Caminhe até ${leg.para.nome}`}</strong>
          <div className="small muted">{leg.duracao_min} min · {leg.caminhada_m} m <Source kind="estimado">estimado</Source></div></div>
      </li>
    );
  }
  const l = leg.linha!;
  return (
    <li className="leg">
      <span className="leg__time">{leg.partida}</span>
      <span className="leg__track" style={{ background: l.cor }} aria-hidden="true" />
      <div>
        <span className="line-pill" style={{ background: l.cor, color: l.cor_texto }}>{l.nome}</span>{" "}
        <strong>{MODE_LABEL[l.modo]} sentido {l.sentido || l.descricao}</strong>
        <div className="small">
          Embarque em <strong>{leg.de.nome}</strong> → desembarque em <strong>{leg.para.nome}</strong> ({leg.chegada})
        </div>
        <div className="small muted">
          {(leg.paradas?.length ?? 2) - 1} parada(s) · {leg.duracao_min} min ·{" "}
          espera {leg.espera_min} min{" "}
          {leg.espera_tipo === "estimada_por_frequencia"
            ? <Source kind="estimado">metade do intervalo de {leg.intervalo_min} min</Source>
            : <Source kind="oficial">próxima partida programada</Source>}
        </div>
        {leg.avisos_dados?.map((a) => <div key={a} className="small data-warn">⚠ {a}</div>)}
      </div>
    </li>
  );
}

export function AlternativeCard({ alt, index, fastest, onStart, recId }: {
  alt: Alternative; index: number; fastest: boolean; onStart?: (a: Alternative) => void; recId: string | null;
}) {
  const [open, setOpen] = useState(index === 0);
  const [fb, setFb] = useState<string | null>(null);
  const m = alt.metricas;
  const send = async (feedback: "util" | "nao_util") => {
    if (!recId) return;
    await api(`/plan/${recId}/feedback`, { body: { feedback, escolhida: index } }).catch(() => {});
    setFb(feedback);
  };
  return (
    <article className={`alt ${fastest ? "alt--best" : ""}`} aria-labelledby={`${alt.id}-t`}>
      <header className="alt__head">
        <div>
          <div className="alt__tags">{alt.rotulos.map((r) => <span key={r} className="alt__tag">{r}</span>)}</div>
          <h3 id={`${alt.id}-t`} className="alt__time"><span>{m.total_min}</span> min <small className="muted">{m.partida} → {m.chegada}</small></h3>
        </div>
        <div className="alt__lines" aria-label="Linhas utilizadas">
          {alt.pernas.filter((l) => l.tipo === "transporte").map((l, i) => (
            <span key={i} className="line-pill" style={{ background: l.linha!.cor, color: l.linha!.cor_texto }}>{l.linha!.nome}</span>
          ))}
        </div>
      </header>
      <dl className="alt__metrics">
        <div><dt>Baldeações</dt><dd>{m.baldeacoes}</dd></div>
        <div><dt>Espera</dt><dd>{m.espera_min} min</dd></div>
        <div><dt>A pé</dt><dd>{m.caminhada_m} m</dd></div>
        <div><dt>Relatos no trajeto</dt><dd>{m.relatos_lotacao + m.relatos_ocorrencias}</dd></div>
      </dl>
      <button className="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Ocultar detalhes" : "Ver passo a passo e por que recomendamos"}</button>
      {open && (
        <div className="alt__body">
          <ol className="legs">{alt.pernas.map((l, i) => <LegLine key={i} leg={l} />)}
            <li className="leg leg--end"><span className="leg__time">{m.chegada}</span><span className="leg__track" aria-hidden="true" /><strong>Chegada</strong></li>
          </ol>
          <div className="why">
            <h4>Por que esta opção?</h4>
            <ul>{alt.explicacao.motivos.map((x) => <li key={x}>{x}</li>)}</ul>
            <table className="why__table">
              <thead><tr><th>Fator</th><th>Valor</th><th>Origem</th></tr></thead>
              <tbody>{alt.explicacao.fatores.map((f) => <tr key={f.fator}><td>{f.fator}</td><td><strong>{f.valor}</strong></td><td className="muted">{f.fonte}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="alt__actions">
            {onStart && <button className="btn" onClick={() => onStart(alt)}>Iniciar navegação</button>}
            {recId && (fb ? <span className="small muted">Obrigado pelo retorno.</span> : (
              <span className="small">Esta recomendação foi útil?{" "}
                <button className="chip" onClick={() => send("util")}>Sim</button> <button className="chip" onClick={() => send("nao_util")}>Não</button></span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export function RouteResults({ result, onStart }: { result: PlanResult; onStart?: (a: Alternative) => void }) {
  const fastest = Math.min(...result.alternativas.map((a) => a.metricas.total_min));
  return (
    <section className="results" aria-live="polite">
      {result.dataset.aviso && <p className="notice">{result.dataset.aviso}</p>}
      <Criteria c={result.criterios} />
      {result.sem_resultado && <p className="notice notice--info">{result.sem_resultado} Dica: a amostra tem serviço entre ~4h e 0h.</p>}
      {result.alternativas.map((a, i) => (
        <AlternativeCard key={a.id} alt={a} index={i} fastest={a.metricas.total_min === fastest} onStart={onStart} recId={result.recomendacao_id} />
      ))}
      <p className="small muted">Calculado em {result.compute_ms} ms · dataset {result.dataset.versao}</p>
    </section>
  );
}
