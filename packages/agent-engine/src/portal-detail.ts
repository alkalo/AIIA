/**
 * Deterministic field extraction from known portal detail pages.
 * Fills gaps left by LLM extract (deadline, organization, program_name, funding).
 */
import { matchPortalParser, type PortalParserId } from "./portal-parsers.js";
import { parseDeadline } from "./deadline.js";

export interface PortalDetailFields {
  title?: string;
  organization?: string;
  program_name?: string;
  deadline?: string;
  max_funding?: string;
  description?: string;
  scope?: string;
  parser?: PortalParserId | "generic-detail";
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`,
      "i"
    );
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1]).trim();
    const re2 = new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`,
      "i"
    );
    const m2 = re2.exec(html);
    if (m2?.[1]) return decodeEntities(m2[1]).trim();
  }
  return "";
}

function labelValue(html: string, labels: RegExp): string {
  // <th>Closing Date</th><td>…</td> or <dt>…</dt><dd>…
  const block = html.replace(/\s+/g, " ");
  const re = new RegExp(
    `(?:${labels.source})[^<]{0,40}</(?:th|dt|label|span|strong|b)>\\s*</?\\w*[^>]*>\\s*([^<]{3,120})`,
    "i"
  );
  const m = re.exec(block);
  if (m?.[1]) return decodeEntities(stripTags(m[1])).trim();

  // Plain text: "Closing date: 30 July 2026"
  const text = stripTags(html);
  const plain = new RegExp(
    `(?:${labels.source})\\s*[:\\-–]?\\s*([A-Za-z0-9][^\\n|]{2,80})`,
    "i"
  ).exec(text);
  if (plain?.[1]) {
    return plain[1].replace(/\s{2,}/g, " ").trim().slice(0, 100);
  }
  return "";
}

function firstHeading(html: string): string {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1?.[1]) return decodeEntities(stripTags(h1[1])).slice(0, 160);
  const og = metaContent(html, ["og:title", "twitter:title"]);
  if (og) return og.slice(0, 160);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title?.[1]) return decodeEntities(stripTags(title[1])).slice(0, 160);
  return "";
}

function normalizeDeadline(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (/rolling|ongoing|open.?ended|continuo|sin fecha/i.test(cleaned)) return "rolling";
  const parsed = parseDeadline(cleaned);
  if (parsed) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return cleaned.slice(0, 80);
}

/** GrantConnect AU detail page */
export function extractGrantConnectDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "grantconnect-au" };
  const title = firstHeading(html);
  if (title && !/^grantconnect|grants\.gov\.au/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const agency =
    labelValue(html, /Agency|Organisation|Organization|Administered by|Funder/i) ||
    metaContent(html, ["og:site_name"]);
  if (agency) out.organization = agency.slice(0, 120);

  const close =
    labelValue(
      html,
      /Close(?:ing)?\s*Date|Application\s*close|Deadline|Closes|Closing/
    ) || labelValue(html, /End\s*Date|Submission\s*deadline/);
  if (close) out.deadline = normalizeDeadline(close);

  const funding = labelValue(html, /Total\s*Amount|Estimated\s*Grant|Funding|Amount|Value/);
  if (funding) out.max_funding = funding.slice(0, 80);

  const desc =
    metaContent(html, ["og:description", "description"]) ||
    labelValue(html, /Purpose|Description|Overview|Summary/);
  if (desc) out.description = desc.slice(0, 400);

  const scope = labelValue(html, /Location|Jurisdiction|Coverage|Eligible\s*location/);
  if (scope) out.scope = scope.slice(0, 60);

  return out;
}

