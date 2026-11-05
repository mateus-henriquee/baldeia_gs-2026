import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "./styles/global.css";
import "./styles/landing.css";
import "./styles/app.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Landing from "./landing/Landing";
import { Login, Register, VerifyEmail } from "./pages/Auth";
import { PrivacyPolicy, TransparencyPage } from "./pages/PublicDocs";

// Área autenticada carregada sob demanda (Leaflet só quando necessário).
const Shell = lazy(() => import("./app/Shell"));
const Dashboard = lazy(() => import("./app/Dashboard"));
const Navigate = lazy(() => import("./app/Navigate"));
const Community = lazy(() => import("./app/Community"));
const Pages = import("./app/Pages");
const Favorites = lazy(() => Pages.then((m) => ({ default: m.Favorites })));
const History = lazy(() => Pages.then((m) => ({ default: m.History })));
const Reports = lazy(() => Pages.then((m) => ({ default: m.Reports })));
const Privacy = lazy(() => Pages.then((m) => ({ default: m.Privacy })));
const Moderation = lazy(() => Pages.then((m) => ({ default: m.Moderation })));

function NotFound() {
  return <main className="doc"><h1>Página não encontrada</h1><a href="/">Voltar ao início</a></main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<p style={{ padding: 32 }}>Carregando…</p>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/entrar" element={<Login />} />
            <Route path="/cadastro" element={<Register />} />
            <Route path="/verificar-email" element={<VerifyEmail />} />
            <Route path="/privacidade" element={<PrivacyPolicy />} />
            <Route path="/transparencia" element={<TransparencyPage />} />
            <Route path="/app" element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="navegacao" element={<Navigate />} />
              <Route path="comunidade" element={<Community />} />
              <Route path="favoritos" element={<Favorites />} />
              <Route path="historico" element={<History />} />
              <Route path="relatorios" element={<Reports />} />
              <Route path="privacidade" element={<Privacy />} />
              <Route path="moderacao" element={<Moderation />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
