import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RouteResults } from "../components/RouteResults";
import { PlaceSearch } from "../components/PlaceSearch";
import { Logo, MetroRule, Source } from "../components/ui";
import { TEAM } from "../content/content";
import { api, errorText, type Place, type PlanResult } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useParallax, useReveal } from "../lib/hooks";
import { Intelligence } from "./Intelligence";
import manifest from "@data/gold/sptrans_gtfs_amostra/_manifest.json";

function Nav() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const links = [["#como-funciona", "Como funciona"], ["#demo", "Demonstração"], ["#inteligencia", "Ciência de dados"], ["#governanca", "Governança"], ["#equipe", "Equipe"]];
  return (
    <header className="nav">
      <div className="wrap nav__in">
        <a href="#topo" aria-label="Baldeia — início"><Logo height={30} /></a>
        <button className="nav__toggle" aria-expanded={open} aria-controls="nav-links" onClick={() => setOpen(!open)}>
          <span className="sr-only">Menu</span><span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>
        <nav id="nav-links" className={`nav__links ${open ? "is-open" : ""}`} aria-label="Seções" onClick={() => setOpen(false)}>
          {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
          {user ? <Link className="btn btn--small" to="/app">Abrir plataforma</Link> : (<>
            <Link to="/entrar">Entrar</Link>
            <Link className="btn btn--small" to="/cadastro">Criar conta</Link>
          </>)}
        </nav>
      </div>
    </header>
  );
}

function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 520 520" role="img" aria-label="Ilustração: linhas de transporte se cruzando em estações de baldeação">
      <defs><clipPath id="hc"><rect width="520" height="520" rx="40" /></clipPath></defs>
      <g clipPath="url(#hc)">
        <rect width="520" height="520" fill="#e9e4fb" />
        {Array.from({ length: 13 }, (_, i) => <line key={`v${i}`} x1={i * 40} y1="0" x2={i * 40} y2="520" stroke="#d8d0f5" />)}
        {Array.from({ length: 13 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 40} x2="520" y2={i * 40} stroke="#d8d0f5" />)}
        <path className="hero-line" d="M-10 120 H200 Q240 120 240 160 V520" stroke="#2b59c3" strokeWidth="18" fill="none" strokeLinecap="round" />
        <path className="hero-line hero-line--2" d="M40 540 V360 Q40 320 80 320 H360 Q400 320 400 280 V-10" stroke="#ff4d2e" strokeWidth="18" fill="none" strokeLinecap="round" />
        <path className="hero-line hero-line--3" d="M530 200 H320 Q280 200 280 240 V320" stroke="#16805a" strokeWidth="18" fill="none" strokeLinecap="round" />
        <path className="hero-line hero-line--4" d="M-10 440 H160 Q200 440 200 400 V320" stroke="#101418" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray="2 18" />
        {[[240, 320], [280, 320], [240, 200]].map(([x, y], i) => (
          <g key={i}><circle cx={x} cy={y} r="17" fill="#fff" stroke="#101418" strokeWidth="6" /></g>
        ))}
        <circle className="hero-dot" r="9" fill="#101418"><animateMotion dur="7s" repeatCount="indefinite" path="M40 540 V360 Q40 320 80 320 H360 Q400 320 400 280 V-10" /></circle>
        <circle className="hero-dot" r="9" fill="#fff" stroke="#101418" strokeWidth="3"><animateMotion dur="9s" repeatCount="indefinite" path="M-10 120 H200 Q240 120 240 160 V520" /></circle>
      </g>
    </svg>
  );
}

function Hero() {
  const bg = useParallax(0.12);
  return (
    <section id="topo" className="hero">
      <div ref={bg as React.RefObject<HTMLDivElement>} className="hero__bg" aria-hidden="true" />
      <div className="wrap hero__grid">
        <div className="hero__copy">
          <p className="eyebrow"><span className="eyebrow__dot" /> Transporte público · São Paulo (piloto)</p>
          <h1>Seu trajeto, com <span className="hl">os dados à vista</span>.</h1>
          <p className="lead">A Baldeia compara rotas de ônibus, metrô e trem e mostra <strong>por que</strong> recomenda cada uma — tempo, baldeações, caminhada e relatos da comunidade, com a origem de cada informação.</p>
          <div className="hero__cta">
            <a className="btn" href="#demo">Testar o planejador</a>
            <Link className="btn btn--ghost" to="/cadastro">Criar conta grátis</Link>
          </div>
          <ul className="hero__facts" aria-label="Destaques">
            <li><strong>19</strong> linhas reais<br /><span>amostra GTFS SPTrans</span></li>
            <li><strong>{manifest.qualidade.total_checks}</strong> verificações<br /><span>de qualidade por carga</span></li>
            <li><strong>0</strong> dados vendidos<br /><span>privacidade por padrão</span></li>
          </ul>
        </div>
        <div className="hero__visual reveal"><HeroArt /></div>
      </div>
    </section>
  );
}

