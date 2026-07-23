/**
 * Opportunity discovery query packs beyond pure grants (programs, awards, exposure).
 */
export function opportunityDiscoveryQueries(
  prompt: string,
  category: "funding" | "program_fellowship" | "award_competition" | "exposure" | "all",
  max = 24
): string[] {
  const core = prompt.replace(/\s+/g, " ").trim().slice(0, 120);
  const year = new Date().getFullYear();
  const packs: Record<string, string[]> = {
    funding: [
      `${core} grant open ${year}`,
      `site:grants.gov.au open grant`,
      `site:business.gov.au/grants`,
      `${core} funding opportunity Australia open`,
      `philanthropy Australia grant open ${year}`,
    ],
    program_fellowship: [
      `${core} accelerator applications open ${year}`,
      `${core} fellowship Australia apply ${year}`,
      `social enterprise incubator cohort Australia ${year}`,
      `impact fellowship applications open`,
      `startup accelerator Australia social impact apply`,
    ],
    award_competition: [
      `${core} award nominations open ${year}`,
      `social enterprise award Australia ${year}`,
      `impact award applications open Australia`,
      `pitch competition social enterprise Australia ${year}`,
      `B Corp award Australia nominations`,
    ],
    exposure: [
      `${core} call for speakers Australia ${year}`,
      `call for contributors social impact Australia`,
      `media feature opportunity social enterprise`,
      `showcase directory purpose-led business Australia`,
      `speaking opportunity nonprofit Australia ${year}`,
    ],
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
