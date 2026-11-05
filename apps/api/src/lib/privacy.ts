import { createHash } from "node:crypto";
import { config } from "../config.js";

/** Hash do IP com segredo: permite detectar abuso sem armazenar o IP (pseudonimização). */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${config.jwtSecret}:${ip}`).digest("hex");
}

const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail removido]"],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento removido]"],               // CPF
  [/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone removido]"],
  [/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/g, "[placa removida]"],                      // placas BR (antiga e Mercosul)
];

/** Remove dados pessoais óbvios de textos livres da comunidade (minimização). */
export function scrubPersonalData(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text;
  for (const [re, repl] of PATTERNS) {
    out = out.replace(re, () => { removed++; return repl; });
  }
  return { text: out.replace(/\s+/g, " ").trim(), removed };
}
