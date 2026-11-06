# Demo video script (2:50)

The rules ask for a video **under 3 minutes**, **public on YouTube**, showing the project **working on the device it was built for**, with **no third-party trademarks or copyrighted music** used without permission. Judges may score from the video and write-up alone, so this is the most important deliverable. The script tells one story end to end: a real need, real PayPal sandbox money, Claude doing the casework, and a human making the call. Aim for 2:45–2:55.

## Before recording

- Run the deployed app in **sandbox + Claude** mode (the banner should read *PayPal sandbox · test money only*, with no "simulator" or "AI offline" notice; `/api/config` should say `sandbox` and `claude`), not the simulator, so the PayPal pages are real.
- Prepare two sandbox personal accounts: **Maria** (applicant, connects with Log in with PayPal) and **Alex** (donor). Keep a logged-in tab on [sandbox.paypal.com](https://www.sandbox.paypal.com) as Maria to show the money arriving.
- Phone shots: Chrome DevTools device mode (iPhone 14 size) or the Flutter app on a device. Console shots: a 1440×900 browser window.
- Have `demo-assets/eastside-auto-estimate-380.jpg` on the phone or desktop.
- Do one full dry run first. The AI and payouts take a few seconds, so record each segment separately and cut out the waits (show a small "fast-forwarded" label, never fake a result).
- Agent segment: use the repo's own terminal agent (`cd server && npm run agent -- --url https://<your-host> "..."`) rather than a commercial chat app, so the video shows only your project and PayPal (the sponsor), not another company's product UI.
- Rules hygiene: no background music unless you own it or it's licensed for this use (silence or your own voice is safest). Burn in **English captions** for the Spanish chat lines, since all materials must be in English or translated. Record the real app in a browser at the hosted URL (the web build is the platform it's built for); a real phone running the Flutter app is a bonus shot.

## Script

| Time | Screen | Voice-over |
|---|---|---|
| **0:00–0:14** | Black, then the Tideover home page. Slowly zoom on "37% can't cover a $400 emergency". | "Maria's brakes failed on Monday. If she can't get to the warehouse by Thursday, she loses her job. She needs three hundred eighty dollars, and like 37% of Americans, she doesn't have it." |
| **0:14–0:22** | Eastside fund page: live ledger, "median 11 min to cash". | "Her neighborhood has an emergency fund. Normally that means a form, a spreadsheet, and a week of waiting. This one runs on Tideover." |
| **0:22–0:50** | Phone. Tap **I need help**, type in Spanish. Claude replies in Spanish. Attach the estimate photo; the "Document received: $380, Eastside Auto" card appears. | "Maria writes in Spanish, and so does the caseworker, an agent built on Claude. It asks only what the fund's policy needs. She snaps the mechanic's estimate and Claude reads it: three hundred eighty dollars, brake repair, matches her story." |
| **0:50–1:00** | Review sheet → **Connect PayPal** → real sandbox Log in with PayPal → back, "Verified with PayPal". Submit. | "She connects PayPal in two taps, so the money goes to an account PayPal has verified. No forms, no Social Security number." |
| **1:00–1:30** | Console: new case. Scroll the AI case file: summary, recommended $380, policy checklist with evidence, automated checks "clean". Press **Approve & send $380**. | "A volunteer gets the case file Claude prepared: the recommendation, every policy rule checked with evidence, and automated checks the AI can't override, like duplicates, reused documents and caps. The AI proposes. A person decides." |
| **1:30–1:42** | Split screen: the phone flips to **Money sent**, and Maria's sandbox PayPal shows +$380. | "PayPal Payouts sends it. Four minutes after Maria asked, the money is in her account." |
| **1:42–2:05** | Riverside fund page: an approved need waiting for funds → **Fund this** → PayPal checkout (show the Venmo button) → thanks page ticks to "Delivered to your neighbor". | "When a fund runs short, approved needs show up publicly. A donor pays with PayPal or Venmo, and the grant goes out the moment the payment captures. Donors see exactly where their money went." |
| **2:05–2:25** | Terminal: `npm run agent -- "Find an approved need and give $25"`. The agent lists the tools, calls `find_needs` and `create_donation`, and prints the PayPal link; open it and approve in the sandbox. | "Tideover also speaks MCP, so an AI agent can find a real, verified need and give. It hands back a PayPal checkout, and nothing moves until a person approves it." |
| **2:25–2:42** | Console **Ledger** (AG Grid): every movement with PayPal IDs. Type "total grants by category" and the grid regroups with totals; tap Excel. One-second cut to the Copilot's PayPal Agent Toolkit chips and the Audit log. | "Treasurers get the spreadsheet they already live in, but live and tied to PayPal. Ask it in plain English: Claude answers through AG Grid's AI Toolkit, and the grid does the math. A copilot reconciles with PayPal, and every action is in an audit log." |
| **2:42–2:52** | Home page hero, then the logo. Text on screen: *AI proposes · people decide · rules enforce*. | "Tideover: emergency cash in minutes, not months. Open source, and ready for any community fund today." |

## Shot list checklist

- [ ] Banner reads "PayPal sandbox · test money only" (no simulator or "AI offline" notice)
- [ ] Spanish conversation with a document read on screen
- [ ] Real PayPal sandbox login and checkout pages (PayPal branding visible)
- [ ] Money visibly arriving in a sandbox account
- [ ] The two-person rule or decline flow mentioned (optional, if time allows)
- [ ] Terminal agent donation over MCP, approved by a person in PayPal
- [ ] Ledger question regrouping the AG Grid (the AI changes the view; the numbers come from the grid)
- [ ] Copilot tool chips showing the PayPal Agent Toolkit
- [ ] Ends under 3:00, with captions burned in (many judges watch muted); Spanish lines translated
- [ ] No third-party product UI or logos beyond PayPal/Venmo (the sponsor) and your own app; no unlicensed music
- [ ] Uploaded to YouTube as **Public** (not unlisted or private), and the link is in the Devpost form
