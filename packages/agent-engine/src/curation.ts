/**
 * Generic curation pipeline for opportunities + sector news.
 * Tuned for BFGN-quality rules but usable for any locale/sector via AgentSpec filters.
 */
import type { AgentSpec, ExtractedItem, OpportunitySubtype } from "./types.js";
import {
  isGrantTarget,
  isSectorNewsTarget,
  isCurationOpportunityTarget,
  resolveOpportunitySubtype,
} from "./opportunity-subtype.js";
import { daysUntilDeadline, isExpiredDeadline, parseDeadline } from "./deadline.js";
import { isFreshEnough, isNewsletterWrapTarget } from "./newsletter.js";
import {
  isDirectGrantUrl,
  isLowQualityGrantUrl,
  resolveOpportunityUrl,
  sanitizeFieldValue,
} from "./result-quality.js";
import { hasCoverageProvenance } from "./coverage-markers.js";
import { canonicalUrl, opportunityContentKey } from "./canonical-url.js";

export type ItemKind = "opportunity" | "news" | "other";
export type OpportunityCategory =
  | "funding"
  | "program_fellowship"
  | "award_competition"
  | "exposure"
  | "other";

export type ReviewStatus = "pending" | "approved" | "rejected" | "archived";

const EXCLUDE_BLOB =
  /\b(invitation[- ]only|internal only|register (your )?interest|waitlist only|closed waitlist)\b/i;

const JOB_EXCLUDE =
  /\b(job opening|we're hiring|vacancy|full[- ]time role|salary range|apply for this job)\b/i;

const EVENT_ONLY =
  /\b(conference|summit|webinar|networking event)\b/i;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function blobOf(item: ExtractedItem): string {
  return [
    item.title,
    item.program_name,
    item.summary,
    item.description,
    item.eligibility,
    item.reason,
    item.category,
    item.opportunity_type,
  ]
    .map(str)
    .join(" ")
    .toLowerCase();
}

/** Normalize URL for fingerprinting (strip tracking params). */
export function normalizeUrlForFingerprint(url: string): string {
  return canonicalUrl(url);
}

export function itemFingerprint(item: ExtractedItem): string {
  const url = normalizeUrlForFingerprint(
    resolveOpportunityUrl(item as Record<string, unknown>) || str(item.url)
  );
  const content = opportunityContentKey(item);
  if (content) return `${url}|${content}`;
  const name = str(item.program_name || item.title || item.headline)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const org = str(item.organization || item.organisation || item.source)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 40);
  return `${url}|${org}|${name}`;
}

export function classifyItemKind(item: ExtractedItem, spec: AgentSpec): ItemKind {
  const explicit = str(item.item_kind || item.itemKind).toLowerCase();
  if (explicit === "news" || explicit === "opportunity") return explicit as ItemKind;
  if (isSectorNewsTarget(spec) && !isGrantTarget(spec)) return "news";

  const b = blobOf(item);
  const hasGrantSignals =
    Boolean(str(item.deadline) || str(item.max_funding) || str(item.program_name)) ||
    /\b(grant|funding|fellowship|accelerator|incubator|award|prize|applications? open|closing date)\b/i.test(
      b
    );
  if (hasGrantSignals && !isSectorNewsTarget(spec)) return "opportunity";

  if (
    /\b(news|announced|launches|report|merger|partnership)\b/i.test(b) ||
    str(item.publication_date)
  ) {
    if (isNewsletterWrapTarget(spec) && !hasGrantSignals) return "news";
    if (isSectorNewsTarget(spec)) return "news";
  }
  if (isCurationOpportunityTarget(spec)) return "opportunity";
  return "other";
}

export function classifyOpportunityCategory(
  item: ExtractedItem,
  spec: AgentSpec
): OpportunityCategory {
  const explicit = str(item.category || item.opportunity_type || item.opportunityType)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    explicit.includes("program") ||
    explicit.includes("fellow") ||
    explicit.includes("accelerator") ||
    explicit.includes("incubator")
  ) {
    return "program_fellowship";
  }
  if (
    explicit.includes("award") ||
    explicit.includes("competition") ||
    explicit.includes("prize") ||
    explicit.includes("challenge")
  ) {
    return "award_competition";
  }
  if (
    explicit.includes("exposure") ||
    explicit.includes("speaking") ||
    explicit.includes("media") ||
    explicit.includes("showcase")
  ) {
    return "exposure";
  }
  if (
    explicit.includes("fund") ||
    explicit.includes("grant") ||
    explicit === "funding"
  ) {
    return "funding";
  }

  const sub = resolveOpportunitySubtype(spec);
  if (sub === "programs") return "program_fellowship";
  if (sub === "awards") return "award_competition";
  if (sub === "exposure") return "exposure";
  if (sub === "grants") return "funding";

  const b = blobOf(item);
  if (/\b(fellowship|accelerator|incubator|cohort|bootcamp|mentoring program)\b/i.test(b)) {
    return "program_fellowship";
  }
  if (/\b(award|competition|pitch (comp|contest)|challenge|prize)\b/i.test(b)) {
    return "award_competition";
  }
  if (/\b(speaking|call for (speakers|contributors)|media feature|showcase|directory listing)\b/i.test(b)) {
    return "exposure";
  }
  return "funding";
}