/** Grants.gov US detail page */
export function extractGrantsGovDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "grants-gov-us" };
  const title =
    labelValue(html, /Opportunity\s*Title|Funding\s*Opportunity\s*Title/) || firstHeading(html);
  if (title && !/^grants\.gov/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const agency = labelValue(html, /Agency|Department|Organization|Funding\s*Organization/);
  if (agency) out.organization = agency.slice(0, 120);

  const close =
    labelValue(html, /Close\s*Date|Application\s*Due|Archive\s*Date|Deadline/) ||
    /CloseDate["\s:>]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(
      html
    )?.[1];
  if (close) out.deadline = normalizeDeadline(close);

  const funding = labelValue(html, /Award\s*Ceiling|Estimated\s*Total|Funding|Award\s*Floor/);
  if (funding) out.max_funding = funding.slice(0, 80);

  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);

  return out;
}

/** EU Funding & Tenders / CORDIS-ish detail */
export function extractEuFundingDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "eu-funding-tenders" };
  const title = firstHeading(html);
  if (title && !/^funding.?tenders|cordis/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const org = labelValue(html, /Programme|Programme\s*name|Organisation|Call\s*title/);
  if (org) out.organization = org.slice(0, 120);

  const close = labelValue(html, /Deadline|Closing\s*date|Submission\s*deadline|Call\s*deadline/);
  if (close) out.deadline = normalizeDeadline(close);

  const funding = labelValue(html, /Budget|Total\s*budget|EU\s*contribution|Funding/);
  if (funding) out.max_funding = funding.slice(0, 80);

  out.scope = out.scope || "EU";
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);

  return out;
}

/** Generic deadline/org scrape when host is unknown but page looks like a call */
export function extractGenericOpportunityDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "generic-detail" };
  const title = firstHeading(html);
  if (title) {
    out.title = title;
    out.program_name = title;
  }
  const close = labelValue(
    html,
    /Deadline|Closing\s*date|Application\s*close|Closes|Close\s*date|Fecha\s*l[ií]mite|Cierre/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const org = labelValue(
    html,
    /Organisation|Organization|Funder|Agency|Funded\s*by|Entidad|Organismo/
  );
  if (org) out.organization = org.slice(0, 120);
  return out;
}

/** ADB project / opportunity detail */
export function extractAdbDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "adb-asia", scope: "Asia" };
  const title = firstHeading(html);
  if (title && !/^asian development bank|^adb$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "Asian Development Bank";
  const close = labelValue(
    html,
    /Closing\s*Date|Approval\s*Date|Deadline|Status\s*Date|Expected\s*Approval/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Total\s*Cost|ADB\s*Financing|Amount|Commitment|OCR/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Location|Region/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** IDB / BID news or project detail */
export function extractIdbDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "idb-latam", scope: "LATAM" };
  const title = firstHeading(html);
  if (title && !/^inter-american|^idb|^bid$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "Inter-American Development Bank";
  const close = labelValue(html, /Deadline|Closing|Publication\s*Date|Date|Fecha/);
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Amount|Financing|Loan|Budget|Monto/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Pa[ií]s|Region/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** Funds for NGOs / Candid article listing */
export function extractFundsForNgosDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "fundsforngos" };
  const title = firstHeading(html);
  if (title && !/^funds\s*for\s*ngos|^candid$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const org =
    labelValue(html, /Donor|Funder|Organization|Organisation|Funded\s*by|Grantor/) ||
    (/candid\.org/i.test(html) ? "Candid" : "");
  if (org) out.organization = org.slice(0, 120);
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Application\s*Deadline|Last\s*Date|Closes/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Grant\s*Size|Funding\s*Amount|Award|Budget/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  return out;
}

/** GOV.UK / National Lottery grant detail */
export function extractGovUkDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "govuk-grants", scope: "UK" };
  const title = firstHeading(html);
  if (title && !/^gov\.uk|^home$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const org = labelValue(
    html,
    /Organisation|Organization|From|Published\s*by|Funder|Funded\s*by|Department/
  );
  if (org) out.organization = org.slice(0, 120);
  else if (/tnlcommunityfund/i.test(html)) out.organization = "National Lottery Community Fund";

  const close = labelValue(
    html,
    /Closing\s*date|Deadline|Application\s*deadline|Closes|Close\s*date|Open\s*until/
  );
  if (close) out.deadline = normalizeDeadline(close);

  const funding = labelValue(html, /Funding|Grant\s*size|Award|Value|Amount/);
  if (funding) out.max_funding = funding.slice(0, 80);

  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  return out;
}

