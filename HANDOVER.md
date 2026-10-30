# Handover: Tideover (PayPal AI Hackathon)

Working notes for continuing on a local machine. Delete this file before the repo goes public, or keep it out of the default branch.

- **Hackathon:** https://paypalaihackathon.devpost.com/
- **Deadline:** Nov 12, 2026, 12:00 PM PT. Judging runs Dec 1–15, so the hosted demo must stay up until Dec 15, 8:00 AM PT.
- **Branch:** `claude/awesome-mccarthy-p1mcam`. It is the repo's only branch and currently its default. Last commit: `5dc4343`. CI is green.
- **Prizes we're entering:** Grand Prize, plus the AG Grid and Render sponsor prizes. A project can win one Grand Prize *or* one Honorable Mention, plus one sponsor prize.

## 1. Get it running locally

You need:
- Node 22+.
- Flutter 3.47.7 (the version CI uses; Dart 3.13).
- Docker, for the step-3 check.
- Optionally Playwright with Chromium, for the end-to-end run.

```bash
git clone https://github.com/kadhim-alawi/paypal-hackathon.git tideover
cd tideover && git checkout claude/awesome-mccarthy-p1mcam

# Web app (served by the API from app/build/web)
cd app && flutter pub get && flutter build web --release --no-web-resources-cdn

# Optional: local AG Grid bundle (gitignored). Without it the Ledger loads AG Grid from jsDelivr.
cd ../tools/aggrid && npm ci && npm run build      # writes app/web/ledger/aggrid.js, then rebuild the web app

# API: embedded Postgres (PGlite) and seeded demo data
cd ../../server && npm ci && cp .env.example .env && npm run dev
# open http://localhost:8080 and http://localhost:8080/console (one-click demo sign-in)
```

With an empty `.env`, everything runs offline: a PayPal simulator stands in for PayPal and keyword rules stand in for Claude. Keys switch on the real services; see section 4.

### Checks to run before every push

```bash
cd server && npm run typecheck && npm test        # 49 tests, 13 files (about 1 min)
cd app && flutter analyze && flutter test          # 9 tests, analyzer clean
```

### End-to-end journey (optional)

This drives the real UI: a Spanish applicant, staff approval, the payout, then a Ledger question. Run it against an **offline** server (empty `.env`).

```bash
cd server && PORT=8787 npm run dev
# in a scratch dir:  npm i playwright && npx playwright install chromium
PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright/index.mjs node e2e/journey.mjs http://localhost:8787 e2e/screenshots
node e2e/shots.mjs http://localhost:8787 e2e/screenshots   # page screenshots
```

## 2. What's built (where to look)

| Area | What | Where |
|---|---|---|
| Applicant | Mobile-first chat intake (English and Spanish), document upload with vision checks, status page | `app/lib/features/apply/`, `server/src/ai/claude.ts` (intakeTurn, extractDocument) |
| Staff console | Queue, AI case assessment, approve or deny, Payouts, Money, treasurer copilot, reconciliation, **Ledger** | `app/lib/features/console/`, `server/src/routes/staff.ts` |
| Ledger (AG Grid) | Every money movement with its PayPal ID. "Ask the ledger" turns the grid's AI Toolkit schema into a Claude structured output, then applies the answer with `setState` | `app/web/ledger/ledger.js`, `app/lib/features/console/ledger*`, `server/src/ai/strict-schema.ts`, `server/src/ai/grid-heuristic.ts`, `server/src/domain/ledger-rows.ts` |
| Donors | Public fund pages, PayPal checkout (Orders v2 and the JS SDK, Venmo), sponsor a specific need | `app/lib/features/fund/`, `server/src/routes/public.ts` |
| AI-agent donors | MCP server at `/mcp`, plus a terminal donor agent (`npm run agent`) | `server/src/mcp/`, `server/src/agent/donor-agent.ts`, `server/src/tools/agent.ts` |
| PayPal | Payouts (with idempotency), Orders v2, Log in with PayPal, verified webhooks, refunds, Transaction Search, plus a simulator that restores its history from the DB on boot | `server/src/paypal/` |
| Money integrity | Append-only ledger, fund balance from the ledger, reconciliation against PayPal (copilot tool `reconcile_with_paypal`) | `server/src/domain/ledger.ts`, `server/src/domain/copilot.ts` |
| Deploy | Multi-stage Dockerfile (web, aggrid, server, runtime), Render Blueprint (web service plus Postgres), GitHub Actions CI | `Dockerfile`, `render.yaml`, `.github/workflows/ci.yml` |
| Docs | README (judge tour), ARCHITECTURE, PAYPAL_SETUP, DEMO_SCRIPT, SUBMISSION (Devpost text) | `README.md`, `docs/` |

