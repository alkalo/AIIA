/** Shared provenance markers for portal seeds / listing expands / SERP fallback. */
export const COVERAGE_PROVENANCE_RE =
  /portal seed|listing deep-link|deep link expanded|serp blocked|coverage seed/i;

export function hasCoverageProvenance(...parts: unknown[]): boolean {
  const blob = parts.map((p) => String(p ?? "")).join(" ");
  return COVERAGE_PROVENANCE_RE.test(blob);
}
