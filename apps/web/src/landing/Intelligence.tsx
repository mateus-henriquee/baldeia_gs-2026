import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import catalog from "@data/sources/catalog.json";
import manifest from "@data/gold/sptrans_gtfs_amostra/_manifest.json";
import quality from "@data/gold/sptrans_gtfs_amostra/quality_report.json";
import analytics from "@data/gold/sptrans_gtfs_amostra/analytics.json";
import snapshot from "../content/recommendation-snapshot.json";
import { REFERENCES } from "../content/content";
import { Bars, Lightbox, Source, Tip } from "../components/ui";
import { MODE_LABEL } from "../lib/format";

const CAT_LABEL: Record<string, string> = { oficial: "Oficiais", geografica: "Geográficas", comunitaria: "Comunitárias", comportamental: "Comportamentais", demonstrativa: "Demonstrativas" };
const STATUS_LABEL: Record<string, string> = { integrada: "integrada", integrada_amostra: "integrada (amostra)", planejada: "planejada", indisponivel: "indisponível" };

function SubHead({ letter, title, children }: { letter: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="subhead reveal">
      <span className="subhead__letter" aria-hidden="true">{letter}</span>
      <div><h3>{title}</h3>{children && <p className="muted">{children}</p>}</div>
    </div>
  );
}

