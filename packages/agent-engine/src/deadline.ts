import type { ExtractedItem } from "./types.js";

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, enero: 0, ene: 0,
  february: 1, feb: 1, febrero: 1,
  march: 2, mar: 2, marzo: 2,
  april: 3, apr: 3, abril: 3, abr: 3,
  may: 4, mayo: 4,
  june: 5, jun: 5, junio: 5,
  july: 6, jul: 6, julio: 6,
  august: 7, aug: 7, agosto: 7, ago: 7,
  september: 8, sep: 8, sept: 8, septiembre: 8,
  october: 9, oct: 9, octubre: 9,
  november: 10, nov: 10, noviembre: 10,
  december: 11, dec: 11, diciembre: 11, dic: 11,
};

export function parseDeadline(value: unknown): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) return new Date(iso);

  const dmy = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const named = raw.match(
    /(?:closing|closes|deadline|cierra|cierre|hasta|until)?\s*(\d{1,2})?\s*([a-záéíóúñ]+)(?:\s+(\d{4}))?/i
  );
  if (named) {
    const day = named[1] ? Number(named[1]) : 1;
    const monthKey = named[2].toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const month = MONTHS[monthKey];
    if (month != null) {
      const year = named[3] ? Number(named[3]) : new Date().getFullYear();
      const d = new Date(year, month, day);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  return null;
}

export function isExpiredDeadline(value: unknown, now = new Date()): boolean {
  const parsed = parseDeadline(value);
  if (!parsed) return false;
  const end = new Date(parsed);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < now.getTime();
}

export function daysUntilDeadline(value: unknown, now = new Date()): number | null {
  const parsed = parseDeadline(value);
  if (!parsed) return null;
  const ms = parsed.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isClosingSoon(value: unknown, withinDays = 14): boolean {
  const days = daysUntilDeadline(value);
  return days != null && days >= 0 && days <= withinDays;
}

export function sortByDeadlineAsc(items: ExtractedItem[]): ExtractedItem[] {
  return [...items].sort((a, b) => {
    const da = parseDeadline(a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = parseDeadline(b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });
}
