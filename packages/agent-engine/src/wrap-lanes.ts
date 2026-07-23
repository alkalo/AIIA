/**
 * BFGN-style multi-lane query packs (mirrors Workspace Studio 1A–1D).
 */
export function wrapResearchLanes(prompt: string): { name: string; queries: string[] }[] {
  const core = prompt.replace(/\s+/g, " ").trim().slice(0, 120);
  const year = new Date().getFullYear();
  return [
    {
      name: "government_grants_policy",
      queries: [
        `${core} Australia government grant open ${year}`,
        `site:grants.gov.au open grant`,
        `site:business.gov.au/grants community`,
        `Australia social enterprise policy funding ${year}`,
      ],
    },
    {
      name: "social_enterprise_bfg",
      queries: [
        `${core} social enterprise Australia news ${year}`,
        `B Corp Australia announcement ${year}`,
        `First Nations enterprise funding Australia`,
        `WISE inclusive employment Australia grant`,
      ],
    },
    {
      name: "charity_ngo_philanthropy",
      queries: [
        `philanthropy Australia grant open ${year}`,
        `site:frrr.org.au funding`,
        `site:philanthropy.org.au grant`,
        `charity nonprofit merger Australia ${year}`,
      ],
    },
    {
      name: "esg_impact_investing",
      queries: [
        `impact investing Australia ${year}`,
        `ESG social procurement Australia`,
        `social finance foundation Australia funding`,
        `corporate partnership social enterprise Australia`,
      ],
    },
  ];
}

export function flattenWrapLaneQueries(
  prompt: string,
  max = 24
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lane of wrapResearchLanes(prompt)) {
    for (const q of lane.queries) {
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= max) return out;
    }
  }
  return out;
}