Product principle used throughout: **"AI proposes, people decide, rules enforce."** Claude never moves money; a staff member approves, and policy rules cap amounts.

## 3. What has NOT been verified yet

The cloud session that built this had no PayPal or Anthropic keys and a restricted network, so:

1. **No live Claude calls have been made.** The model is `claude-opus-5-5`. Every Claude path is tested against a fake API that records requests, so the request shapes are checked but the real API has never answered. Run `npm run verify:claude`. It covers document vision, the Spanish intake turn, the assessment, the decision message, the policy compiler, and "ask the ledger" with the real AG Grid schema.
2. **No live PayPal sandbox calls have been made.** Run `npm run verify:paypal` (see `docs/PAYPAL_SETUP.md`).
3. **The full `docker build` never completed.** The proxy blocked apt over HTTP in stage 1, the Flutter build stage. Only the runtime stage was smoke-tested, using host-built files. Render builds this Dockerfile, so test it locally first:
   ```bash
   docker build -t tideover .
   docker run --rm -p 8080:8080 -e JWT_SECRET=$(openssl rand -hex 32) tideover   # then open http://localhost:8080
   ```
   `JWT_SECRET` is required when `NODE_ENV=production`, which the image sets. Without `DATABASE_URL` the container uses embedded PGlite.

## 4. Remaining to-dos, in order

1. **Live checks:** fill in `server/.env`, then run `npm run verify:claude` and `npm run verify:paypal`. Fix whatever they turn up.
2. **`docker build`** passes locally (section 3).
3. **Branch:** create `main` from this branch, make it the default, and remove `HANDOVER.md` there.
4. **Make the repo public.** Judges need the code and a visible license.
5. **Deploy on Render:** New → Blueprint from `render.yaml`, on `main`.
   - Set these environment variables: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `ANTHROPIC_API_KEY`, and optionally `AG_GRID_LICENSE_KEY` (a trial key from info@ag-grid.com removes the evaluation watermark).
   - Use paid plans, not free ones: free web services sleep and free Postgres expires.
   - Point the PayPal webhook and the Log in with PayPal return URL at the Render URL (`docs/PAYPAL_SETUP.md` §5). `PUBLIC_URL` falls back to `RENDER_EXTERNAL_URL`.
6. **Judge access:** create a sandbox *personal* account for judges (`PAYPAL_SETUP.md` §7). Put its email and password in the README "Access for judges" table and in `docs/SUBMISSION.md` (testing instructions).
7. **Fill the placeholders:**
   - `docs/SUBMISSION.md` line 9: Render URL, YouTube URL and GitHub URL.
   - README: "_add your Render URL here_".
8. **Retake the screenshots** against the deployed app in sandbox mode with Claude on. The current ones in `docs/screenshots/` come from the offline mode, so they show no "Claude · AG Grid AI Toolkit" label and the grid has a watermark. The upload order is in SUBMISSION.md "Image gallery".
9. **Record the video** from `docs/DEMO_SCRIPT.md`.
   - Under 3 minutes, public on YouTube, English.
   - Add English subtitles for the Spanish lines.
   - No third-party trademarks or unlicensed music.
   - Use the repo's terminal agent for the agent segment.
10. **Submit on Devpost** before Nov 12, 12:00 PM PT.
    - Paste from `docs/SUBMISSION.md`, including the **Tools** section and the judge credentials.
    - Select the AG Grid and Render sponsor prizes.
    - Cover image: `docs/devpost/cover.png`.
11. **Keep it running** through Dec 15. Don't push risky changes during judging.

## 5. Things learned the hard way (read before changing code)