function Value() {
  const items = [
    ["Compare, não adivinhe", "Várias alternativas lado a lado: a mais rápida, a com menos baldeações, a com menos caminhada — e o que você troca em cada uma."],
    ["Saiba de onde vem a informação", "Cada dado tem selo: oficial, comunidade, estimado ou demonstração. Quando falta dado, dizemos que falta."],
    ["Viaje mesmo sem sinal", "A navegação passo a passo fica no seu aparelho. Sem internet? Confirme as paradas manualmente."],
  ];
  return (
    <section className="section value" id="como-funciona" aria-labelledby="value-t">
      <div className="wrap">
        <h2 id="value-t" className="reveal">Uma rota é uma decisão.<br /><span className="muted">A Baldeia te dá contexto para tomá-la.</span></h2>
        <ol className="stations">
          {items.map(([t, d], i) => (
            <li key={t} className={`station reveal reveal-delay-${i + 1}`}>
              <span className="station__n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{t}</h3><p className="muted">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="section problem" aria-labelledby="prob-t">
      <div className="wrap problem__grid">
        <div className="reveal">
          <p className="eyebrow">O problema</p>
          <h2 id="prob-t">Informação espalhada, decisão no escuro.</h2>
          <p className="muted">Horários em um site, alertas em outro, lotação só no boca a boca. Quem depende do transporte coletivo escolhe rotas sem entender as consequências — e paga em tempo, desconforto e incerteza.</p>
        </div>
        <div className="compare reveal reveal-delay-1">
          <div className="compare__col">
            <h3>Hoje</h3>
            <ul><li>Fontes dispersas e difíceis de comparar</li><li>“Rota mais rápida” sem explicação</li><li>Relatos soltos em redes sociais, sem checagem</li><li>Apps que coletam localização sem dizer por quê</li></ul>
          </div>
          <div className="compare__col compare__col--good">
            <h3>Com a Baldeia</h3>
            <ul><li>Dados oficiais + comunidade + estimativas, rotulados</li><li>Critérios e pesos visíveis em cada recomendação</li><li>Relatos com confiança calculada, expiração e moderação</li><li>Localização processada no aparelho; histórico só com consentimento</li></ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const DEMO_O: Place = { id: "estacao:santo-amaro", nome: "Santo Amaro", tipo: "estacao", lat: 0, lon: 0, modos: ["metro", "trem"] };
const DEMO_D: Place = { id: "estacao:se", nome: "Sé", tipo: "estacao", lat: 0, lon: 0, modos: ["metro"] };

function Demo() {
  const [o, setO] = useState<Place | null>(DEMO_O);
  const [d, setD] = useState<Place | null>(DEMO_D);
  const [hour, setHour] = useState("08:00");
  const [res, setRes] = useState<PlanResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!o || !d) { setErr("Escolha origem e destino na lista."); return; }
    setBusy(true); setErr("");
    try {
      const r = await api<PlanResult>("/plan", { body: { origem: o.id, destino: d.id, partida: `2026-11-05T${hour}:00-03:00` } });
      setRes({ ...r, alternativas: r.alternativas.slice(0, 3) });
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  };
  return (
    <section className="section demo" id="demo" aria-labelledby="demo-t">
      <div className="wrap">
        <div className="demo__head reveal">
          <p className="eyebrow">Demonstração interativa</p>
          <h2 id="demo-t">Teste com a rede real (amostra).</h2>
          <p className="muted">Usa o GTFS histórico da SPTrans (centro de SP, 19 linhas) e relatos <Source kind="demo">sintéticos</Source>. Os horários são o padrão programado de uma quinta-feira — não a operação de hoje.</p>
        </div>
        <form className="demo__form panel reveal" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <PlaceSearch label="Origem" value={o} onChange={setO} />
          <PlaceSearch label="Destino" value={d} onChange={setD} />
          <div className="field"><label htmlFor="demo-h">Saída (qui.)</label><input id="demo-h" className="input" type="time" value={hour} onChange={(e) => setHour(e.target.value)} /></div>
          <button className="btn btn--signal" disabled={busy}>{busy ? "Calculando…" : "Comparar rotas"}</button>
        </form>
        {err && <p className="error" role="alert">{err}</p>}
        {res && <div className="demo__res"><RouteResults result={res} /></div>}
      </div>
    </section>
  );
}

function Features() {
  const f = [
    ["Planejador multicritério", "Origem, destino, horário e modos. Até 5 perfis de recomendação, explicados."],
    ["Navegação passo a passo", "Embarque, baldeação e desembarque. GPS opcional ou confirmação manual offline."],
    ["Comunidade com confiança", "Superlotação, atrasos, alagamentos… com confirmações, contestação, expiração e moderação."],
    ["Destinos favoritos", "Casa, trabalho, faculdade: um toque para buscar. Salvamos a estação, não seu endereço."],
    ["Hábitos e relatórios", "Seu horário habitual, variação de tempo e sugestões — só se você ativar."],
    ["Painel de privacidade", "Consentimentos por finalidade, exportação dos seus dados e exclusão da conta."],
  ];
  return (
    <section className="section features" aria-labelledby="feat-t">
      <div className="wrap">
        <h2 id="feat-t" className="reveal">O que a plataforma faz</h2>
        <ul className="feature-list">
          {f.map(([t, d], i) => (
            <li key={t} className={`reveal reveal-delay-${(i % 3) + 1}`}>
              <span className="feature-list__i" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <div><h3>{t}</h3><p className="muted">{d}</p></div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Team() {
  return (
    <section className="section team" id="equipe" aria-labelledby="team-t">
      <div className="wrap">
        <p className="eyebrow reveal">Idealizadores</p>
        <h2 id="team-t" className="reveal">Quem constrói a Baldeia</h2>
        <p className="notice reveal">Perfis em preenchimento: os dados dos integrantes ainda não foram fornecidos. Edite <code>apps/web/src/content/content.ts</code>.</p>
        <ul className="team__grid">
          {TEAM.map((m, i) => (
            <li key={i} className={`member reveal reveal-delay-${i + 1}`}>
              <div className="member__photo" aria-hidden={!m.foto}>{m.foto ? <img src={m.foto} alt={`Foto de ${m.nome}`} /> : <span>Foto</span>}</div>
              <h3>{m.nome}</h3>
              <p className="member__role">{m.funcao}</p>
              <p className="small muted">{m.apresentacao}</p>
              <p className="small"><strong>Contribuição:</strong> {m.contribuicao}</p>
              <p className="small member__links">
                {m.linkedin ? <a href={m.linkedin} rel="noopener" target="_blank">LinkedIn</a> : <span className="muted">LinkedIn (a preencher)</span>} ·{" "}
                {m.github ? <a href={m.github} rel="noopener" target="_blank">GitHub</a> : <span className="muted">GitHub (a preencher)</span>}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="cta" aria-labelledby="cta-t">
      <div className="wrap cta__in reveal">
        <h2 id="cta-t">Próxima parada: <span className="hl hl--dark">sua conta.</span></h2>
        <p>Gratuita, sem anúncios e com controle total sobre seus dados.</p>
        <div className="hero__cta"><Link className="btn btn--signal" to="/cadastro">Criar conta</Link><Link className="btn btn--ghost cta__ghost" to="/entrar">Já tenho conta</Link></div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer__grid">
        <div><Logo negative height={30} /><p className="small">Projeto acadêmico de Ciência de Dados (CitizenTech · Global Solution 2026). Demonstração — não use para decisões reais de viagem.</p></div>
        <div><h3>Plataforma</h3><ul><li><Link to="/app">Planejador</Link></li><li><Link to="/app/comunidade">Comunidade</Link></li><li><Link to="/transparencia">Transparência dos dados</Link></li></ul></div>
        <div><h3>Privacidade</h3><ul><li><Link to="/privacidade">Política de privacidade</Link></li><li><Link to="/app/privacidade">Meus dados</Link></li></ul></div>
        <div><h3>Créditos de dados</h3><p className="small">Mapa: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL). Rede: GTFS SPTrans, amostra histórica via r5py/Ipea.</p></div>
      </div>
      <div className="wrap footer__bottom small"><MetroRule stops={6} /><p>© 2026 Baldeia · Nome e marca em avaliação: disponibilidade comercial não verificada no INPI.</p></div>
    </footer>
  );
}

export default function Landing() {
  const ref = useReveal<HTMLDivElement>();
  useEffect(() => { document.title = "Baldeia — mobilidade orientada por dados"; }, []);
  return (
    <div ref={ref} className="landing">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <Nav />
      <main id="conteudo">
        <Hero />
        <Value />
        <Problem />
        <Demo />
        <Features />
        <Intelligence />
        <Team />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}
