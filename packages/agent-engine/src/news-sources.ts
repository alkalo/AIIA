/**
 * Sector / impact news query packs and portal seeds.
 * Defaults to multi-region (AU + global impact press) when the prompt is not locale-locked.
 */

function newsLocale(prompt: string): { au: boolean; es: boolean; eu: boolean; global: boolean } {
  const au = /australia|australian|\bau\b/i.test(prompt);
  const es = /spain|españa|español/i.test(prompt);
  const eu = /europe|\beu\b|european/i.test(prompt);
  const global =
    /global|worldwide|international/i.test(prompt) || (!au && !es && !eu);
  return { au, es, eu, global };
}

export function sectorNewsQueryPack(prompt: string, max = 20): string[] {
  const core = prompt.replace(/\s+/g, " ").trim().slice(0, 140);
  const year = new Date().getFullYear();
  const loc = newsLocale(prompt);
  const base: string[] = [
    `${core} news ${year}`,
    `${core} announcement ${year}`,
  ];
  if (core) base.unshift(`${core} last 30 days`);

  if (loc.au || loc.global) {
    base.push(
      `social enterprise news Australia ${year}`,
      `B Corp Australia news ${year}`,
      `impact investing Australia ${year}`,
      `philanthropy Australia news ${year}`,
      `First Nations enterprise news Australia ${year}`,
      `nonprofit sector Australia funding news ${year}`,
      `ESG social procurement Australia ${year}`,
      `site:probonoaustralia.com.au`,
      `site:communitydirectors.com.au news`,
      `site:socialenterprise.org.au`,
      `site:philanthropy.org.au news`
    );
  }
  if (loc.eu || loc.global) {
    base.push(
      `European social enterprise news ${year}`,
      `impact investing Europe news ${year}`,
      `site:euractiv.com social economy`
    );
  }
  if (loc.es || loc.global) {
    base.push(
      `economía social noticias España ${year}`,
      `emprendeduría social noticias ${year}`
    );
  }
  if (loc.global) {
    base.push(
      `global impact investing news ${year}`,
      `nonprofit funding news ${year}`,
      `site:ssir.org`,
      `site:devex.com news`
    );
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

export function sectorNewsPortalSeeds(
  prompt = ""
): { title: string; url: string; snippet: string }[] {
  const loc = newsLocale(prompt);
  const seeds: { title: string; url: string; snippet: string }[] = [];

  if (loc.au || loc.global) {
    seeds.push(
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
      }
    );
  }
  if (loc.global || loc.eu) {
    seeds.push(
      {
        title: "Stanford Social Innovation Review",
        url: "https://ssir.org/",
        snippet: "Sector news portal seed — global",
      },
      {
        title: "Devex — News",
        url: "https://www.devex.com/news",
        snippet: "Sector news portal seed — global development",
      }
    );
  }
  if (loc.es || loc.global) {
    seeds.push({
      title: "Compromiso Empresarial",
      url: "https://www.compromisoempresarial.com/",
      snippet: "Sector news portal seed — ES",
    });
  }

  if (seeds.length === 0) {
    return sectorNewsPortalSeeds("global");
  }
  return seeds;
}
