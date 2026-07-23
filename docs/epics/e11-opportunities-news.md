# E11 — Opportunities + Sector news curation

## Goal
Two generic, high-quality discovery pipelines (usable beyond BFGN):

1. **Opportunities** — Funding / Programs·Fellowships / Awards·Competitions / Exposure  
2. **Sector news** — Fresh sector stories (~30 days)

Human review in Inbox (Approve / Reject / Archive). Newsletter wrap remains a secondary layer (E9).

## Engine
- Subtypes: `grants`, `programs`, `awards`, `exposure`, `sector_news` (+ existing)
- `contentMode`: `opportunities` | `sector_news` | `wrap`
- `packages/agent-engine/src/curation.ts` — verify, freshness, exclude, fingerprint, editorial boost
- News seeds: `news-sources.ts`; opp lanes: `opportunity-lanes.ts`
- Filters: `maxAgeDays`, `minDaysRemaining`, `requireVerification`
- Wrap detection requires explicit wrap/newsletter language (not brand names / opportunity curators)
- SERP blocked: wait full engine cooldown (~90s) + one retry, then stop empty waves
- Page fetch appends real `<a href>` markup (`__AIIA_ANCHORS__`) so listing expand works (innerText alone cannot)
- Listing expand: `listing-expand.ts` harvests `/Go/Show` etc.; deep-links are extracted first
- Score floor re-applied after critic; opportunity extract prompt for all curation subtypes
- Portal seeds for all opportunity curators (not grants-only)
- Coverage provenance preserved through extract → validate → curation; post-curation portal rescue if wiped
- `tauri:dev` / `predev.ps1` runs `build:packages` so runner always loads fresh `dist/`

## UI
- Inbox review queue filters (pending / approved / rejected / archived)
- Kind filter (opportunities / news)
- Approve / Reject / Archive buttons

## Examples
- `docs/examples/bfgn-opportunities-prompt.md`
- `docs/examples/bfgn-sector-news-prompt.md`
- Wrap (combined): `docs/examples/bfgn-monthly-wrap-prompt.md`
