import { useEffect } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../components/ui";
import { useAuth } from "../lib/auth";
import { loadTrip } from "../lib/trip";

const LINKS = [
  ["/app", "Planejar", "⌖"], ["/app/navegacao", "Navegação", "➜"], ["/app/comunidade", "Comunidade", "!"],
  ["/app/favoritos", "Favoritos", "★"], ["/app/historico", "Histórico", "↺"], ["/app/relatorios", "Relatórios", "▥"], ["/app/privacidade", "Privacidade", "⚿"],
] as const;

export default function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { document.getElementById("conteudo")?.focus(); }, [loc.pathname]);
  if (loading) return <p style={{ padding: 32 }}>Carregando…</p>;
  if (!user) return <Navigate to="/entrar" replace state={{ from: loc.pathname }} />;
  const hasTrip = Boolean(loadTrip());
  const out = async () => { await logout(); nav("/"); };
  const links = [...LINKS, ...(user.papel !== "usuario" ? [["/app/moderacao", "Moderação", "⚑"] as const] : [])];
  return (
    <div className="shell">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <aside className="side">
        <Link to="/" aria-label="Baldeia — início"><Logo negative height={28} /></Link>
        <nav aria-label="Plataforma">
          {links.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/app"}><span aria-hidden="true">{icon}</span>{label}{to === "/app/navegacao" && hasTrip ? " •" : ""}</NavLink>
          ))}
        </nav>
        <div className="side__user">
          <span>Olá, <strong style={{ color: "#fff" }}>{user.nome}</strong>{user.demo ? " (demo)" : ""}</span>
          {!user.verificado && <span>E-mail não verificado</span>}
          <button className="btn btn--ghost btn--small" onClick={out}>Sair</button>
        </div>
      </aside>
      <main className="main" id="conteudo" tabIndex={-1}>
        <div className="mobile-top"><Link to="/"><Logo height={26} /></Link><button className="btn btn--ghost btn--small" onClick={out}>Sair</button></div>
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Plataforma (atalhos)">
        {[LINKS[0], LINKS[1], LINKS[2], LINKS[5], LINKS[6]].map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === "/app"}><span aria-hidden="true">{icon}</span><span>{label}</span></NavLink>
        ))}
      </nav>
    </div>
  );
}
