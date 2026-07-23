/**
 * Sector / impact news query packs and portal seeds (generic; AU BFG defaults).
 */
export function sectorNewsQueryPack(prompt: string, max = 20): string[] {
  const core = prompt.replace(/\s+/g, " ").trim().slice(0, 140);
  const year = new Date().getFullYear();
  const base = [
    `${core} news ${year}`,
    `${core} announcement ${year}`,
    `social enterprise news Australia ${year}`,
    `B Corp Australia news ${year}`,
    `impact investing Australia ${year}`,
    `philanthropy Australia news ${year}`,
    `First Nations enterprise news Australia ${year}`,
    `nonprofit sector Australia funding news ${year}`,
    `ESG social procurement Australia ${year}`,
    `charity merger Australia ${year}`,
    `site:probonoaustralia.com.au`,
    `site:communitydirectors.com.au news`,
    `site:socialenterprise.org.au`,
    `site:philanthropy.org.au news`,
  ];
  if (core) {
    base.unshift(`${core} last 30 days`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of base) {
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

export function sectorNewsPortalSeeds(): { title: string; url: string; snippet: string }[] {
  return [
    {
      title: "Pro Bono Australia — News",
      url: "https://probonoaustralia.com.au/news/",
      snippet: "Sector news portal seed",
    },
    {
      title: "Social Enterprise Australia",
      url: "https://www.socialenterprise.org.au/news",
      snippet: "Sector news portal seed",
    },
    {
      title: "Philanthropy Australia — News",
      url: "https://www.philanthropy.org.au/news/",
      snippet: "Sector news portal seed",
    },
    {
      title: "Community Directors — News",
      url: "https://www.communitydirectors.com.au/news",
      snippet: "Sector news portal seed",
    },
    {
      title: "Impact Investing Australia",
      url: "https://impactinvestingaustralia.com/",
      snippet: "Sector news portal seed",
    },
  ];
}
