/**
 * Monitoramento em memória (etapa 7 do pipeline): latência por rota, erros e eventos.
 * Simples por design — em produção, exportar para Prometheus/OpenTelemetry.
 */
import type { NextFunction, Request, Response } from "express";

const WINDOW = 500;
const samples = new Map<string, number[]>();
const counters = new Map<string, number>();
const startedAt = new Date();

export function inc(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const t0 = performance.now();
  res.on("finish", () => {
    const route = req.route?.path ? `${req.method} ${req.baseUrl}${req.route.path}` : `${req.method} (sem rota)`;
    const arr = samples.get(route) ?? [];
    arr.push(performance.now() - t0);
    if (arr.length > WINDOW) arr.shift();
    samples.set(route, arr);
    inc(`http_${Math.floor(res.statusCode / 100)}xx`);
  });
  next();
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

export function snapshot() {
  const rotas = [...samples.entries()].map(([rota, arr]) => {
    const s = [...arr].sort((a, b) => a - b);
    return { rota, amostras: s.length, p50_ms: +pct(s, 50).toFixed(1), p95_ms: +pct(s, 95).toFixed(1) };
  }).sort((a, b) => b.amostras - a.amostras);
  return { iniciado_em: startedAt.toISOString(), contadores: Object.fromEntries(counters), rotas };
}
