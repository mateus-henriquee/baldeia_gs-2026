import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Logo, Source } from "../components/ui";
import { api, errorText } from "../lib/api";

function DocShell({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => { document.title = `${title} — Baldeia`; window.scrollTo(0, 0); }, [title]);
  return (
    <div>
      <header className="nav"><div className="wrap nav__in"><Link to="/" aria-label="Início"><Logo height={28} /></Link><Link to="/app" className="btn btn--small">Plataforma</Link></div></header>
      <main className="doc" id="conteudo"><h1 style={{ fontSize: "2.4rem" }}>{title}</h1>{children}</main>
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <DocShell title="Política de privacidade">
      <p className="notice">Documento de um projeto acadêmico. Descreve o funcionamento real do sistema, mas não é parecer jurídico nem certificação de conformidade com a LGPD.</p>
      <h2>Quem trata seus dados</h2>
      <p>A equipe do projeto Baldeia atua como controladora dos dados tratados na plataforma. Canal do encarregado: a definir antes de qualquer uso público.</p>
      <h2>O que coletamos e por quê</h2>
      <table className="table"><thead><tr><th>Dado</th><th>Finalidade</th><th>Base legal (LGPD)</th><th>Retenção</th></tr></thead><tbody>
        <tr><td>E-mail, nome de exibição, senha (hash)</td><td>Conta e acesso</td><td>Execução de contrato (art. 7º, V)</td><td>Até a exclusão da conta</td></tr>
        <tr><td>Consentimentos</td><td>Comprovar suas escolhas</td><td>Obrigação/exercício de direitos (art. 7º, II e VI)</td><td>Enquanto a conta existir</td></tr>
        <tr><td>Histórico de viagens</td><td>Consultar e repetir trajetos</td><td>Consentimento (art. 7º, I)</td><td>180 dias</td></tr>
        <tr><td>Análise de hábitos</td><td>Sugerir horários</td><td>Consentimento (art. 7º, I)</td><td>Calculada sob demanda</td></tr>
        <tr><td>Relatos comunitários</td><td>Alertas para outros passageiros</td><td>Consentimento + termos de uso</td><td>Texto: 30 dias após expirar</td></tr>
        <tr><td>Logs de auditoria (IP em hash)</td><td>Segurança e prevenção de abuso</td><td>Legítimo interesse (art. 7º, IX)</td><td>365 dias</td></tr>
      </tbody></table>
      <h2>O que não fazemos</h2>
      <ul><li>Não enviamos suas coordenadas GPS ao servidor: a localização é usada só no seu aparelho.</li><li>Não guardamos o endereço da sua casa: favoritos apontam para estações/pontos.</li>
        <li>Não vendemos nem compartilhamos dados pessoais. Não usamos atributos sensíveis para definir rotas.</li><li>Não exibimos seu nome nos relatos; ao excluir a conta, a autoria dos relatos é removida.</li></ul>
      <h2>Seus direitos</h2>
      <p>Em <Link to="/app/privacidade">Meus dados</Link> você pode consultar e alterar consentimentos, baixar todos os seus dados (JSON) e excluir sua conta.</p>
      <h2>Terceiros</h2>
      <p>O mapa carrega imagens de tiles do OpenStreetMap: seu navegador faz essas requisições diretamente ao servidor do OSM (que recebe seu IP), conforme a política de uso deles.</p>
    </DocShell>
  );
}

interface Transp {
  fontes: { source_id: string; name: string; owner: string; category: string; integration_status: string; license: string; limitations: string; url: string }[];
  versao_ativa: { id: string; carregada_em: string; manifesto: { etapas: { etapa: string; duracao_ms: number }[]; premissas: Record<string, number> } } | null;
  qualidade: { check_code: string; dimension: string; rule: string; records_checked: number; records_failed: number; status: string; details: string | null }[];
  ingestoes: { job_id: string; started_at: string; status: string }[];
  recomendacoes: { total: number; util: number; nao_util: number; p50: number };
}

export function TransparencyPage() {
  const [d, setD] = useState<Transp | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<Transp>("/public/transparency").then(setD).catch((e) => setErr(errorText(e))); }, []);
  return (
    <DocShell title="Transparência dos dados">
      <p className="lead muted">Fontes, versão ativa, linhagem e resultado de cada regra de qualidade — direto do banco.</p>
      {err && <p className="error">{err}</p>}
      {d && <>
        <h2>Versão ativa</h2>
        <p><code>{d.versao_ativa?.id}</code> · carregada em {d.versao_ativa && new Date(d.versao_ativa.carregada_em).toLocaleString("pt-BR")}</p>
        <table className="table"><thead><tr><th>Etapa</th><th>Duração</th></tr></thead><tbody>
          {d.versao_ativa?.manifesto.etapas.map((e) => <tr key={e.etapa}><td>{e.etapa}</td><td>{e.duracao_ms} ms</td></tr>)}</tbody></table>
        <p className="small muted">Premissas: {Object.entries(d.versao_ativa?.manifesto.premissas ?? {}).map(([k, v]) => `${k} = ${v}`).join(" · ")}</p>
        <h2>Qualidade ({d.qualidade.length} regras)</h2>
        <table className="table"><thead><tr><th>Regra</th><th>Dimensão</th><th>Falhas</th><th>Status</th></tr></thead><tbody>
          {d.qualidade.map((q) => <tr key={q.check_code}><td><strong>{q.check_code}</strong><br /><span className="small muted">{q.rule}{q.details ? ` — ${q.details}` : ""}</span></td><td>{q.dimension}</td><td>{q.records_failed}/{q.records_checked}</td><td>{q.status.replaceAll("_", " ")}</td></tr>)}</tbody></table>
        <h2>Fontes</h2>
        <ul className="list">{d.fontes.map((f) => <li key={f.source_id} className="report"><div className="report__top"><strong>{f.name}</strong>
          <Source kind={f.category === "demonstrativa" ? "demo" : f.category === "comunitaria" ? "comunidade" : f.category === "comportamental" ? "estimado" : "oficial"}>{f.category}</Source>
          <span className={`status status--${f.integration_status}`}>{f.integration_status.replace("_", " ")}</span></div>
          <span className="small muted">{f.owner}</span><span className="small"><strong>Licença:</strong> {f.license}</span><span className="small"><strong>Limitações:</strong> {f.limitations}</span></li>)}</ul>
        <h2>Recomendações</h2>
        <p>{d.recomendacoes.total} recomendações calculadas · {d.recomendacoes.util} úteis · {d.recomendacoes.nao_util} não úteis · mediana de {d.recomendacoes.p50.toFixed(1)} ms.</p>
        <p className="small muted">Dados anônimos para monitoramento; sem identificação de usuários.</p>
      </>}
    </DocShell>
  );
}
