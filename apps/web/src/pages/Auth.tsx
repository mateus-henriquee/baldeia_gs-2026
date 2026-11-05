import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/ui";
import { api, errorText } from "../lib/api";
import { useAuth } from "../lib/auth";

function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => { document.title = `${title} — Baldeia`; }, [title]);
  return (
    <div className="auth">
      <aside className="auth__art">
        <Link to="/"><Logo negative height={32} /></Link>
        <div>
          <h2>Cada baldeação, uma escolha informada.</h2>
          <p style={{ color: "#a9aeb8" }}>Você controla o que guardamos. Histórico e análise de hábitos só com sua permissão — e podem ser desligados a qualquer momento.</p>
        </div>
        <p className="small" style={{ color: "#a9aeb8" }}>Projeto acadêmico · dados demonstrativos rotulados</p>
      </aside>
      <main className="auth__form" id="conteudo">
        <Link to="/" className="small">← Início</Link>
        <h1 style={{ fontSize: "2rem" }}>{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function Login() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await api("/auth/login", { body: f }); await refresh(); nav("/app"); } catch (x) { setErr(errorText(x)); }
    setBusy(false);
  };
  return (
    <AuthLayout title="Entrar">
      <form onSubmit={submit} className="planner" noValidate>
        <div className="field"><label htmlFor="em">E-mail</label><input id="em" className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="pw">Senha</label><input id="pw" className="input" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
      <p className="small">Não tem conta? <Link to="/cadastro">Criar conta</Link></p>
      <details className="notice notice--demo small"><summary>Contas de demonstração (ambiente local)</summary>
        <p>Usuário: <code>demo@baldeia.dev</code> / <code>baldeia-demo-2026</code><br />Moderação: <code>moderacao@baldeia.dev</code> / <code>baldeia-mod-2026</code></p>
        <p>Existem apenas com <code>SEED_DEMO=true</code>. Nunca use essas credenciais em produção.</p></details>
    </AuthLayout>
  );
}

export function Register() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [f, setF] = useState({ display_name: "", email: "", password: "", accept_terms: false, historico_viagens: false, analise_habitos: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await api<{ verificacao_dev?: string }>("/auth/register", { body: { display_name: f.display_name, email: f.email, password: f.password,
        accept_terms: f.accept_terms, consents: { historico_viagens: f.historico_viagens, analise_habitos: f.analise_habitos } } });
      await refresh();
      if (r.verificacao_dev) setVerify(r.verificacao_dev); else nav("/app");
    } catch (x) { setErr(errorText(x)); }
    setBusy(false);
  };
  if (verify) return (
    <AuthLayout title="Conta criada">
      <p>Enviaríamos um link de verificação por e-mail. Como o ambiente local não tem servidor de e-mail, o link aparece aqui e no terminal da API:</p>
      <Link className="btn" to={verify}>Verificar meu e-mail</Link>
      <p className="small muted">Contas não verificadas podem usar tudo, mas publicam menos relatos e com peso menor.</p>
      <Link to="/app">Ir para a plataforma</Link>
    </AuthLayout>
  );
  return (
    <AuthLayout title="Criar conta">
      <form onSubmit={submit} className="planner" noValidate>
        <div className="field"><label htmlFor="nm">Como quer ser chamado(a)</label><input id="nm" className="input" autoComplete="nickname" maxLength={40} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          <span className="hint">Não é exibido nos relatos públicos.</span></div>
        <div className="field"><label htmlFor="em2">E-mail</label><input id="em2" className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="pw2">Senha</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-describedby="pw2h" />
          <span id="pw2h" className="hint">Mínimo de 10 caracteres, com letras e números.</span></div>
        <fieldset className="planner" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Privacidade (opcional — você pode mudar depois)</legend>
          <label className="check"><input type="checkbox" checked={f.historico_viagens} onChange={(e) => setF({ ...f, historico_viagens: e.target.checked })} />
            <span>Salvar meu histórico de viagens <span className="hint">(180 dias; para consultar e repetir buscas)</span></span></label>
          <label className="check"><input type="checkbox" checked={f.analise_habitos} onChange={(e) => setF({ ...f, analise_habitos: e.target.checked })} />
            <span>Analisar meus hábitos para sugerir horários <span className="hint">(requer histórico; processado só para você)</span></span></label>
        </fieldset>
        <label className="check"><input type="checkbox" checked={f.accept_terms} onChange={(e) => setF({ ...f, accept_terms: e.target.checked })} required />
          <span>Li e aceito os termos e a <Link to="/privacidade" target="_blank">política de privacidade</Link>.</span></label>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? "Criando…" : "Criar conta"}</button>
      </form>
      <p className="small">Já tem conta? <Link to="/entrar">Entrar</Link></p>
    </AuthLayout>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState<"wait" | "ok" | "err">("wait");
  const [msg, setMsg] = useState("");
  const { refresh } = useAuth();
  useEffect(() => {
    api("/auth/verify-email", { body: { token: params.get("token") ?? "" } })
      .then(() => { setState("ok"); void refresh(); }).catch((e) => { setState("err"); setMsg(errorText(e)); });
  }, [params, refresh]);
  return (
    <AuthLayout title="Verificação de e-mail">
      {state === "wait" && <p>Verificando…</p>}
      {state === "ok" && <><p>E-mail verificado. Seus relatos agora têm peso integral.</p><Link className="btn" to="/app">Abrir plataforma</Link></>}
      {state === "err" && <p className="error">{msg}</p>}
    </AuthLayout>
  );
}
