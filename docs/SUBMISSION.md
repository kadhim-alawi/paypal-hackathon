# Devpost submission

Copy these into the Devpost form. Fill in the bracketed links before submitting.

**Project name:** Tideover

**Tagline (≤ 200 chars):** An AI caseworker and PayPal rails that get emergency cash to neighbors in minutes, not months: Claude does the casework, people decide, and PayPal Payouts delivers.

**Links:** live demo [Render URL] · video [YouTube URL] · code [GitHub URL]

**Prizes:** the official rules let a project win **one Grand Prize or one Honorable Mention (Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce), plus one Sponsor Prize**. Enter for every grand and honorable-mention prize, and for two sponsor prizes: **Best Use of AG Grid** (the treasurer Ledger is built on AG Grid Enterprise and its AI Toolkit) and **Best Use of Render** (deployed from a Render Blueprint as a Docker web service with Render Postgres). Only one sponsor prize can be won. Tideover doesn't use APIMatic, Bryntum or Channel3.

**Built with (Devpost tags):** see the list at the end.

**New or existing project:** new; built from scratch during the submission period (October–November 2026).

---

## Inspiration

Thirty-seven percent of U.S. adults can't cover a $400 emergency with cash ([Federal Reserve, SHED 2025](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-executive-summary.htm)). For them a broken car, a shut-off notice or a rent gap isn't an inconvenience; it's the first domino toward a lost job or an eviction.

Communities already step in. Mutual aid groups, campus emergency funds, churches and neighborhood funds raise money for exactly these moments. But they run on spreadsheets, group chats and personal Venmo accounts. Volunteers burn out on intake, duplicates and fraud slip through, applicants wait anxiously for days, and donors never see what happened to their money.

Then we read GiveDirectly's hurricane numbers: their earlier U.S. process took seven months to pay 6,363 people; with data-driven targeting and remote enrollment, more than 90% were paid in under 24 hours. We wanted to give a five-volunteer neighborhood fund that same speed, without giving up the human judgment and controls that keep a fund trustworthy.

## What it does

Tideover is the operating system for a community emergency fund, with three sides:

**People in need** chat with an AI caseworker (Claude) in their own language, by text or voice, and the app's screens follow them into Spanish. It asks only what the fund's policy needs, reads a photo or PDF of the bill or estimate on the spot, and checks it against the story. They verify their payout account with **Log in with PayPal** (or use Venmo or a PayPal email) and follow their request live. No account, no SSN, no forms.

**Volunteers and organizers** get a case file instead of a pile of paperwork: a summary, a recommended amount, a confidence score, and every rule of the fund's own policy checked with quoted evidence. Deterministic checks the AI cannot override catch duplicates, reused documents, near-identical stories, cooldowns, velocity, caps and amount mismatches. One tap approves and sends the grant through **PayPal Payouts**. Grants over a threshold need two different reviewers. Organizers write their policy in plain English and Claude compiles it into the structured rubric the whole system enforces. A treasurer copilot, built with the **PayPal Agent Toolkit**, answers questions from live data and reconciles the books against PayPal in both directions. Every AI output, human decision and PayPal event lands in an append-only audit log. Treasurers get a **Ledger built on AG Grid**: every dollar in and out as a live spreadsheet with PayPal IDs, group-by totals and Excel export. They can **ask it in plain English**: "total grants by category" is answered by Claude through AG Grid's AI Toolkit, and the grid regroups and totals itself.

**Donors** see a live public ledger: every gift and grant, the balance, and the median minutes from request to cash. When an approved request is waiting for funds, a donor can fund it directly with PayPal, Venmo or Pay Later, and the grant pays out the moment the payment is captured. **AI agents can give too:** Tideover's MCP server lets an assistant like Claude find verified needs and start a donation, then hands the human a PayPal checkout to approve. That's agentic commerce with a human in the loop for the money.

The principle throughout: **AI proposes, people decide, rules enforce.**

## How we built it

