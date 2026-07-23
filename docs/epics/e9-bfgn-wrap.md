# E9 — BFGN-style Grants & Impact News wrap

## Goal
Reproduce (as far as AIIA can locally) the monthly BFGN email: open grants + business-for-good news, delivered as a wrap the user can send.

## Reference
User PDFs (Gmail monthly wrap-ups + Workspace Studio Gemini prompts): multi-step research (grants/policy, social enterprise, NGO/philanthropy, ESG) → editor → email.

## What AIIA can do today (v0.1.22+)
| Piece | Status |
|-------|--------|
| Discover AU grants (portals + SERP) | Strong with Gemini ultra; usable local ultra |
| Sector news candidates | Good with Gemini; weaker local small models |
| Curate top ~10 editorial English (AU) | **Gemini Pro preferred** |
| Schedule monthly (`intervalMinutes: 43200`) | Yes |
| Inbox / Excel / CSV | Yes |
| Newsletter text + **`.eml` draft** | Yes (`output.destinations: ["email"]`) |
| Auto-send via Gmail/SMTP | **Not yet** (open `.eml` in Outlook / copy-paste) |
| Member/partner spotlights + fixed event cards | Manual / out of scope (editorial BFGN content) |

## Recommended setup
1. Provider: **Gemini** (API key in Settings).
2. Effort: **ultra_high**.
3. Destinations: `inbox` + `email` (+ excel optional).
4. `emailTo`: your team address (optional; fills To: in the draft).
5. Schedule: monthly, timezone `Australia/Brisbane`.
6. Prompt: see `docs/examples/bfgn-monthly-wrap-prompt.md`.

## Local vs Gemini
- **Local**: OK for grant link harvesting on strong HW (14b+); news curation and AU editorial quality degrade on 7b/3b.
- **Gemini**: Better for the Workspace Studio–style multi-angle research + editor voice. Prefer Gemini for this agent.

## Next (if needed)
- Multi-lane parallel research (1A–1D) inside one run
- Freshness hard filter (7 / 30 days)
- HTML email body
- Optional SMTP send with local credentials (DPAPI)
