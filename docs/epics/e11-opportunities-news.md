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
- News seeds: `news-sources.ts` (multi-region atlas via `detectGrantRegions`); opp lanes: `opportunity-lanes.ts`
- Sector news parity: listing expand + pagination + depth-2 + gap-fill mid-run via `sectorNewsPortalSeedsForRegions`; RSS filtered by region; feed base cap 20→22; news hubs expandable; emergency / last-resort / post-curation rescue with news seeds; exhaustive soft (lower minScore + freshness +7d); **score-floor + critic** via `applyCurationScoreFloor` (news articles kept ≥46–55 after multipass/critic)
- Filters: `maxAgeDays`, `minDaysRemaining`, `requireVerification`
- Wrap detection requires explicit wrap/newsletter language (not brand names / opportunity curators)
- SERP blocked: wait full engine cooldown (~75s) + one retry, then stop empty waves
- Page fetch appends real `<a href>` markup (`__AIIA_ANCHORS__`) so listing expand works (innerText alone cannot); Playwright retries once on thin/challenge pages
- Listing expand: `listing-expand.ts` harvests `/Go/Show` etc.; deep-links are extracted first (higher cap for exhaustive runs)
- **Portal parsers:** `portal-parsers.ts` — GrantConnect AU, Grants.gov US, EU F&T, GOV.UK, ADB, IDB, FundsforNGOs/Candid, AfDB, World Bank, UNDP, IsDB, Canada.ca/IDRC/Community Foundations, NZ Community Matters/govt.nz, BOE/sede/CDTI (ES), CEPAL/ECLAC, CAF, UNECA, UNESCWA, EBRD. Used before generic href harvest; counted in run health
- **Portal detail extract:** `portal-detail.ts` fills deadline / organization / program_name / funding from GrantConnect, Grants.gov, EU F&T, GOV.UK/Lottery, ADB, IDB, FundsforNGOs/Candid, AfDB, World Bank, UNDP, IsDB, Canada, NZ, ES, CEPAL, CAF, UNECA, UNESCWA, EBRD. Fields are **pre-filled into the LLM extract prompt** (`formatPortalDetailHints`) and merged again after extract so empties stay filled
- **RSS parallel:** up to 28 feeds (opp) / 16 (news) fetched with concurrency 4; items deduped by `canonicalUrl` before seed inject
- **Host-health re-rank:** `host-health.ts` learns productive hosts across runs (`inbox/{agentId}/host-health.json`) and boosts/demotes relevance before fetch
- **SERP preference:** `serp-preference.ts` reorders engines from health-history hit counts (Brave API still pinned first when key is set)
- Score floor re-applied after critic (`applyCurationScoreFloor`); opportunity + sector_news extract prompts for curation subtypes
- Portal seeds for all opportunity curators (not grants-only)
- Coverage provenance preserved through extract → validate → curation; post-curation portal rescue if wiped
- **Global atlas:** `grant-sources.ts` detects regions (AU/NZ/EU/UK/US/CA/ES/LATAM/Asia/Africa/MENA). Unspecified or “global” prompts load multi-region boards + portal seeds (not AU-only). AU/NZ-locked prompts stay scoped. Multilaterals: World Bank + UNDP in global seeds/boards.
- **RSS/Atom feeds:** `opportunity-feeds.ts` injects official feeds per region (soft-fail per feed); Grants.gov XML parsed in `feed.ts`. Atlas includes CA (IDRC), LATAM (IDB/CEPAL/CAF), Asia (ADB), Africa (AfDB/UNECA), MENA (UNESCWA/EBRD), plus EU CORDIS / UK / ES extras and WB/UNDP news
- **Listing pagination:** up to 2 extra pages per hub via `discoverListingPageUrls`
- **Region coverage report:** `coverage-report.ts` logs counts + gaps at end of run
- **Brave Search API (optional):** key in Settings (`aiia.brave_search`, DPAPI) → agents (`AIIA_BRAVE_SEARCH_API_KEY`) and AIIA Chat `web_search`. Hits tagged `brave-api` vs HTML `brave` in health
- `tauri:dev` / `predev.ps1` runs `build:packages` so runner always loads fresh `dist/`