// ------------------------------------------------------------------ A. fontes
function Sources() {
  const groups = useMemo(() => {
    const g: Record<string, typeof catalog.fontes> = {};
    for (const f of catalog.fontes) (g[f.category] ??= []).push(f);
    return g;
  }, []);
  return (
    <div className="block">
      <SubHead letter="A" title="De onde vêm os dados?">Pesquisamos {catalog.fontes.length} fontes (consulta em {catalog.consultado_em}). O selo mostra o estado real da integração — planejado não é apresentado como pronto.</SubHead>
      <div className="sources">
        {Object.entries(groups).map(([cat, list]) => (
          <div key={cat} className={`sources__col sources__col--${cat} reveal`}>
            <h4>{CAT_LABEL[cat]}</h4>
            <ul>
              {list.map((f) => (
                <li key={f.source_id}>
                  <div className="sources__name">{f.name} <span className={`status status--${f.integration_status}`}>{STATUS_LABEL[f.integration_status]}</span></div>
                  <div className="small muted">{f.data_format}</div>
                  <details className="small"><summary>Licença e limitações</summary><p><strong>Responsável:</strong> {f.owner}</p><p><strong>Licença:</strong> {f.license}</p><p><strong>Limitações:</strong> {f.limitations}</p>
                    {f.url.startsWith("http") && <a href={f.url} target="_blank" rel="noopener">{f.url}</a>}</details>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ B. pipeline interativo
const q = manifest.qualidade;
const etapa = (n: string) => manifest.etapas.find((e) => e.etapa === n) as Record<string, unknown> & { duracao_ms: number };
const STEPS: Record<string, { titulo: string; texto: string; numeros?: string[] }> = {
  fontes: { titulo: "1 · Fontes", texto: "Dados oficiais (GTFS), geográficos (OpenStreetMap), comunitários (relatos) e de uso (com consentimento). A geolocalização fica no aparelho.",
    numeros: [`Fonte ativa: ${manifest.fonte.source_id}`, `${(manifest.fonte.bytes / 1024).toFixed(0)} KB recebidos`] },
  ingestao: { titulo: "2 · Ingestão", texto: "O arquivo chega como está. Calculamos o hash SHA-256 (impressão digital), registramos origem, horário e linhas por arquivo.",
    numeros: [`SHA-256: ${manifest.fonte.sha256.slice(0, 16)}…`, `Job: ${manifest.ingestao.job_id}`] },
  bronze: { titulo: "3 · Bronze — dados brutos", texto: "Cópia imutável do recebido. Se uma regra de limpeza tiver erro, reprocessamos a partir daqui sem baixar de novo.",
    numeros: Object.entries(etapa("ingestao_bronze").linhas_recebidas as Record<string, number>).map(([k, v]) => `${k}: ${v} linhas`) },
  silver: { titulo: "4–5 · Silver — limpeza e validação", texto: "Remove duplicadas, tipa coordenadas e horários (inclusive após meia-noite), confere domínios e chaves, verifica a vigência do calendário.",
    numeros: [`${q.total_checks} verificações`, `${q.by_status.aprovado} aprovadas`, `${q.by_status.aprovado_com_ressalvas ?? 0} com ressalvas`, `${etapa("tratamento_silver").duracao_ms} ms`] },
  quarentena: { titulo: "Quarentena", texto: "Registros reprovados não somem: vão para _quarentena/ com o motivo. Nesta versão, nenhum registro precisou de quarentena.",
    numeros: [`Registros em quarentena: ${Object.values(q.quarantined_records).reduce((s: number, v) => s + (v as number), 0)}`] },
  gold: { titulo: "6 · Gold — integração", texto: "Relaciona paradas, linhas e horários em trechos com tempo, distância e velocidade; gera conexões a pé e traçados simplificados. Anomalias são sinalizadas, não apagadas.",
    numeros: Object.entries(etapa("integracao_gold").linhas as Record<string, number>).map(([k, v]) => `${k}: ${v}`) },
  armazenamento: { titulo: "7 · Armazenamento", texto: "A Gold é carregada no PostgreSQL com a versão do dataset em cada tabela. Uma única versão fica ativa por fonte.", numeros: [`Versão: ${manifest.dataset_version}`] },
  analise: { titulo: "8 · Análise", texto: "Estatística descritiva da oferta planejada (intervalos por hora, velocidades, durações) e agregados de relatos com k-anonimato.",
    numeros: [`${analytics.velocidade_trechos.total_anomalias} trechos com velocidade atípica (z robusto > 3,5)`] },
  algoritmos: { titulo: "9 · Modelos e algoritmos", texto: "Dijkstra multicritério dependente do horário sobre o grafo da rede, e regras transparentes de confiança para relatos. Não usamos machine learning: não há dados observados suficientes para treinar e avaliar com honestidade." },
  recomendacoes: { titulo: "10 · Recomendações", texto: "Cada perfil (mais rápida, menos baldeações…) é um conjunto de pesos. Resultados iguais são unidos; cada alternativa traz motivos e fatores. Critério sem dados é declarado." },
  apresentacao: { titulo: "11 · Apresentação", texto: "Planejador, mapa, alertas, navegação e relatórios. Todo dado aparece com selo de origem: oficial, comunidade, estimado ou demonstração." },
  monitoramento: { titulo: "12 · Feedback e monitoramento", texto: "“Foi útil?” em cada recomendação, relatório de qualidade por versão, histórico de ingestões, latência p50/p95, denúncias e retenção automática alimentam melhorias." },
};
const ORDER = Object.keys(STEPS);

function Pipeline({ onZoom }: { onZoom: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [active, setActive] = useState("silver");
  useEffect(() => { fetch("/assets/diagrams/data-pipeline.svg").then((r) => r.text()).then(setSvg).catch(() => setSvg(null)); }, []);
  useEffect(() => {
    const root = box.current;
    if (!root || !svg) return;
    const steps = root.querySelectorAll<SVGGElement>(".step");
    const handlers: [SVGGElement, () => void, (e: KeyboardEvent) => void][] = [];
    steps.forEach((g) => {
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", STEPS[g.dataset.step ?? ""]?.titulo ?? "etapa");
      const click = () => setActive(g.dataset.step!);
      const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); click(); } };
      g.addEventListener("click", click); g.addEventListener("keydown", key);
      handlers.push([g, click, key]);
    });
    return () => handlers.forEach(([g, c, k]) => { g.removeEventListener("click", c); g.removeEventListener("keydown", k); });
  }, [svg]);
  useEffect(() => {
    box.current?.querySelectorAll<SVGGElement>(".step").forEach((g) => g.classList.toggle("is-active", g.dataset.step === active));
  }, [active, svg]);
  const s = STEPS[active];
  const idx = ORDER.indexOf(active);
  return (
    <div className="block">
      <SubHead letter="B" title="Como os dados são processados?">Clique em uma etapa do diagrama — os números são da execução real do pipeline sobre o GTFS da SPTrans.</SubHead>
      <div className="pipe reveal">
        <div ref={box} className="pipe-svg" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}>
          {svg ? undefined : <img src="/assets/diagrams/data-pipeline.svg" alt="Diagrama do pipeline de dados" />}
        </div>
        <aside className="pipe-panel" aria-live="polite">
          <div className="pipe-panel__nav">
            <button className="chip" onClick={() => setActive(ORDER[(idx - 1 + ORDER.length) % ORDER.length])} aria-label="Etapa anterior">←</button>
            <span className="small muted">{idx + 1}/{ORDER.length}</span>
            <button className="chip" onClick={() => setActive(ORDER[(idx + 1) % ORDER.length])} aria-label="Próxima etapa">→</button>
            <button className="chip" onClick={onZoom}>Ampliar ⤢</button>
          </div>
          <h4>{s.titulo}</h4>
          <p>{s.texto}</p>
          {s.numeros && <ul className="pipe-panel__nums">{s.numeros.map((n) => <li key={n}>{n}</li>)}</ul>}
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ C. relações
function Relations({ onZoom }: { onZoom: (src: string, alt: string) => void }) {
  return (
    <div className="block">
      <SubHead letter="C" title="Como os dados se relacionam?">27 tabelas em seis domínios. O diagrama é gerado automaticamente a partir do SQL — se o banco muda, a imagem muda junto.</SubHead>
      <div className="rel">
        <button className="thumb reveal" onClick={() => onZoom("/assets/diagrams/entity-relationship.svg", "Modelo entidade-relacionamento")}>
          <img src="/assets/diagrams/entity-relationship.svg" alt="Miniatura do diagrama entidade-relacionamento" />
          <span>Ampliar ERD ⤢</span>
        </button>
        <div className="rel__text reveal reveal-delay-1">
          <ul className="rel__list">
            <li><strong>Um relato</strong> pertence a <em>uma parada</em> (e opcionalmente a uma linha que a atende) e recebe <em>N confirmações</em> — nunca guarda coordenadas do autor.</li>
            <li><strong>Uma viagem</strong> tem <em>N etapas</em> (caminhada/transporte) e <em>N confirmações de parada</em>, e aponta para a <em>versão do dataset</em> que a calculou.</li>
            <li><strong>Toda tabela da rede</strong> carrega <code>dataset_version_id</code>: sabemos de qual arquivo, hash e execução cada linha veio.</li>
            <li><strong>Consentimentos</strong> são um log só de inserção: o estado atual é o registro mais recente de cada finalidade.</li>
          </ul>
          <button className="btn btn--ghost btn--small" onClick={() => onZoom("/assets/diagrams/data-flow.svg", "Fluxo de dados (DFD)")}>Ver fluxo de dados (DFD) ⤢</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ D. recomendação interativa
function Recommender() {
  const [w, setW] = useState({ espera: 1, caminhada: 1, baldeacao: 2, relatos: 0 });
  const scored = snapshot.alternativas.map((a) => {
    const c = a.componentes_s;
    const parts = { viagem: c.viagem / 60, espera: (w.espera * c.espera) / 60, caminhada: (w.caminhada * c.caminhada) / 60,
      baldeacoes: w.baldeacao * Math.max(0, c.embarques - 1), relatos: w.relatos * (a.metricas.relatos_lotacao + a.metricas.relatos_ocorrencias) };
    return { a, parts, total: Object.values(parts).reduce((s, x) => s + x, 0) };
  }).sort((x, y) => x.total - y.total);
  const max = Math.max(...scored.map((s) => s.total));
  const sliders: [keyof typeof w, string, number, string][] = [
    ["espera", "Peso da espera", 3, "×"], ["caminhada", "Peso da caminhada", 4, "×"],
    ["baldeacao", "Custo de cada baldeação", 25, " min"], ["relatos", "Custo de cada relato no trajeto", 20, " min"],
  ];
  return (
    <div className="block">
      <SubHead letter="D" title="Como transformamos dados em recomendações?">
        A rede vira um grafo: estações são nós; trechos de linha e caminhadas são arestas com custo. O algoritmo de Dijkstra encontra o caminho de menor custo — e o “custo” depende dos pesos. Mexa nos pesos e veja a ordem mudar.
      </SubHead>
      <div className="rec reveal">
        <div className="rec__controls">
          <p className="small"><strong>{snapshot.origem} → {snapshot.destino}</strong>, {snapshot.partida} <Source kind="demo">inclui relatos sintéticos</Source></p>
          {sliders.map(([k, label, maxv, unit]) => (
            <div key={k} className="field">
              <label htmlFor={`w-${k}`}>{label}: <strong>{w[k]}{unit}</strong></label>
              <input id={`w-${k}`} type="range" min={0} max={maxv} step={k === "espera" || k === "caminhada" ? 0.5 : 1} value={w[k]}
                onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} />
            </div>
          ))}
          <p className="small muted">Custo = tempo no veículo + peso·espera + peso·caminhada + custo·baldeações + custo·relatos. Sem dados de lotação oficiais, “relatos” usa só a comunidade.</p>
        </div>
        <ol className="rec__list">
          {scored.map(({ a, parts, total }, i) => (
            <li key={a.id} className={i === 0 ? "is-best" : ""}>
              <div className="rec__row">
                <span className="rec__rank">{i + 1}º</span>
                <span className="alt__lines">{a.linhas.map((l, j) => <span key={j} className="line-pill" style={{ background: l.cor, color: l.cor_texto }}>{l.nome}</span>)}</span>
                <span className="rec__score">custo {total.toFixed(0)}</span>
              </div>
              <div className="rec__bar" style={{ width: `${(total / max) * 100}%` }} role="img" aria-label={`Custo ${total.toFixed(0)}`} />
              <div className="small muted">{a.metricas.total_min} min · {a.metricas.baldeacoes} baldeação(ões) · {a.metricas.caminhada_m} m a pé · {a.metricas.relatos_lotacao + a.metricas.relatos_ocorrencias} relato(s)
                <Tip text={`Componentes: viagem ${parts.viagem.toFixed(0)} · espera ${parts.espera.toFixed(0)} · caminhada ${parts.caminhada.toFixed(0)} · baldeações ${parts.baldeacoes.toFixed(0)} · relatos ${parts.relatos.toFixed(0)}`} label="Detalhar custo" /></div>
            </li>
          ))}
        </ol>
      </div>
      <ul className="principles reveal">
        <li><strong>Menor tempo ≠ menos lotação ≠ “mais seguro”.</strong> São critérios diferentes, com perfis separados.</li>
        <li><strong>Sem dados, sem nota.</strong> Se não há relatos de lotação, o perfil “menos movimentada” não aparece — e dizemos por quê.</li>
        <li><strong>Sem índice de segurança.</strong> Relatos não medem risco real e refletem onde há mais usuários; não rotulamos bairros.</li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ números reais
function Numbers() {
  const metro = analytics.oferta_por_hora.por_modo.metro?.horas ?? [];
  const r = analytics.rede;
  const sp = analytics.velocidade_trechos.por_modo as Record<string, { mediana: number; p25: number; p75: number; n: number }>;
  const an = analytics.velocidade_trechos.anomalias[0];
  return (
    <div className="block numbers">
      <div className="numbers__grid">
        <div className="reveal">
          <h4>A amostra em números <Source kind="oficial">GTFS SPTrans</Source></h4>
          <dl className="bignums">
            <div><dt>linhas</dt><dd>{Object.values(r.linhas_por_modo).reduce((s, x) => s + x, 0)}</dd></div>
            <div><dt>paradas e estações</dt><dd>{r.paradas_total}</dd></div>
            <div><dt>trechos</dt><dd>{r.trechos}</dd></div>
            <div><dt>conexões a pé</dt><dd>{r.conexoes_a_pe.toLocaleString("pt-BR")}</dd></div>
          </dl>
          <table className="why__table small">
            <caption className="small muted" style={{ textAlign: "left" }}>Velocidade programada por trecho (km/h)</caption>
            <thead><tr><th>Modo</th><th>Mediana</th><th>Faixa central (p25–p75)</th><th>n</th></tr></thead>
            <tbody>{Object.entries(sp).map(([m, v]) => <tr key={m}><td>{MODE_LABEL[m]}</td><td>{v.mediana}</td><td>{v.p25}–{v.p75}</td><td>{v.n}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="reveal reveal-delay-1">
          <h4>Metrô: intervalo mediano programado por hora (min)</h4>
          <Bars data={metro.map((h) => ({ x: `${h.hora}h`, y: h.intervalo_mediano_min }))} label="Intervalo mediano programado do metrô por hora" unit=" min" />
          <p className="small muted">Oferta planejada em dias úteis — não é lotação observada.</p>
          {an && <p className="notice small"><strong>Anomalia real encontrada:</strong> o feed registra {an.distancia_m.toLocaleString("pt-BR")} m entre {an.de} e {an.para} ({an.route_id}) em {Math.round(an.tempo_s / 60)} min — {an.velocidade_kmh} km/h. Mantido e sinalizado; o planejador avisa quando usa esse trecho.</p>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ E. governança
function Governance({ onZoom }: { onZoom: (src: string, alt: string) => void }) {
  const items = [
    ["Minimização", "Favoritos guardam a estação, não o endereço. Relatos ficam na parada, não no GPS do autor. A localização é processada no aparelho."],
    ["Consentimento por finalidade", "Histórico, análise de hábitos, geolocalização e publicação são escolhas separadas — revogáveis a qualquer momento."],
    ["Confiança dos relatos", "Apoio = (reputação + confirmações) ÷ (… + contestações + 1), com retorno decrescente e teto de 85%. Só fonte oficial confirma de fato."],
    ["Expiração e moderação", "Superlotação expira em 45 min; alagamento em 3 h. Três denúncias ocultam o relato até revisão humana."],
    ["Retenção limitada", "Viagens: 180 dias. Texto de relatos: 30 dias após expirar. Logs: 365 dias. Execução automática e auditada."],
    ["Seus direitos", "Exportar todos os seus dados em JSON, revogar consentimentos e excluir a conta (relatos ficam anônimos)."],
  ];
  return (
    <div className="block" id="governanca">
      <SubHead letter="E" title="Governança e ética">Governança não é a última etapa: ela atravessa o pipeline, da coleta ao descarte.</SubHead>
      <div className="gov">
        <ul className="gov__list">{items.map(([t, d], i) => <li key={t} className={`reveal reveal-delay-${(i % 3) + 1}`}><h4>{t}</h4><p className="small muted">{d}</p></li>)}</ul>
        <button className="thumb reveal" onClick={() => onZoom("/assets/diagrams/data-governance.svg", "Governança transversal ao pipeline")}>
          <img src="/assets/diagrams/data-governance.svg" alt="Miniatura da matriz de governança" /><span>Ampliar matriz ⤢</span>
        </button>
      </div>
      <p className="small muted reveal">Estas medidas seguem princípios da LGPD (Lei 13.709/2018) e orientações da ANPD, mas não constituem certificação de conformidade jurídica.</p>
    </div>
  );
}

// ------------------------------------------------------------------ F. transparência
function Transparency() {
  const temas = [...new Set(REFERENCES.map((r) => r.tema))];
  const ressalvas = quality.verificacoes.filter((c) => c.records_failed > 0);
  return (
    <div className="block">
      <SubHead letter="F" title="Transparência e fontes">Referências consultadas em 5/11/2026 e o relatório de qualidade da versão ativa.</SubHead>
      <div className="refs">
        <div className="reveal">
          {temas.map((t) => (
            <div key={t} className="refs__group">
              <h4>{t}</h4>
              <ul>{REFERENCES.filter((r) => r.tema === t).map((r) => <li key={r.url + r.titulo}><a href={r.url} target="_blank" rel="noopener">{r.titulo}</a> — <span className="muted">{r.autor}</span></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="reveal reveal-delay-1">
          <h4>Ressalvas de qualidade desta versão</h4>
          <ul className="refs__q">{ressalvas.map((c) => <li key={c.check_id}><strong>{c.check_id}</strong>: {c.records_failed} de {c.records_checked} — {c.details || c.rule}</li>)}</ul>
          <Link className="btn btn--ghost btn--small" to="/transparencia">Painel completo de transparência</Link>
        </div>
      </div>
    </div>
  );
}

export function Intelligence() {
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const open = (src: string, alt: string) => setZoom({ src, alt });
  return (
    <section className="section intel" id="inteligencia" aria-labelledby="intel-t">
      <div className="wrap">
        <p className="eyebrow reveal">Ciência de dados</p>
        <h2 id="intel-t" className="reveal">A inteligência por trás da mobilidade.</h2>
        <p className="lead muted reveal">Sem caixa-preta: veja de onde vêm os dados, como são tratados, como viram recomendações e como são protegidos.</p>
        <Sources />
        <Pipeline onZoom={() => open("/assets/diagrams/data-pipeline.svg", "Pipeline de dados")} />
        <Numbers />
        <Relations onZoom={open} />
        <Recommender />
        <Governance onZoom={open} />
        <Transparency />
      </div>
      {zoom && <Lightbox src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
    </section>
  );
}
