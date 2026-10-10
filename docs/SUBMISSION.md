# Devpost submission

Copy these into the Devpost form. Fill in the bracketed links before submitting.

**Project name:** Tideover

**Tagline (≤ 200 chars):** An AI caseworker and PayPal rails that get emergency cash to neighbors in minutes, not months: Claude does the casework, people decide, and PayPal Payouts delivers.

**Links:** live demo [Render URL] · video [YouTube URL] · code [GitHub URL]

**Prizes to opt into:** Best Use of PayPal + AI, Most Impactful, Best Use of Agentic Commerce, Best Demo Delivery, Most Creative, and Render (deployed on Render with a blueprint, Docker and Render Postgres).

---

## Inspiration

Thirty-seven percent of U.S. adults can't cover a $400 emergency with cash ([Federal Reserve, SHED 2025](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-executive-summary.htm)). For them a broken car, a shut-off notice or a rent gap isn't an inconvenience; it's the first domino toward a lost job or an eviction.

Communities already step in. Mutual aid groups, campus emergency funds, churches and neighborhood funds raise money for exactly these moments. But they run on spreadsheets, group chats and personal Venmo accounts. Volunteers burn out on intake, duplicates and fraud slip through, applicants wait anxiously for days, and donors never see what happened to their money.

Then we read GiveDirectly's hurricane numbers: their earlier U.S. process took seven months to pay 6,363 people; with data-driven targeting and remote enrollment, more than 90% were paid in under 24 hours. We wanted to give a five-volunteer neighborhood fund that same speed, without giving up the human judgment and controls that keep a fund trustworthy.

## What it does

Tideover is the operating system for a community emergency fund, with three sides:

**People in need** chat with an AI caseworker (Claude) in their own language, by text or voice. It asks only what the fund's policy needs, reads a photo or PDF of the bill or estimate on the spot, and checks it against the story. They verify their payout account with **Log in with PayPal** (or use Venmo or a PayPal email) and follow their request live. No account, no SSN, no forms.

**Volunteers and organizers** get a case file instead of a pile of paperwork: a summary, a recommended amount, a confidence score, and every rule of the fund's own policy checked with quoted evidence. Deterministic checks the AI cannot override catch duplicates, reused documents, near-identical stories, cooldowns, velocity, caps and amount mismatches. One tap approves and sends the grant through **PayPal Payouts**. Grants over a threshold need two different reviewers. Organizers write their policy in plain English and Claude compiles it into the structured rubric the whole system enforces. A treasurer copilot, built with the **PayPal Agent Toolkit**, answers questions from live data and reconciles the books against PayPal in both directions. Every AI output, human decision and PayPal event lands in an append-only audit log.

**Donors** see a live public ledger: every gift and grant, the balance, and the median minutes from request to cash. When an approved request is waiting for funds, a donor can fund it directly with PayPal, Venmo or Pay Later, and the grant pays out the moment the payment is captured. **AI agents can give too:** Tideover's MCP server lets an assistant like Claude find verified needs and start a donation, then hands the human a PayPal checkout to approve. That's agentic commerce with a human in the loop for the money.

The principle throughout: **AI proposes, people decide, rules enforce.**

## How we built it

- **Flutter** app for web, iOS and Android: an applicant chat with voice input, camera and document upload; public fund pages; and a full staff console. Realtime updates arrive over Server-Sent Events.
- **TypeScript / Node 22 / Fastify** server with **Drizzle** on **Postgres** (embedded PGlite for development and tests).
- **PayPal:** Payouts v1 (PayPal, Venmo and verified `PAYPAL_ID` recipients) with `sender_batch_id` and `PayPal-Request-Id` idempotency; Orders v2 with the JS SDK Smart Buttons (PayPal, Venmo, Pay Later, cards); Log in with PayPal (`userinfo`, `paypalattributes`); webhooks with signature verification; refunds; Transaction Search for reconciliation; and the PayPal Agent Toolkit in the copilot.
- **Claude (`claude-opus-5-5`)** through the Anthropic SDK: a streaming tool-use agent for intake, vision with structured outputs for documents, structured outputs at high effort for assessments and the policy compiler, short generations for multilingual decision messages and anonymized impact stories, and a tool-using copilot. We use prompt caching for the long policy prompts and server-side fallbacks for resilience. Every AI call has a deterministic fallback, so the fund keeps running if the AI is down.
- **MCP** (Streamable HTTP) server for agent donations.
- An in-process **PayPal simulator** that speaks the same wire formats and state machines, so the whole product runs offline and the test suite is deterministic. The same domain code runs against the real sandbox.
- Shipped as one **Docker** image with a **Render** blueprint (web service + Postgres).

## Challenges we ran into

- **Money that moves exactly once.** API responses, webhooks and a poller all race to update the same payout. We built one state machine they all feed, wrote the payout row (and its `sender_batch_id`) before calling PayPal, retried transient failures with the same idempotency keys, and put a per-fund lock around the balance check so two approvals can never overdraw a fund.
- **Making the AI useful without putting it in charge.** It's tempting to let the model approve grants. Instead the AI writes the case file, code enforces caps, balance and duplicates, and auto-approval (off by default) only fires for small, clean, document-backed requests to PayPal-verified accounts.
- **Real-world documents.** Phone photos of crumpled estimates, handwritten invoices, PDFs of utility bills. We tuned the extraction to tell real red flags (edited totals, impossible dates) apart from normal mess, and to treat any text inside a document as evidence, never instructions.
- **A simulator faithful enough to trust.** To test refunds, unclaimed payouts, Venmo validation errors and webhook ordering without real money, the simulator mirrors PayPal's payloads, statuses, error shapes and fees, and it rebuilds its history from the database after a restart.

## Accomplishments that we're proud of

- The full journey works end to end: a Spanish-speaking applicant with a document and a verified PayPal account, reviewer approval, a PayPal payout, and the applicant seeing "money sent", verified in a real browser with Playwright.
- A donor funding a specific approved need and watching it pay out instantly.
- 39 automated tests across the applicant flow, approvals and the two-person rule, risk checks, webhooks, MCP, reconciliation, and contract tests for both the PayPal REST client and the Claude provider.
- It works for real today: one `render.yaml`, and any community fund can run it.

## What we learned

- Speed and safety are not a trade-off when the boundaries are right: AI for understanding, code for money rules, people for judgment.
- PayPal's verified identity (Log in with PayPal → payer ID) removes a whole class of fraud and typos that plague mutual aid funds that pay to typed-in handles.
- Transparency is a feature, not a report. Showing donors the grant their gift made, minutes later, is the strongest case for giving again that a small fund can make.

## What's next

- Pilots with a mutual aid network and a campus emergency fund.
- PayPal Subscriptions for recurring "be someone's safety net" monthly giving.
- Vendor payouts (pay the mechanic or landlord directly) and PayPal invoicing for partner organizations.
- SMS and WhatsApp intake for people without smartphones or data.
- Multi-fund networks that route an applicant to the right fund automatically.

## Built with

`paypal-payouts` `paypal-orders-v2` `paypal-js-sdk` `log-in-with-paypal` `paypal-webhooks` `paypal-agent-toolkit` `venmo` `claude` `anthropic` `model-context-protocol` `flutter` `dart` `typescript` `node.js` `fastify` `postgresql` `drizzle-orm` `docker` `render`
