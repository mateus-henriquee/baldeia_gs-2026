import { describe, expect, it } from "vitest";
import { COMMUNITY_CAP, computeTrust, reputationFrom } from "../src/community/trust.js";
import { scrubPersonalData } from "../src/lib/privacy.js";
import type { Pattern } from "../src/routing/network.js";
import { waitAt } from "../src/routing/planner.js";

const now = new Date("2026-11-05T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60000);

describe("confiabilidade de relatos", () => {
  it("muitas confirmações não tornam um relato 'verdadeiro' (teto comunitário)", () => {
    const t = computeTrust({ type: "atraso", createdAt: ago(0), reporterWeight: 1, confirmWeights: Array(500).fill(1), contestWeights: [], now });
    expect(t.apoio).toBe(COMMUNITY_CAP);
    expect(t.rotulo).toBe("corroborado");
  });
  it("confirmações têm retorno decrescente", () => {
    const one = computeTrust({ type: "atraso", createdAt: ago(0), reporterWeight: 0.5, confirmWeights: [0.5], contestWeights: [], now }).apoio;
    const four = computeTrust({ type: "atraso", createdAt: ago(0), reporterWeight: 0.5, confirmWeights: Array(4).fill(0.5), contestWeights: [], now }).apoio;
    const gainFirst = one - 0.5 / 1.5;
    expect(four - one).toBeLessThan(gainFirst * 3);
  });
  it("contestações derrubam o apoio e o rótulo", () => {
    const t = computeTrust({ type: "assalto", createdAt: ago(5), reporterWeight: 0.3, confirmWeights: [], contestWeights: [0.9, 0.9, 0.9], now });
    expect(t.rotulo).toBe("contestado");
  });
  it("frescor cai pela metade a cada meia-vida", () => {
    const t = computeTrust({ type: "superlotacao", createdAt: ago(20), reporterWeight: 0.5, confirmWeights: [], contestWeights: [], now });
    expect(t.frescor).toBeCloseTo(0.5, 2);
  });
  it("só fonte oficial confirma de fato", () => {
    const t = computeTrust({ type: "linha_parada", createdAt: ago(1), reporterWeight: 0.5, confirmWeights: [], contestWeights: [], officialMatch: true, now });
    expect(t.rotulo).toBe("confirmado_oficial");
  });
  it("reputação bayesiana parte de 0,5", () => {
    expect(reputationFrom(0, 0)).toBe(0.5);
    expect(reputationFrom(8, 0)).toBeGreaterThan(reputationFrom(4, 4));
  });
});

describe("minimização em textos livres", () => {
  it("remove e-mail, CPF, telefone e placa", () => {
    const r = scrubPersonalData("Fulano 123.456.789-00, (11) 91234-5678, a@b.com placa ABC1D23");
    expect(r.removed).toBe(4);
    expect(r.text).not.toMatch(/\d{3}\.\d{3}|91234|a@b|ABC1D23/);
  });
});

describe("espera em serviço por frequência", () => {
  const p: Pattern = { id: "t", routeId: "r", directionId: 0, headsign: "", stops: ["a", "b"], arr: [0, 120], dep: [0, 120],
    hopDistance: [1000], hopAnomaly: [null], hopImputed: [false], serviceIds: new Set(["S"]),
    windows: [{ start: 6 * 3600, end: 7 * 3600, headway: 600 }], starts: [] };
  it("dentro da janela: metade do intervalo", () => { expect(waitAt(p, 0, 6.5 * 3600)).toMatchObject({ wait: 300, kind: "frequencia" }); });
  it("antes da janela: espera até a primeira partida", () => { expect(waitAt(p, 0, 5.75 * 3600)?.wait).toBe(900); });
  it("sem serviço: null", () => { expect(waitAt(p, 0, 23 * 3600)).toBeNull(); });
});