export function primaryAudienceLabel(item: ExtractedItem, spec: AgentSpec): string {
  const existing = str(item.primary_audience || item.audience);
  if (existing) return existing;
  const b = blobOf(item) + " " + (spec.prompt || "").toLowerCase();
  if (/\bfirst nations\b|\bindigenous\b/i.test(b)) return "First Nations / Indigenous-led";
  if (/\bngo\b|\bnonprofit\b|\bcharity\b/i.test(b)) return "NGO / Nonprofit Leader";
  if (/\bsocial enterprise\b|\bb corp\b/i.test(b)) return "Social Enterprise Founder";
  if (/\bimpact invest/i.test(b)) return "Impact Investor / Impact Fund";
  if (/\bcsr\b|\bsustainability\b/i.test(b)) return "CSR / Sustainability Professional";
  if (/\bregional\b|\brural\b/i.test(b)) return "Regional Changemaker";
  return "Purpose-Led Startup Founder";
}

export interface CurationOptions {
  /** Minimum days remaining before deadline (opportunities). Default 7. */
  minDaysRemaining?: number;
  /** Max age for news items in days. Default 35. */
  maxNewsAgeDays?: number;
  /** Drop items that look like plain jobs when curating opportunities. */
  excludeJobs?: boolean;
  /** Known fingerprints from prior runs (cross-run dedupe). */
  knownFingerprints?: Set<string>;
  now?: Date;
  /**
   * Exhaustive global opportunity/news runs: keep borderline undated / low-signal
   * items for human Inbox review instead of dropping them. For news, also relax
   * freshness by +7 days.
   */
  exhaustiveSoft?: boolean;
}

function defaultMinDays(spec: AgentSpec): number {
  const n = Number(spec.filters?.minDaysRemaining);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}

function defaultNewsAge(spec: AgentSpec): number {
  const n = Number(spec.filters?.maxAgeDays);
  return Number.isFinite(n) && n > 0 ? n : 35;
}

/**
 * Soft editorial score boost (0–20) on top of LLM score.
 * Generic weights: audience fit, value, actionability, AU/geo relevance, clarity.
 */
export function editorialBoost(item: ExtractedItem, spec: AgentSpec): number {
  let boost = 0;
  const b = blobOf(item);
  const prompt = (spec.prompt || "").toLowerCase();

  if (str(item.eligibility) || str(item.primary_audience)) boost += 3;
  if (str(item.max_funding) || str(item.value_or_benefit) || str(item.benefit)) boost += 4;
  if (str(item.deadline) || str(item.status) === "rolling") boost += 3;
  if (/\baustralia\b|\bau\b|\bqueensland\b|\bnational\b/i.test(b + prompt)) boost += 3;
  if (/\bfirst nations\b|\bregional\b|\brural\b|\bwomen[- ]led\b/i.test(b)) boost += 2;
  if (str(item.verification_notes) || item.verified === "yes" || item.verified === 1) boost += 2;
  if (EXCLUDE_BLOB.test(b)) boost -= 10;
  return Math.max(-10, Math.min(20, boost));
}

