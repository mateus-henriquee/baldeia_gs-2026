import { describe, expect, it } from "vitest";
import { distanceM, tripStops } from "../src/lib/trip";
import { localInputToIso, TRUST_LABEL } from "../src/lib/format";
import type { Alternative } from "../src/lib/api";

const s = (id: string, lat = -23.55, lon = -46.63) => ({ id, nome: id.toUpperCase(), lat, lon });
const alt = {
  id: "alt1", perfis: [], rotulos: [], componentes_s: {} as Alternative["componentes_s"], explicacao: { fatores: [], motivos: [], avisos: [] },
  metricas: {} as Alternative["metricas"],
  pernas: [
    { tipo: "transporte", de: s("a"), para: s("c"), partida: "08:00", chegada: "08:10", partida_s: 0, chegada_s: 600, duracao_min: 10,
      linha: { id: "L1", nome: "L1", descricao: "", modo: "metro", cor: "#000", cor_texto: "#fff", sentido: "X" },
      paradas: [{ ...s("a"), chegada: "08:00" }, { ...s("b"), chegada: "08:05" }, { ...s("c"), chegada: "08:10" }] },
    { tipo: "caminhada", de: s("c"), para: s("d"), partida: "08:10", chegada: "08:13", partida_s: 600, chegada_s: 780, duracao_min: 3, caminhada_m: 200 },
  ],
} as Alternative;

describe("navegação offline", () => {
  it("linealiza paradas sem repetir a de baldeação e descreve ações", () => {
    const st = tripStops(alt);
    expect(st.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(st[0].acao).toMatch(/Embarcar na linha L1/);
    expect(st[2].acao).toBe("Desembarcar em");
    expect(st[3].acao).toBe("Chegada em");
  });
  it("distância haversine", () => { expect(Math.round(distanceM({ lat: -23.55, lon: -46.63 }, { lat: -23.56, lon: -46.63 }))).toBe(1112); });
  it("formatação", () => { expect(localInputToIso("2026-11-05T08:00")).toBe("2026-11-05T08:00:00-03:00"); expect(TRUST_LABEL.corroborado).toMatch(/Corroborado/); });
});
