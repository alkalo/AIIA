# Example — Opportunity discovery & curation (generic / BFGN-ready)

Use **Gemini + ultra_high** (or local Máx). Destinations: **Inbox**.  
Optional: enable **Cloud cron** for monthly runs with PC off.

```
Discover and curate high-quality OPEN opportunities for purpose-led / impact organisations.

Categories (assign exactly one per item):
1) Funding — grants, prizes with money, investment calls
2) Programs & Fellowships — accelerators, incubators, cohorts, mentoring
3) Awards & Competitions — awards, pitch contests, challenges
4) Exposure — speaking, media features, showcases, contributor calls

Rules (quality before quantity):
- Official application / guidelines URL required (https). Aggregators only for discovery.
- Confirm open / rolling / opening soon. Prefer ≥7 days until deadline.
- Never invent amounts, deadlines, or eligibility.
- Exclude jobs, invitation-only, waitlists, events without an open call.
- Primary market: Australia (include global only if AU eligibility is explicit).
- Fields: category, organization, program_name, eligibility, primary_audience,
  value_or_benefit or max_funding, deadline, status, url, score, reason.
- Return up to ~50 verified candidates; fewer is fine if quality is limited.

Human review in Inbox: Approve / Reject / Archive. Do not publish without review.
```

Set subtype to **Grants / funding** (or Programs / Awards / Exposure) and turn on verification in filters if editing the AgentSpec.
