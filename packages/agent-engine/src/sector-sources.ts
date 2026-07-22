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

export type JobPortalSeed = { title: string; url: string; snippet: string };

/**
 * Deep-link portal seeds so job agents never finish with zero sources when SERP is blocked.
 * Mirrors chat `opportunity_portal_seeds` / `jobPortalSeeds`.
 */
export function jobPortalDeepLinkSeeds(spec: AgentSpec): JobPortalSeed[] {
  if (!isJobTarget(spec) || isGrantTarget(spec)) return [];
  const core = coreKeywords(spec, 5) || "jobs";
  const enc = encodeURIComponent(core);
  const encEs = encodeURIComponent(
    core.replace(/\bremote\b/gi, "remoto").replace(/\bspain\b/gi, "España")
  );
  const es = isSpanish(spec);
  const seeds: JobPortalSeed[] = [
    {
      title: `LinkedIn Jobs — ${core}`,
      url: `https://www.linkedin.com/jobs/search/?keywords=${enc}${es ? "&location=Spain&f_WT=2" : ""}`,
      snippet: "Portal seed: LinkedIn Jobs search.",
    },
    {
      title: `Indeed — ${core}`,
      url: es
        ? `https://es.indeed.com/jobs?q=${enc}&l=Espa%C3%B1a`
        : `https://www.indeed.com/jobs?q=${enc}`,
      snippet: "Portal seed: Indeed.",
    },
    {
      title: `Remote OK — ${core}`,
      url: `https://remoteok.com/remote-jobs?search=${enc}`,
      snippet: "Portal seed: Remote OK.",
    },
    {
      title: `We Work Remotely — ${core}`,
      url: `https://weworkremotely.com/remote-jobs/search?term=${enc}`,
      snippet: "Portal seed: We Work Remotely.",
    },
  ];
  if (es) {
    seeds.push(
      {
        title: `InfoJobs — ${core}`,
        url: `https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=${encEs}`,
        snippet: "Portal seed: InfoJobs España.",
      },
      {
        title: `Tecnoempleo — ${core}`,
        url: `https://www.tecnoempleo.com/busqueda-empleo.php?te=${encEs}`,
        snippet: "Portal seed: Tecnoempleo.",
      },
      {
        title: `Jooble España — ${core}`,
        url: `https://es.jooble.org/SearchResult?ukw=${enc}`,
        snippet: "Portal seed: Jooble.",
      }
    );
  } else {
    seeds.push({
      title: `Glassdoor — ${core}`,
      url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${enc}`,
      snippet: "Portal seed: Glassdoor.",
    });
  }
  return seeds;
}
