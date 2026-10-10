# Connecting Tideover to the PayPal sandbox

Tideover runs without any PayPal credentials (in simulator mode). This guide switches it to the real PayPal **sandbox**: real Orders, Payouts, Log in with PayPal, webhooks and Transaction Search, with test money. It takes about 15 minutes.

You need a PayPal account to sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).

## 1. Create the sandbox app

1. In the Developer Dashboard, open **Apps & Credentials** and make sure the **Sandbox** toggle is selected.
2. **Create App**: name it `Tideover`, type **Merchant**, and pick the sandbox **business** account that will act as the fund's treasury (the default one is fine).
3. Copy the **Client ID** and **Secret** into `server/.env`:

   ```bash
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   ```

   With both set, Tideover switches to `PAYPAL_MODE=sandbox` automatically, and the banner on every page says so.

## 2. Turn on the features Tideover uses

On the app's page, under **Features** (sometimes shown as *Sandbox app settings*), enable:

| Feature | Why |
|---|---|
| **Accept payments** | Orders v2 for donations (PayPal, Venmo, Pay Later, cards through the JS SDK) |
| **Payouts** | Every grant goes out through the Payouts API |
| **Log in with PayPal** | Verifies the applicant's PayPal account; grants go to the verified payer ID |
| **Transaction search** | Reconciliation in the treasurer copilot |

### Log in with PayPal settings

Open **Log in with PayPal → Advanced settings**:

- **Return URL:** `http://localhost:8080/api/paypal/login/callback` for local use. Add your deployed URL too (step 5).
- **Information requested from customers:** *Full name*, *Email*, *PayPal account ID (payer ID)* and *Account verification status*. Tideover requests the `openid profile email https://uri.paypal.com/services/paypalattributes` scopes, and the verification status comes from `paypalattributes`.
- Fill in the privacy policy and user agreement URLs if the dashboard asks for them (your fund's pages, or the repo for testing).

## 3. Sandbox accounts

Under **Testing Tools → Sandbox Accounts**:

- **Business account** (the app's account) is the fund's PayPal balance. Payouts are paid from it, so it needs a balance. The default sandbox business account normally has one; if it doesn't, create a new business account with a balance (for example $5,000) and recreate the app on it.
- **Personal accounts** play donors and applicants. Create two or three, and note their emails and passwords (*View/Edit account*). Use them to:
  - approve donations at PayPal checkout, and
  - connect a payout account with **Log in with PayPal** when applying. The grant then lands in that account; sign in at [sandbox.paypal.com](https://www.sandbox.paypal.com) to see it arrive.

Set one personal account's email as `PAYPAL_TEST_RECEIVER` for the verification script below.

## 4. Webhooks

Webhooks make status changes instant. Tideover also polls in-flight payouts and captures orders synchronously, so everything still works without webhooks (for example on `localhost`), just a few seconds slower.

1. On the app page, **Add Webhook** with URL `https://<your-host>/api/webhooks/paypal` (PayPal requires a public HTTPS URL; use your deployed URL, or a tunnel such as `cloudflared tunnel --url http://localhost:8080` while developing).
2. Subscribe to these events:
   - `CHECKOUT.ORDER.APPROVED`
   - `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`
   - all `PAYMENT.PAYOUTS-ITEM.*` events (succeeded, unclaimed, failed, blocked, held, returned, refunded, canceled, denied)
   - `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTSBATCH.DENIED`, `PAYMENT.PAYOUTSBATCH.PROCESSING`
3. Copy the **Webhook ID** into `PAYPAL_WEBHOOK_ID`. Tideover verifies every delivery with PayPal's `verify-webhook-signature` API and ignores duplicates.

## 5. Deploy and point PayPal at it

After deploying (see the README's *Deploy* section), with your public URL, for example `https://tideover.onrender.com`:

- Add `https://tideover.onrender.com/api/paypal/login/callback` as a Log in with PayPal **Return URL**.
- Set the webhook URL to `https://tideover.onrender.com/api/webhooks/paypal`, and put its ID in the service's `PAYPAL_WEBHOOK_ID`.
- `PUBLIC_URL` is taken from Render's `RENDER_EXTERNAL_URL` automatically. On other hosts, set `PUBLIC_URL` to the address PayPal should redirect back to.

## 6. Verify everything end to end

```bash
cd server
npm run verify:paypal
```

The script runs against your sandbox app and checks, in order:

1. Orders v2: creates a $1.00 order (redirect flow) and a JS SDK order with Venmo as the funding source.
2. Payouts: sends $1.00 to `PAYPAL_TEST_RECEIVER`, repeats the request with the same `sender_batch_id` to confirm PayPal won't pay twice, and polls the item to a final state.
3. Reporting: Transaction Search for the last 7 days.
4. Webhooks: confirms PayPal's signature verification API rejects a forged event (needs `PAYPAL_WEBHOOK_ID`).
5. Log in with PayPal: builds the authorization URL to open in a browser.

Each step prints ✓ or the PayPal error with its `debug_id`. Then run the app, apply with a sandbox personal account, approve the case in the console, and watch the payout arrive in that account.

## 7. Give judges access

The rules ask for any test accounts or sandbox logins needed to try the project.

1. Create a dedicated sandbox **personal** account for judges (for example `judges@tideover-demo.example`) with a balance, and a memorable password.
2. Put its email and password in the README's *Access for judges* table and in the Devpost testing instructions. It's a sandbox account, so it only holds test money.
3. Keep the hosted demo running until judging ends (**Dec 15, 2026, 8:00 AM PT**). The `render.yaml` plans (starter web service, basic Postgres) stay up and don't expire. Avoid Render's free tiers for the demo: free web services sleep when idle, and free Postgres databases expire after a limited time (30 days when this was written).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `AUTHORIZATION_ERROR` or `NOT_AUTHORIZED` on payouts | Enable **Payouts** on the app (step 2). Sandbox changes can take a few minutes to apply. |
| `INSUFFICIENT_FUNDS` on payouts | The business sandbox account needs a balance (step 3). |
| Log in with PayPal shows "invalid redirect URI" | The Return URL must match `PUBLIC_URL + /api/paypal/login/callback` exactly. |
| Payouts stay `UNCLAIMED` | The receiver email has no sandbox account. Use a sandbox personal account email, or connect with Log in with PayPal. |
| Transaction search returns nothing | Enable **Transaction search**; new transactions can take up to 3 hours to appear. |
| No Venmo button at checkout | In sandbox, Tideover asks the SDK to show what a U.S. buyer sees. Venmo also needs a USD amount. |
| Webhook deliveries fail | The URL must be public HTTPS, and `PAYPAL_WEBHOOK_ID` must belong to the same app as the client ID. |