/** African Development Bank project / opportunity detail */
export function extractAfdbDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "afdb-africa", scope: "Africa" };
  const title = firstHeading(html);
  if (title && !/^african development bank|^afdb$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "African Development Bank";
  const close = labelValue(
    html,
    /Closing\s*Date|Deadline|Approval\s*Date|Board\s*Approval|Status\s*Date|Publication\s*Date/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(
    html,
    /Total\s*Cost|AfDB\s*Financing|Amount|Commitment|Loan\s*Amount|Grant\s*Amount/
  );
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Location|Region|Borrower/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** World Bank project / opportunity detail */
export function extractWorldBankDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "worldbank-global", scope: "Global" };
  const title = firstHeading(html);
  if (title && !/^world\s*bank|^the\s*world\s*bank$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "World Bank";
  const close = labelValue(
    html,
    /Closing\s*Date|Deadline|Approval\s*Date|Board\s*Approval|Status\s*Date|Last\s*Updated/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(
    html,
    /Total\s*Project\s*Cost|Commitment\s*Amount|IBRD|IDA|Amount|Financing|Budget/
  );
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Region|Location/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** UNDP funding / project / news detail */
export function extractUndpDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "undp-global", scope: "Global" };
  const title = firstHeading(html);
  if (title && !/^undp$|^united nations development/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "United Nations Development Programme";
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Application\s*Deadline|Submission\s*Deadline|Close\s*Date|Due\s*Date/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Budget|Funding|Amount|Grant\s*Size|Total\s*Cost|Commitment/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Region|Location|Office/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** Islamic Development Bank project / opportunity detail */
export function extractIsdbDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "isdb-mena", scope: "MENA" };
  const title = firstHeading(html);
  if (title && !/^islamic development bank|^isdb$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "Islamic Development Bank";
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Approval\s*Date|Publication\s*Date|Status\s*Date/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Amount|Financing|Mode\s*of\s*Finance|Budget|Commitment|Approved/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Member\s*Country|Region|Location/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** Canada.ca / Community Foundations / IDRC detail */
export function extractCanadaDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "canada-grants", scope: "Canada" };
  const title = firstHeading(html);
  if (title && !/^canada\.ca|^government of canada|^home$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const org = labelValue(
    html,
    /Organisation|Organization|Department|From|Published\s*by|Funder|Funded\s*by|Issued\s*by/
  );
  if (org) out.organization = org.slice(0, 120);
  else if (/idrc-crdi/i.test(html)) out.organization = "IDRC";
  else if (/communityfoundations/i.test(html)) out.organization = "Community Foundations of Canada";
  else out.organization = "Government of Canada";

  const close = labelValue(
    html,
    /Closing\s*date|Deadline|Application\s*deadline|Closes|Close\s*date|Open\s*until|Date\s*de\s*cl[oô]ture/
  );
  if (close) out.deadline = normalizeDeadline(close);

  const funding = labelValue(
    html,
    /Funding|Grant\s*size|Award|Value|Amount|Maximum|Financement|Montant/
  );
  if (funding) out.max_funding = funding.slice(0, 80);

  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  return out;
}

/** NZ Community Matters / govt.nz funding detail */
export function extractNzDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "nz-grants", scope: "New Zealand" };
  const title = firstHeading(html);
  if (title && !/^community matters|^new zealand government|^home$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const org = labelValue(
    html,
    /Organisation|Organization|From|Published\s*by|Funder|Funded\s*by|Department|Agency/
  );
  if (org) out.organization = org.slice(0, 120);
  else if (/communitymatters/i.test(html)) out.organization = "Community Matters";
  else out.organization = "New Zealand Government";

  const close = labelValue(
    html,
    /Closing\s*date|Deadline|Application\s*deadline|Closes|Close\s*date|Open\s*until|Applications\s*close/
  );
  if (close) out.deadline = normalizeDeadline(close);

  const funding = labelValue(html, /Funding|Grant\s*size|Award|Value|Amount|Maximum/);
  if (funding) out.max_funding = funding.slice(0, 80);

  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  return out;
}

/** BOE / sede / CDTI convocatoria detail */
export function extractEsDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "es-grants", scope: "España" };
  const title = firstHeading(html);
  if (title && !/^boe$|^bolet[ií]n oficial|^sede$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  const org = labelValue(
    html,
    /Organismo|Ministerio|Departamento|Entidad|Convocante|Organismo\s*convocante|From|Published\s*by/
  );
  if (org) out.organization = org.slice(0, 120);
  else if (/cdti\.es/i.test(html)) out.organization = "CDTI";
  else if (/boe\.es/i.test(html)) out.organization = "BOE / Administración General del Estado";

  const close = labelValue(
    html,
    /Fecha\s*l[ií]mite|Plazo|Deadline|Closing\s*date|Fin\s*de\s*plazo|Fecha\s*de\s*finalizaci[oó]n|Presentaci[oó]n\s*hasta/
  );
  if (close) out.deadline = normalizeDeadline(close);

  const funding = labelValue(
    html,
    /Importe|Cuant[ií]a|Presupuesto|Dotaci[oó]n|Funding|Amount|Ayuda\s*m[aá]xima/
  );
  if (funding) out.max_funding = funding.slice(0, 80);

  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  return out;
}

