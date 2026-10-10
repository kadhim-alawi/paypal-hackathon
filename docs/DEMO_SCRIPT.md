# Demo video script (2:50)

The rules ask for a video under 3 minutes on YouTube. This script tells one story end to end: a real need, real PayPal sandbox money, Claude doing the casework, and a human making the call. Aim for 2:45–2:55.

## Before recording

- Run the deployed app in **sandbox + Claude** mode (the banner should read *PayPal sandbox · Claude*), not the simulator, so the PayPal pages are real.
- Prepare two sandbox personal accounts: **Maria** (applicant, connects with Log in with PayPal) and **Alex** (donor). Keep a logged-in tab on [sandbox.paypal.com](https://www.sandbox.paypal.com) as Maria to show the money arriving.
- Phone shots: Chrome DevTools device mode (iPhone 14 size) or the Flutter app on a device. Console shots: a 1440×900 browser window.
- Have `demo-assets/eastside-auto-estimate-380.jpg` on the phone or desktop.
- Do one full dry run first. The AI and payouts take a few seconds, so record each segment separately and cut out the waits (show a small "fast-forwarded" label, never fake a result).
- Optional for the agent segment: add `https://<your-host>/mcp` as a custom connector in Claude (Settings → Connectors).

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
| **2:05–2:25** | Claude with the Tideover connector: "Find an approved need in Austin and give $25." Claude calls `find_needs` and `create_donation` and returns a PayPal link; the human approves it. | "Tideover also speaks MCP, so your AI assistant can find a real, verified need and give. It hands back a PayPal checkout, and nothing moves until you approve it." |
| **2:25–2:42** | Console Copilot: "Reconcile us with PayPal for the last 7 days." Tool chips show the PayPal Agent Toolkit. Quick cut to the Audit log. | "Treasurers get a copilot that reads live PayPal data through the PayPal Agent Toolkit and reconciles the books in both directions. Every AI output, decision and PayPal event is in an append-only audit log." |
| **2:42–2:52** | Home page hero, then the logo. Text on screen: *AI proposes · people decide · rules enforce*. | "Tideover: emergency cash in minutes, not months. Open source, and ready for any community fund today." |

## Shot list checklist

- [ ] Banner shows sandbox + Claude (not simulator)
- [ ] Spanish conversation with a document read on screen
- [ ] Real PayPal sandbox login and checkout pages (PayPal branding visible)
- [ ] Money visibly arriving in a sandbox account
- [ ] The two-person rule or decline flow mentioned (optional, if time allows)
- [ ] MCP agent donation with human approval
- [ ] Copilot tool chips showing the PayPal Agent Toolkit
- [ ] Ends under 3:00, with captions burned in (many judges watch muted)