**Claude API**
- On opus-5-5, thinking is always on, so every `max_tokens` budget must leave room for it. Current budgets: intake and extraction 16000, plain text 8000, story and decision 4000.
- A forced `tool_choice` returns 400 on this model. Tool fallbacks leave `tool_choice` unset.
- Structured outputs use `output_config.format` (`json_schema`). The supported schema subset excludes `pattern`, min/max, nullable `type` arrays and `minItems` > 1, and the SDK's `transformJSONSchema` doesn't fix type arrays. That is why `server/src/ai/strict-schema.ts` exists: it moves unsupported constraints into the descriptions.
- If the API rejects the schema, `gridQuery` retries with a `set_grid_state` tool call.

**AG Grid**
- Pinned to 36.2.0, Enterprise.
- The bundle in `tools/aggrid/entry.mjs` registers only the modules the Ledger uses. If you use a new grid feature, register its module there or it silently does nothing (for example, `forEachNodeAfterFilter` needed `ClientSideRowModelApiModule`).
- The bundle output is gitignored and gets built in Docker and CI.
- Date filters use the format `YYYY-MM-DD HH:mm:ss`.

**Flutter web**
- Playwright sees `ActionChip` as role **checkbox**.
- Semantics must be turned on before selecting by role (see `e2e/journey.mjs`).
- The repo uses lines longer than 80 characters. Don't run `dart format` on whole files: it reflows everything. Format only what you touch.
- Don't list asset directories in `pubspec.yaml` that aren't committed. Git drops empty folders, and `flutter analyze` and the Docker build then fail on a clean checkout.

**Server**
- Seeded ledger entries are backdated (`postLedger({ at })`) so the Ledger spans several months. Reconciliation reports seeded records (no PayPal IDs) separately instead of claiming everything matches.
- The static file server sends `no-cache` for `main.dart.js` and `ledger/*.js`, so redeploys don't serve stale code. Assets get `max-age`.

## 6. Prompt for Claude Code on your machine

Open Claude Code in the cloned repo and paste:

```text
You're picking up Tideover, our entry for the PayPal AI Hackathon
(https://paypalaihackathon.devpost.com/). The goal is to win the Grand Prize, plus the AG Grid
and Render sponsor prizes. Deadline: Nov 12, 2026, 12:00 PM PT. Judging runs Dec 1–15. The
five criteria are equally weighted, and ties are broken by Technological Implementation, then
Design, Potential Impact, Innovation, and Presentation.

Start by reading HANDOVER.md, then README.md and the docs/ folder (ARCHITECTURE, PAYPAL_SETUP,
DEMO_SCRIPT, SUBMISSION). Don't redo work that's already finished.

I code mainly in Flutter and I'm not a beginner, so skip the basics.

Then, in this order:
1. Check my toolchain (Node 22+, Flutter 3.47.7, Docker). Run the server tests, typecheck,
   flutter analyze and flutter test. Report anything red before changing code.
2. Run `docker build -t tideover .` and the container smoke test from HANDOVER.md §3. A full
   build has never passed, and Render depends on it, so fix whatever breaks.
3. Ask me for my keys and help me fill in server/.env (never commit it). Then run
   `npm run verify:claude` and `npm run verify:paypal` in server/. These are the first live
   calls this code has made. Fix what fails with the smallest change that works, and add or
   update a test for each fix.
4. Walk me through HANDOVER.md §4 (main branch, public repo, Render deploy, PayPal webhook and
   return URL, judge sandbox account, placeholders, screenshots, video, Devpost). Do the parts
   you can do from here. For the parts only I can do (dashboards, recording), tell me exactly
   what to click.

Rules:
- Read HANDOVER.md §5 before touching the Claude, AG Grid or Flutter web code.
- Keep "AI proposes, people decide, rules enforce": Claude never moves money on its own.
- Before each commit, run the checks in HANDOVER.md §1. Keep commits small and push only when
  they're green.
- Don't add features unless they clearly raise the score on a judging criterion and fit
  before the deadline. Polish, reliability and the video matter more now.
- Keep the docs (README, SUBMISSION.md, DEMO_SCRIPT.md) in step with any behavior you change.
```