/** CEPAL / ECLAC project / event / funding detail */
export function extractCepalDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "cepal-latam", scope: "LATAM" };
  const title = firstHeading(html);
  if (title && !/^cepal$|^eclac$|^economic commission/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "CEPAL / ECLAC";
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Fecha\s*l[ií]mite|Publication\s*Date|Fecha\s*de\s*publicaci[oó]n|Due\s*Date/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Amount|Funding|Budget|Monto|Presupuesto|Financing|Financiamiento/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Pa[ií]s|Region|Regi[oó]n|Location/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** CAF — Development Bank of Latin America detail */
export function extractCafDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "caf-latam", scope: "LATAM" };
  const title = firstHeading(html);
  if (title && !/^caf$|^banco de desarrollo/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "CAF — Development Bank of Latin America";
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Fecha\s*l[ií]mite|Publication\s*Date|Fecha\s*de\s*publicaci[oó]n|Due\s*Date/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Amount|Funding|Budget|Monto|Presupuesto|Financing|Financiamiento|Loan/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Pa[ií]s|Region|Regi[oó]n|Location/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** UNECA project / event / news detail */
export function extractUnecaDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "uneca-africa", scope: "Africa" };
  const title = firstHeading(html);
  if (title && !/^uneca$|^economic commission for africa|^eca$/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "UNECA — UN Economic Commission for Africa";
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Publication\s*Date|Due\s*Date|Event\s*Date|Date/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Amount|Funding|Budget|Financing|Grant/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Region|Location|Member\s*State/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** UNESCWA project / event / funding detail */
export function extractUnescwaDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "unescwa-mena", scope: "MENA" };
  const title = firstHeading(html);
  if (title && !/^unescwa$|^escwa$|^economic and social commission/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "UNESCWA — UN Economic and Social Commission for Western Asia";
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Publication\s*Date|Due\s*Date|Event\s*Date|Date/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(html, /Amount|Funding|Budget|Financing|Grant/);
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Region|Location|Member\s*State/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** EBRD procurement / project / news detail */
export function extractEbrdDetail(html: string): PortalDetailFields {
  const out: PortalDetailFields = { parser: "ebrd-mena", scope: "MENA/Europe" };
  const title = firstHeading(html);
  if (title && !/^ebrd$|^european bank for reconstruction/i.test(title)) {
    out.title = title;
    out.program_name = title;
  }
  out.organization = "European Bank for Reconstruction and Development";
  const close = labelValue(
    html,
    /Deadline|Closing\s*Date|Submission\s*Deadline|Publication\s*Date|Due\s*Date|Issue\s*Date|Closing/
  );
  if (close) out.deadline = normalizeDeadline(close);
  const funding = labelValue(
    html,
    /Amount|Funding|Budget|Contract\s*Value|Estimated\s*Value|Project\s*Value|Financing/
  );
  if (funding) out.max_funding = funding.slice(0, 80);
  const desc = metaContent(html, ["og:description", "description"]);
  if (desc) out.description = desc.slice(0, 400);
  const country = labelValue(html, /Country|Countries|Region|Location|Client|Borrower/);
  if (country) out.scope = country.slice(0, 60);
  return out;
}

/** Compact hints injected into the LLM extract prompt (pre-fill). */
export function formatPortalDetailHints(portal: PortalDetailFields | null | undefined): string {
  if (!portalDetailHasSignal(portal) || !portal) return "";
  const parts: string[] = [];
  if (portal.program_name || portal.title) {
    parts.push(`program_name: ${portal.program_name || portal.title}`);
  }
  if (portal.organization) parts.push(`organization: ${portal.organization}`);
  if (portal.deadline) parts.push(`deadline: ${portal.deadline}`);
  if (portal.max_funding) parts.push(`max_funding: ${portal.max_funding}`);
  if (portal.scope) parts.push(`scope: ${portal.scope}`);
  return `Structured fields already parsed from this portal page (prefer these when content agrees; fill gaps only):\n${parts.join("\n")}`;
}

/**
 * Extract structured fields from portal HTML when a dedicated parser matches,
 * otherwise a light generic pass if the page looks like an opportunity detail.
 */
export function extractPortalDetails(html: string, pageUrl: string): PortalDetailFields | null {
  if (!html || html.length < 200) return null;
  const parserId = matchPortalParser(pageUrl);

  if (parserId === "grantconnect-au") return extractGrantConnectDetail(html);
  if (parserId === "grants-gov-us") return extractGrantsGovDetail(html);
  if (parserId === "eu-funding-tenders") return extractEuFundingDetail(html);
  if (parserId === "adb-asia") return extractAdbDetail(html);
  if (parserId === "idb-latam") return extractIdbDetail(html);
  if (parserId === "fundsforngos") return extractFundsForNgosDetail(html);
  if (parserId === "govuk-grants") return extractGovUkDetail(html);
  if (parserId === "afdb-africa") return extractAfdbDetail(html);
  if (parserId === "worldbank-global") return extractWorldBankDetail(html);
  if (parserId === "undp-global") return extractUndpDetail(html);
  if (parserId === "isdb-mena") return extractIsdbDetail(html);
  if (parserId === "canada-grants") return extractCanadaDetail(html);
  if (parserId === "nz-grants") return extractNzDetail(html);
  if (parserId === "es-grants") return extractEsDetail(html);
  if (parserId === "cepal-latam") return extractCepalDetail(html);
  if (parserId === "caf-latam") return extractCafDetail(html);
  if (parserId === "uneca-africa") return extractUnecaDetail(html);
  if (parserId === "unescwa-mena") return extractUnescwaDetail(html);
  if (parserId === "ebrd-mena") return extractEbrdDetail(html);

  // Detail-ish URLs on known hosts
  if (
    /\/go\/show|search-results-detail|topic-details|opportunity-details|view-opportunity|\/projects\/|\/proyectos\/|\/news\/|\/noticias\/|\/stories\/|\/events?\/|\/grants\/|\/funding\/|\/financiamient|\/projects-and-operations\/|\/projects-operations\/|\/opportunities|\/procurement|\/notices?\/|\/calls-for|\/diario_boe\/|txt\.php\?id=BOE|\/ayudas\/|\/convocatorias|\/currently\/|\/actualidad\/|\/publications?\/|\/work-with-us\//i.test(
      pageUrl
    )
  ) {
    if (/grants\.gov\.au/i.test(pageUrl)) return extractGrantConnectDetail(html);
    if (/grants\.gov/i.test(pageUrl)) return extractGrantsGovDetail(html);
    if (/europa\.eu/i.test(pageUrl)) return extractEuFundingDetail(html);
    if (/afdb\.org/i.test(pageUrl)) return extractAfdbDetail(html);
    if (/(^|\.)adb\.org/i.test(pageUrl) && !/iadb\.org|afdb\.org/i.test(pageUrl)) {
      return extractAdbDetail(html);
    }
    if (/iadb\.org|bid\.org/i.test(pageUrl)) return extractIdbDetail(html);
    if (/worldbank\.org|worldbankgroup\.org/i.test(pageUrl)) return extractWorldBankDetail(html);
    if (/undp\.org/i.test(pageUrl)) return extractUndpDetail(html);
    if (/isdb\.org/i.test(pageUrl)) return extractIsdbDetail(html);
    if (/fundsforngos\.org|candid\.org/i.test(pageUrl)) return extractFundsForNgosDetail(html);
    if (/\.gov\.uk|tnlcommunityfund/i.test(pageUrl)) return extractGovUkDetail(html);
    if (/canada\.ca|communityfoundations\.ca|idrc-crdi\.ca/i.test(pageUrl)) {
      return extractCanadaDetail(html);
    }
    if (/govt\.nz|communitymatters/i.test(pageUrl)) return extractNzDetail(html);
    if (/boe\.es|administracion\.gob\.es|cdti\.es/i.test(pageUrl)) return extractEsDetail(html);
    if (/cepal\.org|eclac\.org/i.test(pageUrl)) return extractCepalDetail(html);
    if (/caf\.com/i.test(pageUrl)) return extractCafDetail(html);
    if (/uneca\.org/i.test(pageUrl)) return extractUnecaDetail(html);
    if (/unescwa\.org/i.test(pageUrl)) return extractUnescwaDetail(html);
    if (/ebrd\.com/i.test(pageUrl)) return extractEbrdDetail(html);
  }

  if (
    /deadline|closing date|close date|fecha l[ií]mite|application due/i.test(html) &&
    /grant|funding|opportunity|fellowship|award|convocatoria|subvenci/i.test(html)
  ) {
    const g = extractGenericOpportunityDetail(html);
    if (g.deadline || g.organization) return g;
  }

  return null;
}

/** Merge portal fields into LLM extract — portal fills empties; never wipe LLM values. */
export function mergePortalDetails(
  item: Record<string, unknown>,
  portal: PortalDetailFields | null | undefined
): Record<string, unknown> {
  if (!portal) return item;
  const next: Record<string, unknown> = { ...item };
  const fill = (key: string, value?: string) => {
    if (!value) return;
    const cur = next[key];
    if (cur == null || String(cur).trim() === "") next[key] = value;
  };
  fill("title", portal.title);
  fill("organization", portal.organization);
  fill("program_name", portal.program_name);
  fill("deadline", portal.deadline);
  fill("max_funding", portal.max_funding);
  fill("description", portal.description);
  fill("summary", portal.description);
  fill("scope", portal.scope);
  if (portal.parser) {
    const reason = String(next.reason ?? "");
    const tag = `portal-detail:${portal.parser}`;
    if (!reason.includes(tag)) {
      next.reason = reason ? `${reason} | ${tag}` : tag;
    }
  }
  return next;
}

/** True when portal extract found at least one high-value field. */
export function portalDetailHasSignal(d: PortalDetailFields | null | undefined): boolean {
  if (!d) return false;
  return Boolean(d.deadline || d.organization || d.program_name || d.max_funding);
}
