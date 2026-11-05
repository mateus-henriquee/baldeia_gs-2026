import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import type { Db } from "../src/db/client.js";

let db: Db;
let app: ReturnType<typeof createApp>["app"];

beforeAll(async () => {
  db = await bootstrap({ memory: true, demo: true });
  app = createApp(db).app;
});
afterAll(async () => { await db.close(); });

async function newUser(email: string) {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/register").send({ email, password: "senhaForte123", display_name: "Teste", accept_terms: true,
    consents: { historico_viagens: true, analise_habitos: true } });
  expect(r.status).toBe(201);
  return agent;
}

describe("público e transparência", () => {
  it("responde saúde e busca estações agrupadas", async () => {
    expect((await request(app).get("/api/public/health")).body.status).toBe("ok");
    const r = await request(app).get("/api/public/places?q=tatuap");
    expect(r.body.locais[0]).toMatchObject({ id: "estacao:tatuape", tipo: "estacao" });
  });

  it("expõe fontes, qualidade e linhagem sem dados pessoais", async () => {
    const r = await request(app).get("/api/public/transparency");
    expect(r.body.fontes.length).toBeGreaterThan(5);
    expect(r.body.versao_ativa.id).toMatch(/^dsv_/);
    expect(r.body.qualidade.some((q: { check_code: string }) => q.check_code === "calendar:vigencia")).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/password_hash|@baldeia\.dev/);
  });

  it("agregados comunitários respeitam k-anonimato", async () => {
    const r = await request(app).get("/api/public/analytics");
    expect(r.body.oferta.rede.paradas_total).toBe(654);
    for (const h of r.body.comunidade.por_hora) expect(h.reporters).toBeGreaterThanOrEqual(3);
  });
});

describe("planejamento", () => {
  it("planeja com explicação, critérios e aviso de dados históricos", async () => {
    const r = await request(app).post("/api/plan").send({ origem: "estacao:vila-madalena", destino: "estacao:tatuape", partida: "2026-11-04T08:00:00-03:00" });
    expect(r.status).toBe(200);
    expect(r.body.alternativas.length).toBeGreaterThan(0);
    expect(r.body.dataset.aviso).toMatch(/histórico/);
    expect(r.body.criterios.seguranca.disponivel).toBe(false);
    const alt = r.body.alternativas[0];
    expect(alt.explicacao.fatores.map((f: { fator: string }) => f.fator)).toContain("Baldeações");
    expect(alt.pernas.at(-1).para.nome).toBe("Tatuapé");
    const fb = await request(app).post(`/api/plan/${r.body.recomendacao_id}/feedback`).send({ feedback: "util" });
    expect(fb.status).toBe(200);
  });

  it("respeita filtro de modo (somente ônibus)", async () => {
    const r = await request(app).post("/api/plan").send({ origem: "estacao:vila-madalena", destino: "estacao:tatuape", modos: ["onibus"],
      partida: "2026-11-04T08:00:00-03:00" });
    for (const a of r.body.alternativas) for (const l of a.pernas) if (l.tipo === "transporte") expect(l.linha.modo).toBe("onibus");
  });

  it("rejeita entrada inválida", async () => {
    expect((await request(app).post("/api/plan").send({ origem: "x" })).status).toBe(400);
    expect((await request(app).post("/api/plan").send({ origem: "nao-existe", destino: "estacao:se" })).status).toBe(400);
  });
});

describe("autenticação", () => {
  it("valida senha, impede e-mail duplicado e não enumera contas", async () => {
    const weak = await request(app).post("/api/auth/register").send({ email: "fraca@teste.dev", password: "123", display_name: "X", accept_terms: true });
    expect(weak.status).toBe(400);
    await newUser("dup@teste.dev");
    const dup = await request(app).post("/api/auth/register").send({ email: "DUP@teste.dev", password: "senhaForte123", display_name: "Yara", accept_terms: true });
    expect(dup.status).toBe(409);
    const a = await request(app).post("/api/auth/login").send({ email: "dup@teste.dev", password: "errada123" });
    const b = await request(app).post("/api/auth/login").send({ email: "naoexiste@teste.dev", password: "errada123" });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.erro).toBe(b.body.erro);
  });

  it("protege rotas privadas e bloqueia origem cruzada", async () => {
    expect((await request(app).get("/api/me/favorites")).status).toBe(401);
    const r = await request(app).post("/api/auth/login").set("Origin", "https://malicioso.example").send({ email: "a@b.c", password: "x" });
    expect(r.status).toBe(403);
  });
});

