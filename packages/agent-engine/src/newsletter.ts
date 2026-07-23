import type { AgentSpec, ExtractedItem } from "./types.js";
import { isGrantTarget } from "./opportunity-subtype.js";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function looksLikeGrant(item: ExtractedItem): boolean {
  const kind = str(item.item_kind || item.itemKind).toLowerCase();
  if (kind === "news") return false;
  if (kind === "opportunity") return true;
  if (str(item.program_name) || str(item.max_funding) || str(item.deadline)) return true;
  if (str(item.organization) && str(item.description)) return true;
  const blob = `${item.title ?? ""} ${item.summary ?? ""} ${item.description ?? ""} ${item.reason ?? ""}`.toLowerCase();
  return /\b(grant|funding|subvenci|convocatoria|up to \$|up to €|deadline|closing|fellowship|accelerator|award)\b/i.test(blob);
}

/** Drop news older than maxAgeDays when a parseable date exists (grants keep). */
export function isFreshEnough(item: ExtractedItem, maxAgeDays = 35): boolean {
  if (looksLikeGrant(item)) return true;
  const raw = str(item.publication_date) || str(item.date) || str(item.posting_date);
  if (!raw) return true;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return true;
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  return ageDays <= maxAgeDays;
}

function grantBlock(item: ExtractedItem): string {
  const title = str(item.program_name) || str(item.title) || "Untitled grant";
  const funding =
    str(item.max_funding) ||
    str(item.description) ||
    str(item.summary) ||
    str(item.reason) ||
    "Open opportunity — see link for details.";
  const url = str(item.url);
  // BFGN monthly style: title + one funding line (+ optional URL for the human editor)
  return url ? `${title}\n${funding}\n${url}` : `${title}\n${funding}`;
}

function newsBullet(item: ExtractedItem): string {
  const title = str(item.title) || str(item.headline) || "Update";
  const news =
    str(item.summary) ||
    str(item.description) ||
    str(item.the_news) ||
    str(item.reason) ||
    "";
  const url = str(item.url) || str(item.plain_url) || "";
  const line = news ? `${title} — ${news}` : title;
  return url ? `${line}\n${url}` : line;
}

/** Detect wrap-up / newsletter style agents from prompt + destinations. */
export function isNewsletterWrapTarget(spec: AgentSpec): boolean {
  if (spec.output.destinations.includes("email")) return true;
  const blob = `${spec.prompt} ${spec.name} ${spec.filters.criteria}`.toLowerCase();
  return /\b(wrap-?up|newsletter|bolet[ií]n|changemaker|impact news|business for good|bfgn)\b/i.test(
    blob
  );
}

/**
 * BFGN-style plain-text wrap for copy-paste into email.
 * AIIA never sends this — human reviews and pastes.
 */
export function composeNewsletterWrap(
  items: ExtractedItem[],
  spec: AgentSpec,
  options?: { monthLabel?: string; maxGrants?: number; maxNews?: number; maxAgeDays?: number }
): string {
  const month =
    options?.monthLabel ??
    new Date().toLocaleString("en-AU", { month: "long", year: "numeric" });
  const maxGrants = options?.maxGrants ?? 12;
  const maxNews = options?.maxNews ?? 10;
  const maxAgeDays = options?.maxAgeDays ?? 35;

  const fresh = items.filter((i) => isFreshEnough(i, maxAgeDays));
  const grants = fresh.filter(looksLikeGrant).slice(0, maxGrants);
  const news = fresh.filter((i) => !looksLikeGrant(i)).slice(0, maxNews);

  const grantBlockText =
    grants.length > 0
      ? grants.map(grantBlock).join("\n\n")
      : isGrantTarget(spec)
        ? fresh.slice(0, maxGrants).map(grantBlock).join("\n\n")
        : "(No open grant listings found this run — add or re-run with Gemini ultra.)";

  const newsSource =
    grants.length > 0 ? news : isGrantTarget(spec) ? [] : fresh.slice(0, maxNews);
  const newsBlockText =
    newsSource.length > 0
      ? newsSource.map(newsBullet).join("\n\n")
      : "(No sector news ranked this run — review sources or widen the prompt.)";

  const toNote = spec.output.emailTo?.trim()
    ? `\n(Suggested To when you paste: ${spec.output.emailTo.trim()} — AIIA does not send mail.)\n`
    : "";

  return [
    `${month}`,
    spec.name,
    toNote,
    `Hi,`,
    "",
    `The wrap-up is here!`,
    `Don't miss the opportunities and news we've gathered for you.`,
    "",
    `--- Open grants & funding ---`,
    "",
    grantBlockText,
    "",
    `--- Business for good news wrap-up ---`,
    "",
    newsBlockText,
    "",
    `---`,
    `DRAFT ONLY — review before sending. AIIA never emails automatically.`,
    `Generated ${new Date().toISOString().slice(0, 10)} · Agent: ${spec.name}`,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

/**
 * @deprecated Kept for tests/compat. Prefer plain .txt copy-paste; AIIA does not send mail.
 */
export function buildEmlDraft(options: {
  subject: string;
  body: string;
  to?: string;
  from?: string;
}): string {
  const to = options.to?.trim() || "undisclosed-recipients:;";
  const from = options.from?.trim() || "AIIA <aiia@localhost>";
  const subject = options.subject.replace(/[\r\n]+/g, " ").slice(0, 180);
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    `X-Mailer: AIIA`,
    `X-AIIA-Draft: copy-paste-only-do-not-auto-send`,
    ``,
    options.body.replace(/\n/g, "\r\n"),
    ``,
  ].join("\r\n");
}