export function shouldExcludeOpportunity(
  item: ExtractedItem,
  spec: AgentSpec,
  opts: CurationOptions = {}
): string | null {
  const now = opts.now ?? new Date();
  const minDays = opts.minDaysRemaining ?? defaultMinDays(spec);
  const excludeJobs = opts.excludeJobs ?? true;
  const url = resolveOpportunityUrl(item as Record<string, unknown>) || str(item.url);
  const b = blobOf(item);

  if (!url || !/^https?:\/\//i.test(url)) return "missing_official_url";
  const hasConcreteFields =
    Boolean(str(item.program_name) || str(item.title)) &&
    Boolean(str(item.organization) || str(item.max_funding) || str(item.value_or_benefit) || str(item.eligibility));
  const coverage = hasCoverageProvenance(b, item.reason, item.summary, item.description);

  if (url && isLowQualityGrantUrl(url) && !isDirectGrantUrl(url)) {
    // Intentional portal / listing seeds must survive SERP-dead runs.
    if (!coverage) {
      const cat = classifyOpportunityCategory(item, spec);
      if (cat === "funding" && !hasConcreteFields) return "weak_official_url";
    }
  }

  if (EXCLUDE_BLOB.test(b)) return "invitation_or_waitlist";
  if (excludeJobs && JOB_EXCLUDE.test(b) && !/\b(grant|funding|fellowship|award)\b/i.test(b)) {
    return "looks_like_job";
  }
  if (EVENT_ONLY.test(b) && !/\b(call for|applications? open|nominations?|deadline)\b/i.test(b)) {
    return "event_without_open_call";
  }

  const deadline = item.deadline ?? item.closing_date ?? item.closingDate;
  if (isExpiredDeadline(deadline, now)) return "expired";
  const days = daysUntilDeadline(deadline, now);
  // Exhaustive: allow slightly closer deadlines (human can still reject).
  const effectiveMinDays = opts.exhaustiveSoft ? Math.max(0, minDays - 3) : minDays;
  if (days != null && days < effectiveMinDays) return "closing_too_soon";

  // Undated non-rolling: prefer keeping concrete opportunities for human review
  // (exhaustive mode) over dropping them — Inbox can reject.
  const rolling =
    /\b(rolling|ongoing|open now|no deadline)\b/i.test(b) ||
    /^rolling$/i.test(str(item.status));
  if (spec.filters?.requireVerification && !deadline && !rolling && !parseDeadline(deadline)) {
    if (opts.exhaustiveSoft) {
      // Any titled opportunity URL is reviewable in exhaustive global runs.
      if (str(item.program_name) || str(item.title)) return null;
    }
    if (coverage) return null;
    if (isDirectGrantUrl(url)) return null;
    if (hasConcreteFields) return null;
    // Org + title alone is enough for pending review when URL is not a bare homepage.
    if (
      Boolean(str(item.program_name) || str(item.title)) &&
      Boolean(str(item.organization)) &&
      !isLowQualityGrantUrl(url)
    ) {
      return null;
    }
    return "unclear_deadline";
  }

  // Global without AU eligibility when prompt asks AU
  if (/\baustralia\b|\bau\b/i.test(spec.prompt || "") || /\baustralia\b/i.test(spec.filters?.criteria || "")) {
    const elig = str(item.eligibility) + " " + b;
    if (/\b(global|worldwide|international)\b/i.test(elig) && !/\baustralia\b|\bau\b|\baustralian\b/i.test(elig)) {
      if (/\bus[- ]only\b|\buk[- ]only\b|\beu[- ]only\b|\bunited states only\b/i.test(elig)) {
        return "not_au_eligible";
      }
    }
  }

  return null;
}

export function shouldExcludeNews(
  item: ExtractedItem,
  spec: AgentSpec,
  opts: CurationOptions = {}
): string | null {
  const baseAge = opts.maxNewsAgeDays ?? defaultNewsAge(spec);
  // Exhaustive soft: keep slightly older stories for human review.
  const maxAge = opts.exhaustiveSoft ? baseAge + 7 : baseAge;
  if (!isFreshEnough(item, maxAge)) return "stale_news";
  const url = str(item.url);
  if (!url || !/^https?:\/\//i.test(url)) return "missing_url";
  const title = str(item.title || item.headline);
  if (!title || title.length < 8) return "weak_title";
  return null;
}

/**
 * Raise multipass/critic scores that wrongly dump concrete opportunities or news near zero.
 * Exhaustive global runs use softer floors so coverage survives for Inbox review.
 */
export function applyCurationScoreFloor(
  items: ExtractedItem[],
  spec: AgentSpec,
  exhaustive = false
): ExtractedItem[] {
  const oppMode = isGrantTarget(spec) || isCurationOpportunityTarget(spec);
  const newsMode =
    isSectorNewsTarget(spec) && !isGrantTarget(spec) && !isCurationOpportunityTarget(spec);
  if (!oppMode && !newsMode) return items;

  return items.map((item) => {
    const url = str(item.url);
    if (!url || !/^https?:\/\//i.test(url)) return item;

    const coverage = hasCoverageProvenance(
      item.reason,
      item.summary,
      item.description,
      item.snippet
    );
    const score = Number(item.score ?? 0);
    let floor = 0;

    if (newsMode) {
      const title = str(item.title || item.headline);
      if (!title || title.length < 8) return item;
      const articleish =
        /\/news\/[a-z0-9]|\/stories\/|\/articles?\/|\/press\//i.test(url) ||
        pathDepth(url) >= 2;
      floor = coverage
        ? exhaustive
          ? 48
          : 55
        : articleish
          ? exhaustive
            ? 46
            : 52
          : exhaustive
            ? 42
            : 48;
    } else {
      const program = str(item.program_name ?? item.title);
      const org = str(item.organization);
      const rich =
        Boolean(program) &&
        Boolean(
          org ||
            item.deadline ||
            item.max_funding ||
            item.value_or_benefit ||
            item.eligibility
        );
      if (!rich && !coverage) return item;
      floor = coverage
        ? exhaustive
          ? 48
          : 55
        : isDirectGrantUrl(url)
          ? exhaustive
            ? 50
            : 58
          : isLowQualityGrantUrl(url)
            ? exhaustive
              ? 38
              : 42
            : exhaustive
              ? 45
              : 52;
    }

    if (score >= floor) return item;
    return {
      ...item,
      score: floor,
      reason: item.reason
        ? `${item.reason} | score-floor${exhaustive ? ":exhaustive" : ""}`
        : `score-floor${exhaustive ? ":exhaustive" : ""}`,
    };
  });
}

function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.replace(/\/$/, "").split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Enrich + filter + re-score a result set for curation-quality agents.
 */
export function applyCurationPipeline(
  items: ExtractedItem[],
  spec: AgentSpec,
  opts: CurationOptions = {}
): { kept: ExtractedItem[]; dropped: { item: ExtractedItem; reason: string }[] } {
  const known = opts.knownFingerprints ?? new Set<string>();
  const dropped: { item: ExtractedItem; reason: string }[] = [];
  const kept: ExtractedItem[] = [];
  const seen = new Set<string>();

  const curationMode =
    isCurationOpportunityTarget(spec) ||
    isSectorNewsTarget(spec) ||
    isNewsletterWrapTarget(spec) ||
    Boolean(spec.filters?.requireVerification);

  if (!curationMode) {
    return { kept: items, dropped: [] };
  }

  for (const raw of items) {
    const kind = classifyItemKind(raw, spec);
    const category =
      kind === "opportunity" ? classifyOpportunityCategory(raw, spec) : undefined;
    const fp = itemFingerprint(raw);

    if (seen.has(fp) || known.has(fp)) {
      dropped.push({ item: raw, reason: "duplicate" });
      continue;
    }
    seen.add(fp);

    let exclude: string | null = null;
    if (kind === "news") {
      exclude = shouldExcludeNews(raw, spec, opts);
    } else if (kind === "opportunity" || isCurationOpportunityTarget(spec)) {
      exclude = shouldExcludeOpportunity(raw, spec, opts);
    }
    if (exclude) {
      dropped.push({ item: raw, reason: exclude });
      continue;
    }

    const boost = editorialBoost(raw, spec);
    const base = Number(raw.score ?? 50);
    const score = Math.max(0, Math.min(100, base + boost));
    const days = daysUntilDeadline(raw.deadline ?? raw.closing_date);
    const status =
      str(raw.status) ||
      (days == null
        ? /\brolling|ongoing\b/i.test(blobOf(raw))
          ? "rolling"
          : "open"
        : days <= 14
          ? "closing soon"
          : "open");

    const enriched: ExtractedItem = {
      ...raw,
      item_kind: kind,
      ...(category ? { category } : {}),
      fingerprint: fp,
      score,
      editorial_boost: boost,
      primary_audience: primaryAudienceLabel(raw, spec),
      review_status: str(raw.review_status) || "pending",
      status,
      ...(days != null ? { days_remaining: days } : {}),
      verification_date: new Date().toISOString().slice(0, 10),
      verified:
        kind === "opportunity"
          ? str(raw.deadline) || str(raw.eligibility) || isDirectGrantUrl(str(raw.url))
            ? "yes"
            : "pending"
          : "yes",
    };
    kept.push(enriched);
  }

  // Prefer balanced mix for opportunity pools when many categories present
  kept.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return { kept, dropped };
}

/** Load fingerprints from prior inbox JSON payloads (cross-run dedupe). */
export function collectKnownFingerprints(
  priorItems: ExtractedItem[],
  approvedOrArchivedOnly = false
): Set<string> {
  const set = new Set<string>();
  for (const item of priorItems) {
    const status = str(item.review_status).toLowerCase();
    if (approvedOrArchivedOnly && status !== "approved" && status !== "archived" && status !== "rejected") {
      // still fingerprint reject/archive for blocking re-surface; pending can reappear if improved
      if (status === "pending" || !status) {
        /* allow re-check of pending */
      }
    }
    if (status === "rejected" || status === "archived" || status === "approved") {
      set.add(str(item.fingerprint) || itemFingerprint(item));
    } else if (!approvedOrArchivedOnly) {
      set.add(str(item.fingerprint) || itemFingerprint(item));
    }
  }
  return set;
}

export function subtypeToCategory(sub: OpportunitySubtype): OpportunityCategory | null {
  switch (sub) {
    case "grants":
      return "funding";
    case "programs":
      return "program_fellowship";
    case "awards":
      return "award_competition";
    case "exposure":
      return "exposure";
    default:
      return null;
  }
}
