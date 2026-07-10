import type { AgentSpec } from "./types.js";
import { isGrantTarget, isJobTarget } from "./opportunity-subtype.js";

const STOP_WORDS = new Set([
  "de", "la", "el", "en", "un", "una", "del", "los", "las", "por", "con", "para",
  "the", "and", "for", "que", "job", "jobs", "empleo", "empleos", "vacante", "vacantes",
  "oferta", "ofertas", "trabajo", "puesto", "remoto", "remote",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function coreKeywords(spec: AgentSpec, max = 6): string {
  const tokens = tokenize(`${spec.prompt} ${spec.filters.criteria}`);
  const unique = [...new Set(tokens)];
  return unique.slice(0, max).join(" ");
}

interface SectorBoards {
  match: RegExp;
  boards: string[];
}

// Portales de empleo generales (globales + España).
const GENERAL_BOARDS = [
  "linkedin.com/jobs",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "infojobs.net",
  "tecnoempleo.com",
  "computrabajo.com",
  "jobfluent.com",
  "welcometothejungle.com",
];

// Portales por sector, activados según palabras clave del objetivo.
const SECTOR_BOARDS: SectorBoards[] = [
  {
    match: /videojuego|video game|gaming|game dev|juego|gamedev|qa game|games/i,
    boards: [
      "hitmarker.net",
      "remotegamejobs.com",
      "gamejobs.co",
      "gamesjobsdirect.com",
      "jobs.gamesindustry.biz",
      "workwithindies.com",
      "grackle.jobs",
    ],
  },
  {
    match: /software|developer|programador|frontend|backend|full ?stack|devops|data|qa|testing|tester|ingenier|engineer|it\b/i,
    boards: [
      "wellfound.com",
      "remoteok.com",
      "weworkremotely.com",
      "stackoverflow.jobs",
      "remotive.com",
      "eu.jobsdb.com",
    ],
  },
  {
    match: /marketing|growth|seo|content|social media|community/i,
    boards: ["remotemarketing.io", "marketinghire.com", "workingnomads.com"],
  },
  {
    match: /design|dise[nñ]o|ux|ui|product design|producto/i,
    boards: ["dribbble.com/jobs", "designjobs.co", "authenticjobs.com"],
  },
  {
    match: /health|salud|medic|nurse|enfermer|clinic|hospital/i,
    boards: ["healthjobsuk.com", "practicelink.com"],
  },
  {
    match: /finan|account|contab|banking|fintech/i,
    boards: ["efinancialcareers.com", "workinfintech.com"],
  },
];

/** Devuelve la lista de portales relevantes para el objetivo del agente. */
export function sectorBoards(spec: AgentSpec): string[] {
  const blob = `${spec.prompt} ${spec.filters.criteria} ${spec.search.queries.join(" ")}`;
  const boards = [...GENERAL_BOARDS];
  for (const sector of SECTOR_BOARDS) {
    if (sector.match.test(blob)) boards.push(...sector.boards);
  }
  return [...new Set(boards)];
}

function isSpanish(spec: AgentSpec): boolean {
  return /(ci[oó]n|empleo|oferta|espa[nñ]a|remoto|madrid|barcelona|salario)/i.test(
    `${spec.prompt} ${spec.filters.criteria}`
  );
}

/**
 * Genera consultas dinámicas por fuente del sector: combina las palabras clave
 * del objetivo con `site:` de cada portal relevante. Excluye las ya usadas.
 */
export function sectorExpansionQueries(
  spec: AgentSpec,
  alreadyUsed: Set<string>,
  count: number
): string[] {
  if (count <= 0) return [];
  if (isGrantTarget(spec) || !isJobTarget(spec)) return [];
  const core = coreKeywords(spec);
  if (!core) return [];

  const out: string[] = [];
  const push = (q: string) => {
    const norm = q.trim().toLowerCase();
    if (!norm || alreadyUsed.has(norm) || out.some((x) => x.toLowerCase() === norm)) return;
    out.push(q.trim());
  };

  const boards = isJobTarget(spec) ? sectorBoards(spec) : [];
  const es = isSpanish(spec);

  for (const board of boards) {
    push(`site:${board} ${core}`);
    if (out.length >= count) return out.slice(0, count);
  }

  // Variaciones sin site: para ampliar cobertura general.
  const variants = es
    ? [`${core} ofertas empleo`, `${core} vacante remoto`, `contratar ${core}`, `${core} empleo 2026`]
    : [`${core} job openings`, `${core} hiring remote`, `${core} careers`, `${core} vacancy 2026`];
  for (const v of variants) {
    push(v);
    if (out.length >= count) break;
  }

  return out.slice(0, count);
}