describe("comunidade e governança comunitária", () => {
  it("exige consentimento, remove dados pessoais, impede autoconfirmação e limita contas não verificadas", async () => {
    const a = await newUser("autor@teste.dev");
    const sem = await a.post("/api/community/reports").send({ tipo: "superlotacao", stop_id: "18849" });
    expect(sem.status).toBe(403);
    await a.put("/api/me/consents").send({ finalidade: "comunidade_publicar", concedido: true });
    const ok = await a.post("/api/community/reports").send({ tipo: "superlotacao", stop_id: "18849", descricao: "Lotado! me liga 11 98765-4321 ou x@y.com" });
    expect(ok.status).toBe(201);
    expect(ok.body.dados_pessoais_removidos).toBe(2);
    expect((await a.post(`/api/community/reports/${ok.body.id}/vote`).send({ voto: "confirma" })).status).toBe(400);
    expect((await a.post("/api/community/reports").send({ tipo: "atraso", stop_id: "18848" })).status).toBe(201);
    expect((await a.post("/api/community/reports").send({ tipo: "atraso", stop_id: "18852" })).status).toBe(429);

    const b = await newUser("votante@teste.dev");
    expect((await b.post(`/api/community/reports/${ok.body.id}/vote`).send({ voto: "confirma" })).status).toBe(200);
    const list = await request(app).get("/api/community/reports");
    const mine = list.body.relatos.find((x: { id: string }) => x.id === ok.body.id);
    expect(mine.descricao).not.toMatch(/98765|x@y/);
    expect(mine.confianca.apoio).toBeLessThanOrEqual(0.85);
    expect(mine).not.toHaveProperty("user_id");
  });

  it("oculta após 3 denúncias e exige papel de moderação", async () => {
    const a = await newUser("autor2@teste.dev");
    await a.put("/api/me/consents").send({ finalidade: "comunidade_publicar", concedido: true });
    const rep = await a.post("/api/community/reports").send({ tipo: "enchente", stop_id: "18852" });
    for (const e of ["d1@teste.dev", "d2@teste.dev", "d3@teste.dev"]) {
      const u = await newUser(e);
      await u.post(`/api/community/reports/${rep.body.id}/flag`).send({ motivo: "falso" });
    }
    const list = await request(app).get("/api/community/reports");
    expect(list.body.relatos.some((x: { id: string }) => x.id === rep.body.id)).toBe(false);
    expect((await a.get("/api/community/moderation/queue")).status).toBe(403);
    const mod = request.agent(app);
    await mod.post("/api/auth/login").send({ email: "moderacao@baldeia.dev", password: "baldeia-mod-2026" });
    const q = await mod.get("/api/community/moderation/queue");
    expect(q.body.fila.some((x: { id: string }) => x.id === rep.body.id)).toBe(true);
    expect((await mod.post(`/api/community/moderation/reports/${rep.body.id}`).send({ acao: "remover", nota: "Sem evidências" })).status).toBe(200);
  });
});

describe("privacidade (LGPD)", () => {
  it("histórico, hábitos, exportação, revogação e exclusão", async () => {
    const a = await newUser("titular@teste.dev");
    const plan = await a.post("/api/plan").send({ origem: "estacao:vila-madalena", destino: "estacao:se", partida: "2026-11-04T07:30:00-03:00" });
    const j = await a.post("/api/me/journeys").send({ recomendacao_id: plan.body.recomendacao_id, alternativa_id: plan.body.alternativas[0].id,
      partida: "2026-11-04T07:30:00-03:00" });
    expect(j.body.salvo).toBe(true);
    expect((await a.post("/api/me/demo-history").send({})).body.criadas).toBeGreaterThan(5);
    const h = await a.get("/api/me/habits");
    expect(h.body.disponivel).toBe(true);
    expect(h.body.destinos[0].saida_habitual).toMatch(/^\d\d:\d\d$/);
    expect(h.body.lugares_para_aguardar.disponivel).toBe(false);

    const exp = await a.get("/api/me/export");
    expect(exp.body.viagens.length).toBeGreaterThan(0);
    expect(JSON.stringify(exp.body)).not.toMatch(/password_hash|\$2[aby]\$/);

    await a.put("/api/me/consents").send({ finalidade: "historico_viagens", concedido: false });
    expect((await a.get("/api/me/journeys")).body.viagens).toHaveLength(0);

    await a.put("/api/me/consents").send({ finalidade: "comunidade_publicar", concedido: true });
    const rep = await a.post("/api/community/reports").send({ tipo: "problema_estacao", stop_id: "18849" });
    expect((await a.delete("/api/me").send({ confirmacao: "EXCLUIR" })).status).toBe(200);
    const left = await db.query<{ user_id: string | null }>("SELECT user_id FROM community_reports WHERE report_id=$1", [rep.body.id]);
    expect(left.rows[0].user_id).toBeNull();
    expect((await db.query("SELECT 1 FROM users WHERE email_normalized='titular@teste.dev'")).rows).toHaveLength(0);
  });
});