## Scraping quality (ongoing)
- Multi-engine SERP (Mojeek, DDG, Brave, Ecosia, Bing) with health/cooldown and diversity before fill
- Prefer canonical portal seeds + listing expand + RSS over SERP alone for exhaustiveness
- Canonical URL dedupe (`canonical-url.ts`) + org/program content key across portals
- Depth-2 related crawl (bounded) after listing expand
- Run source-health log: SERP / seeds / RSS / expand / fetch OK-fail
- Inbox `*-report.json` + inbox JSON include `runMeta` / sourceHealth + regionCoverage
- Inbox UI: panel “Last run — source health” when an agent is selected (`get_latest_run_report`)
- Runs UI: latest health for filtered agent + per-run “Health” button (report by runId)
- When listing-expand/depth-2 historically win, **expand historyExtra** adds up to +24 slots (cap 140). When depth-2 alone is strong, **depth2CapForHistory** raises related-crawl cap (up to 28). **paginationBudgetFromHistory** raises listing pagination (up to 5 pages × 8 hubs). When gap-fill historically wins, **gapFillCapExtraFromHistory** adds +4/+8/+12 portal seeds (cap 36)
- **Feed health:** `feed-health.json` — feeds con 2 fallos consecutivos entran en cooldown 6h; priorización de feeds por huecos históricos (`prioritizeFeedsByRegions`); contadores cooldown/fallos en informe + UI Inbox/Runs
- Playwright soft-stealth + 3-attempt fetch (domcontentloaded → load → networkidle) + scroll for lazy lists
- **Gap-fill mid-run:** after listing expand, `uncoveredRegions` + `grantPortalSeedsForRegions` re-inject portals for empty regions (bounded), then one more expand pass
- **Health history:** `health-history.json` (last 20 runs) under inbox/{agentId}; Inbox/Runs show trend via `get_health_history`
- **Adaptive learning line:** source-health report includes `Aprendizaje adaptativo:` when soft curation / RSS feed boost / origin-pin / expand historyExtra / depth-2 cap / pagination budget / gap-fill extra applied (also in report JSON `adaptive`); Inbox/Runs show dedicated chips via Tauri `adaptive` (incl. `depth2+N`, `page:Np×Mh`, `gap+N`)
- SERP engine chips in Inbox/Runs from `serpEngineHits` (Brave API vs Brave HTML, Mojeek, …)
- **Origin attribution:** `discovery-origin.ts` counts finals by channel (Seeds / RSS / Expand / Depth-2 / Gap-fill / SERP) from provenance tags; shown in source-health text + Inbox/Runs chips (`originCounts`)
- **Origin preference:** `origin-preference.ts` learns from health-history `originCounts` and boosts/demotes fetch priority of candidates by channel (e.g. more Seeds/RSS when those historically win; gentle SERP demotion when weak). When RSS share of finals is high, **feed fetch cap rises** (opp up to 36, news up to 22). **Origin-pin** forces historically strong non-SERP channels (portal-seed, gap-fill, rss, listing-expand, depth-2) to `fetchPriority: high`
- **Approved boost:** `approved-boost.ts` reads Inbox review — `approved`/`archived` boost hosts/orgs; **`rejected` demotes** hosts/orgs (repeated rejects demote harder; approved wins if both). Re-applied after SERP waves
- Regression: `npm run test:scraping` (…, discovery-origin, origin-preference, approved-boost)
- Undated concrete opportunities kept as Inbox `pending` rather than dropped
- **Exhaustive soft curation:** global opportunity runs lower `effectiveMinScore` (−10, floor 36), softer score-floors, keep undated titled items, and relax `minDaysRemaining` by 3 — coverage first, human review in Inbox

## UI
- Inbox review queue filters (pending / approved / rejected / archived)
- Kind filter (opportunities / news)
- Approve / Reject / Archive buttons
- Settings: optional Brave Search API key (save / test / clear)

## Examples
- `docs/examples/bfgn-opportunities-prompt.md`
- `docs/examples/bfgn-sector-news-prompt.md`
- Wrap (combined): `docs/examples/bfgn-monthly-wrap-prompt.md`
