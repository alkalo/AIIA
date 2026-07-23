/**
 * Opportunity discovery query packs beyond pure grants (programs, awards, exposure).
 * Region-aware: global / multi-region by default when the prompt asks for worldwide coverage.
 */

function detectLaneRegions(prompt: string): {
  au: boolean;
  nz: boolean;
  eu: boolean;
  uk: boolean;
  us: boolean;
  es: boolean;
  global: boolean;
} {
  const p = prompt;
  const au = /australia|australian|\bau\b/i.test(p);
  const nz = /new zealand|\bnz\b/i.test(p);
  const eu = /europe|\beu\b|horizon|european/i.test(p);
  const uk = /\buk\b|united kingdom|british/i.test(p);
  const us = /\busa\b|\bus\b|united states/i.test(p);
  const es = /spain|españa|español/i.test(p);
  const global =
    /global|worldwide|international|exhaustiv|all countries|multi-?country/i.test(p) ||
    (!au && !nz && !eu && !uk && !us && !es);
  return { au, nz, eu, uk, us, es, global };
}

export function opportunityDiscoveryQueries(
  prompt: string,
  category: "funding" | "program_fellowship" | "award_competition" | "exposure" | "all",
  max = 24
): string[] {
  const core = prompt.replace(/\s+/g, " ").trim().slice(0, 120);
  const year = new Date().getFullYear();
  const r = detectLaneRegions(prompt);
  const wide = r.global || [r.au, r.nz, r.eu, r.uk, r.us, r.es].filter(Boolean).length >= 2;

  const funding: string[] = [
    `${core} grant open ${year}`,
    `${core} funding opportunity open ${year}`,
    `site:fundsforngos.org ${core}`.trim(),
    `site:devex.com funding ${year}`,
  ];
  if (r.au || wide) {
    funding.push(
      `site:grants.gov.au open grant`,
      `site:business.gov.au/grants`,
      `${core} funding opportunity Australia open`,
      `philanthropy Australia grant open ${year}`
    );
  }
  if (r.eu || wide) {
    funding.push(`EU funding open call ${year}`, `site:ec.europa.eu/info/funding-tenders open`);
  }
  if (r.uk || wide) {
    funding.push(`UK community grant open ${year}`, `site:gov.uk grant funding`);
  }
  if (r.us || wide) {
    funding.push(`site:grants.gov open opportunity`, `US nonprofit grant open ${year}`);
  }
  if (r.es || wide) {
    funding.push(`convocatoria subvención abierta ${year}`, `site:boe.es subvenciones`);
  }
  if (r.nz || wide) {
    funding.push(`New Zealand community grant open ${year}`);
  }

  const program_fellowship: string[] = [
    `${core} accelerator applications open ${year}`,
    `${core} fellowship apply ${year}`,
    `impact fellowship applications open`,
    `social enterprise incubator cohort ${year}`,
  ];
  if (r.au || wide) {
    program_fellowship.push(
      `${core} fellowship Australia apply ${year}`,
      `startup accelerator Australia social impact apply`
    );
  }
  if (r.eu || wide) {
    program_fellowship.push(`European fellowship applications open ${year}`);
  }
  if (r.us || wide) {
    program_fellowship.push(`US social impact fellowship apply ${year}`);
  }

  const award_competition: string[] = [
    `${core} award nominations open ${year}`,
    `impact award applications open ${year}`,
    `pitch competition social enterprise ${year}`,
  ];
  if (r.au || wide) {
    award_competition.push(
      `social enterprise award Australia ${year}`,
      `B Corp award Australia nominations`
    );
  }
  if (wide || r.eu || r.us || r.uk) {
    award_competition.push(`global social impact award nominations ${year}`);
  }

  const exposure: string[] = [
    `${core} call for speakers ${year}`,
    `call for contributors social impact`,
    `media feature opportunity social enterprise`,
    `speaking opportunity nonprofit ${year}`,
  ];
  if (r.au || wide) {
    exposure.push(
      `${core} call for speakers Australia ${year}`,
      `showcase directory purpose-led business Australia`
    );
  }
  if (wide) {
    exposure.push(`call for proposals global summit ${year}`);
  }

  const packs: Record<string, string[]> = {
    funding,
    program_fellowship,
    award_competition,
    exposure,
  };

  const keys =
    category === "all"
      ? (["funding", "program_fellowship", "award_competition", "exposure"] as const)
      : [category];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    for (const q of packs[key]) {
      const k = q.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(q);
      if (out.length >= max) return out;
    }
  }
  return out;
}
