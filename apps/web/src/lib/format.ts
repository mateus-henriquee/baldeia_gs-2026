export const MODE_LABEL: Record<string, string> = { onibus: "Ônibus", metro: "Metrô", trem: "Trem", outro: "Outro" };

export function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}
export function timeLeft(iso: string): string {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  return min <= 0 ? "expirado" : min < 60 ? `expira em ${min} min` : `expira em ${Math.round(min / 60)} h`;
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const TRUST_LABEL: Record<string, string> = {
  confirmado_oficial: "Confirmado por fonte oficial",
  corroborado: "Corroborado pela comunidade",
  nao_verificado: "Não verificado",
  contestado: "Contestado",
};

/** Data/hora local (input datetime-local) → ISO com fuso de São Paulo. */
export function localInputToIso(v: string): string {
  return `${v}:00-03:00`;
}
export function nowLocalInput(): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