- **Flutter** app for web, iOS and Android: an applicant chat with voice input, camera and document upload; public fund pages; and a full staff console. Realtime updates arrive over Server-Sent Events.
- **TypeScript / Node 22 / Fastify** server with **Drizzle** on **Postgres** (embedded PGlite for development and tests).
- **PayPal:** Payouts v1 (PayPal, Venmo and verified `PAYPAL_ID` recipients) with `sender_batch_id` and `PayPal-Request-Id` idempotency; Orders v2 with the JS SDK Smart Buttons (PayPal, Venmo, Pay Later, cards); Log in with PayPal (`userinfo`, `paypalattributes`); webhooks with signature verification; refunds; Transaction Search for reconciliation; and the PayPal Agent Toolkit in the copilot.
- **Claude (`claude-opus-5-5`)** through the Anthropic SDK: a streaming tool-use agent for intake, vision with structured outputs for documents, structured outputs at high effort for assessments and the policy compiler, short generations for multilingual decision messages and anonymized impact stories, and a tool-using copilot. We use prompt caching for the long policy prompts and server-side fallbacks for resilience. Every AI call has a deterministic fallback, so the fund keeps running if the AI is down.
- **MCP** (Streamable HTTP) server for agent donations, plus a terminal donor agent (`npm run agent`) that uses Claude as an MCP client to find a need and start a gift.
- **AG Grid Enterprise** for the treasurer Ledger, mounted inside the Flutter web console. Its **AI Toolkit** generates a JSON Schema of the grid's state; Claude answers within that schema using structured outputs (converted to the strict subset, with a tool-call fallback), and the grid applies the answer with `setState`. Only the AG Grid modules the Ledger uses are bundled, and they load only when someone opens the Ledger.
- An in-process **PayPal simulator** that speaks the same wire formats and state machines, so the whole product runs offline and the test suite is deterministic. The same domain code runs against the real sandbox.
- Shipped as one **Docker** image with a **Render** blueprint (web service + Postgres).

## Tools: which AI we used and how

The rules ask every submission to name its AI tools and explain how they're used.

| Tool | How Tideover uses it |
|---|---|
| **Claude (`claude-opus-5-5`) through the Anthropic API and the official TypeScript SDK** | (1) **Intake agent:** a streaming tool-use loop (`record_details`, `request_document`, `mark_ready`) that interviews applicants in their own language and fills the case. (2) **Document reader:** vision on photos and PDFs with structured output that extracts issuer, amount, dates and red flags, and checks them against the stated need. (3) **Caseworker assessment:** structured output at high effort that scores the request against the fund's own rubric, with evidence for each criterion and a recommended amount, which code then clamps to caps. (4) **Policy compiler:** turns an organizer's plain-English policy into the structured rubric the system enforces. (5) **Treasurer copilot:** a tool-using agent over Tideover data and the PayPal Agent Toolkit. (6) **Short generations:** decision messages in the applicant's language and anonymized one-line impact stories. (7) **Donor agent:** `npm run agent`, a terminal assistant that gives through Tideover's MCP server. Prompt caching, per-task effort and server-side fallbacks are configured for each call. |
| **AG Grid AI Toolkit** (`AiToolkitModule`, `getStructuredSchema`) | Turns a treasurer's question into Ledger grid state: the grid's schema becomes Claude's structured-output format, so the answer is valid grid state by construction. Claude picks the filters, groups and totals; the grid computes every number. |
| **PayPal Agent Toolkit** (`@paypal/agent-toolkit`) | Gives the copilot live PayPal tools alongside Tideover's own (transactions, orders and more). |
| **Model Context Protocol** (`@modelcontextprotocol/sdk`) | Tideover's MCP server (`/mcp`) lets any AI agent find verified needs and start PayPal donations; the donor agent is its MCP client. |
| **Deterministic fallbacks** | Every AI call has a rule-based fallback, so the fund keeps working (clearly labelled) if the AI is unavailable, and the test suite runs offline. |

## Challenges we ran into

- **Money that moves exactly once.** API responses, webhooks and a poller all race to update the same payout. We built one state machine they all feed, wrote the payout row (and its `sender_batch_id`) before calling PayPal, retried transient failures with the same idempotency keys, and put a per-fund lock around the balance check so two approvals can never overdraw a fund.
- **Making the AI useful without putting it in charge.** It's tempting to let the model approve grants. Instead the AI writes the case file, code enforces caps, balance and duplicates, and auto-approval (off by default) only fires for small, clean, document-backed requests to PayPal-verified accounts.
- **Real-world documents.** Phone photos of crumpled estimates, handwritten invoices, PDFs of utility bills. We tuned the extraction to tell real red flags (edited totals, impossible dates) apart from normal mess, and to treat any text inside a document as evidence, never instructions.
- **A simulator faithful enough to trust.** To test refunds, unclaimed payouts, Venmo validation errors and webhook ordering without real money, the simulator mirrors PayPal's payloads, statuses, error shapes and fees, and it rebuilds its history from the database after a restart.

## Accomplishments that we're proud of

- The full journey works end to end: a Spanish-speaking applicant with a document and a verified PayPal account, reviewer approval, a PayPal payout, and the applicant seeing "money sent", verified in a real browser with Playwright.
- A donor funding a specific approved need and watching it pay out instantly.
- 49 server tests plus Flutter tests, run in CI on every push, across the applicant flow (including Spanish-speaking applicants), approvals and the two-person rule, risk checks, webhooks, MCP, reconciliation, and contract tests for both the PayPal REST client and the Claude provider.
- It's deployable as-is: one `render.yaml`, and any community fund can run its own instance.

