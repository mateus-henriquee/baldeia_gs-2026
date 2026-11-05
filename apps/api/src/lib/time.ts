/** Utilitários de horário no fuso do serviço (America/Sao_Paulo). */
const TZ = "America/Sao_Paulo";
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof DAYS)[number];

export function localParts(d: Date): { weekday: Weekday; secs: number; isoDate: string; isoDow: number } {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const hour = Number(p.hour) % 24;
  return {
    weekday: DAYS[idx],
    secs: hour * 3600 + Number(p.minute) * 60 + Number(p.second),
    isoDate: `${p.year}-${p.month}-${p.day}`,
    isoDow: idx === 0 ? 7 : idx,
  };
}

export function fmtClock(secs: number): string {
  const s = Math.round(secs) % (24 * 3600);
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

export const minutes = (secs: number) => Math.round(secs / 60);
