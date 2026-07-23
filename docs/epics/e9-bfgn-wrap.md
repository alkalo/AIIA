# E9 — BFGN-style Grants & Impact News wrap

## Goal
Monthly grants + impact news wrap for **copy-paste** into any email client.  
**AIIA never sends email** (no Gmail/SMTP). Human review is required before copy.

## Flow
1. Agent runs (prefer **Gemini + ultra_high**).
2. Results land in Inbox; a plain-text wrap is written under `exports/newsletters/`.
3. In **Inbox**, select the agent → review the wrap panel.
4. Tick **I reviewed this draft** → **Copy email body** → paste into Gmail/Outlook yourself.

## Destinations
| Destination | Meaning |
|-------------|---------|
| `email` | Produce copy-ready wrap text (not a send) |
| `inbox` / `excel` / `csv` | As usual |

Optional `emailTo` is only a **suggested To** note inside the draft — never used to send.

## Out of scope (manual)
- Member/partner spotlights
- Fixed BFGN event calendar tiles
- HTML template / branding

## Docs
- Example prompt: `docs/examples/bfgn-monthly-wrap-prompt.md`
- Multi-lane queries: `packages/agent-engine/src/wrap-lanes.ts`
- Cloud monthly cron (Gemini, PC off): `docs/architecture-cloud-cron.md`