## What we learned

- Speed and safety are not a trade-off when the boundaries are right: AI for understanding, code for money rules, people for judgment.
- PayPal's verified identity (Log in with PayPal → payer ID) removes a whole class of fraud and typos that plague mutual aid funds that pay to typed-in handles.
- Transparency is a feature, not a report. Showing donors the grant their gift made, minutes later, is the strongest case for giving again that a small fund can make.

## What's next

- A pilot with a real mutual aid network or campus emergency fund.
- PayPal Subscriptions for recurring "be someone's safety net" monthly giving.
- Vendor payouts (pay the mechanic or landlord directly) and PayPal invoicing for partner organizations.
- SMS and WhatsApp intake for people without smartphones or data.
- Multi-fund networks that route an applicant to the right fund automatically.

## Testing instructions for judges

- **Hosted demo:** [Render URL]. Every page shows a banner with the mode (PayPal sandbox or simulator, Claude or offline).
- **Staff console:** open `/console` and use **Sign in as Sam (reviewer)** or **Sign in as Avery (admin)** (one click; or `reviewer@tideover.app` / `tideover-review`, `admin@tideover.app` / `tideover-admin`).
- **PayPal sandbox buyer for donations and Log in with PayPal:** [sandbox personal account email] / [password]. These are sandbox test credentials holding fake money.
- **Sample documents** to upload when applying: [`demo-assets/`](../demo-assets) in the repo.
- **A 5-minute guided tour** is in the README ("Judge's tour"). To run it locally instead, see "Run it locally" (three commands, no keys needed: it runs fully offline in simulator mode).
- **Ledger:** in the console, open **Ledger** and tap *Total grants by category*, or drag a column header up to group by it.
- **Agentic giving:** `cd server && ANTHROPIC_API_KEY=... npm run agent -- --url [Render URL] "Give $25 to an approved need"`, or add `[Render URL]/mcp` to any MCP-capable assistant.

## How Tideover meets the judging criteria

The five criteria are weighted equally; ties are broken in this order.

- **Technological Implementation:** Seven PayPal capabilities used for what they're for: Payouts (PayPal, Venmo, verified payer IDs), Orders v2 with the JS SDK, Log in with PayPal, verified webhooks, refunds, Transaction Search, and the Agent Toolkit. Claude in eight roles (intake agent, document vision, structured assessment, policy compiler, copilot, multilingual messages and stories, MCP donor agent, and the AG Grid Ledger through its AI Toolkit). Idempotent money movement with a per-fund lock and an append-only ledger. 58 automated tests in CI, Playwright end-to-end runs, and live `verify:paypal` / `verify:claude` scripts.
- **Design:** One coherent product for three audiences (applicant, reviewer/treasurer, donor), mobile-first, multilingual, realtime, with plain-language status at every step and accessible semantics. It deploys to production from one Render blueprint.
- **Potential Impact:** It's built for a specific, documented gap: 37% of U.S. adults can't cover $400, and the community funds that help them run on spreadsheets and personal Venmo accounts. The demo shows the full path from request to cash in minutes with human approval and fraud checks. It's open source and ready for any mutual aid group or campus fund.
- **Innovation/Idea:** An AI caseworker that doesn't decide; a compiled, enforceable policy instead of prompt rules; donors (and their AI agents over MCP) funding a specific, verified need that pays out the moment the payment captures.
- **Presentation:** A sub-3-minute video that follows one real story end to end, from Spanish chat to money arriving in a sandbox PayPal account, plus this write-up, screenshots, and a guided tour in the README.

## Image gallery (upload in this order)

1. `docs/devpost/cover.png` (thumbnail)
2. `docs/screenshots/apply-chat.jpg`: the Spanish chat with a document read by Claude
3. `docs/screenshots/console-case.jpg`: the AI case file, policy checks and automated checks
4. `docs/screenshots/apply-paid.jpg`: money sent
5. `docs/screenshots/give-need.jpg` and `give-thanks.jpg`: funding an approved need
6. `docs/screenshots/console-money.jpg`: PayPal payouts and captures with IDs and fees
7. `docs/screenshots/console-ledger-ask.jpg`: asking the AG Grid Ledger in plain English
8. `docs/screenshots/console-copilot.jpg`: the treasurer copilot reconciling with PayPal

Retake 2–3 of these in sandbox + Claude mode once deployed; the committed ones come from offline mode.

## Built with

`paypal-payouts` `paypal-orders-v2` `paypal-js-sdk` `log-in-with-paypal` `paypal-webhooks` `paypal-agent-toolkit` `venmo` `ag-grid` `claude` `anthropic` `model-context-protocol` `flutter` `dart` `typescript` `node.js` `fastify` `postgresql` `drizzle-orm` `docker` `render`
