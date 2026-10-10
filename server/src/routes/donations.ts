import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadApplication, loadFund } from "../domain/applications.js";
import {
  captureDonation,
  createDonation,
  createDonationOrder,
  loadDonation,
  orderApprovalUrl,
} from "../domain/donations.js";
import { badRequest } from "../lib/errors.js";
import { formatMoney } from "../lib/money.js";
import type { Services } from "../services.js";

const CreateBody = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
  applicationId: z.string().max(64).nullish(),
  donorName: z.string().max(80).nullish(),
  donorMessage: z.string().max(280).nullish(),
  anonymous: z.boolean().optional(),
});
const OrderBody = z.object({ fundingSource: z.enum(["paypal", "venmo", "paylater", "card"]).nullish() });
const CaptureBody = z.object({ orderId: z.string().min(5).max(64) });

export async function donationStatus(s: Services, id: string) {
  const d = await loadDonation(s, id);
  const fund = await loadFund(s, d.fundId);
  let need = null;
  if (d.applicationId) {
    const a = await loadApplication(s, d.applicationId);
    need = {
      id: a.id,
      categoryLabel: fund.rubric.categories.find((c) => c.key === a.category)?.label ?? "Emergency expense",
      amountCents: a.amountApprovedCents,
      status: a.status,
      paidAt: a.paidAt?.toISOString() ?? null,
    };
  }
  return {
    id: d.id,
    amountCents: d.amountCents,
    currency: d.currency,
    status: d.status,
    source: d.source,
    capturedAt: d.capturedAt?.toISOString() ?? null,
    fund: { slug: fund.slug, name: fund.name, accentColor: fund.accentColor },
    need,
  };
}

export async function donationRoutes(app: FastifyInstance, s: Services) {
  app.post<{ Params: { slug: string } }>(
    "/api/funds/:slug/donations",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) throw badRequest("Invalid gift", parsed.error.issues);
      const { donation, checkoutUrl } = await createDonation(s, { fundSlug: req.params.slug, ...parsed.data });
      reply.code(201);
      return { id: donation.id, checkoutUrl };
    },
  );

  app.get<{ Params: { id: string } }>("/api/donations/:id", async (req) => donationStatus(s, req.params.id));

  // PayPal JS SDK: createOrder callback.
  app.post<{ Params: { id: string } }>("/api/donations/:id/order", async (req) => {
    const body = OrderBody.parse(req.body ?? {});
    const order = await createDonationOrder(s, req.params.id, {
      flow: "buttons",
      fundingSource: body.fundingSource ?? undefined,
    });
    return { orderId: order.id };
  });

  // PayPal JS SDK: onApprove callback.
  app.post<{ Params: { id: string } }>("/api/donations/:id/capture", async (req) => {
    const { orderId } = CaptureBody.parse(req.body ?? {});
    const d = await captureDonation(s, req.params.id, orderId);
    const fund = await loadFund(s, d.fundId);
    return { status: d.status, redirect: `${s.config.publicUrl}/f/${fund.slug}/thanks/${d.id}` };
  });

  // Redirect flow (no JavaScript SDK): send the buyer to PayPal and back.
  app.get<{ Params: { id: string } }>("/api/donations/:id/redirect", async (req, reply) => {
    const order = await createDonationOrder(s, req.params.id, { flow: "redirect" });
    return reply.redirect(orderApprovalUrl(order));
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>("/api/donations/:id/return", async (req, reply) => {
    const d = await loadDonation(s, req.params.id);
    const fund = await loadFund(s, d.fundId);
    try {
      await captureDonation(s, d.id, req.query.token);
      return reply.redirect(`${s.config.publicUrl}/f/${fund.slug}/thanks/${d.id}`);
    } catch (err) {
      req.log.warn({ err }, "redirect capture failed");
      return reply.redirect(`${s.config.publicUrl}/f/${fund.slug}?gift=failed`);
    }
  });

  /** Hosted checkout page with PayPal Smart Buttons (PayPal, Venmo, Pay Later, cards). */
  app.get<{ Params: { id: string } }>("/give/checkout/:id", async (req, reply) => {
    const status = await donationStatus(s, req.params.id);
    reply.type("text/html").header("Cache-Control", "no-store");
    return checkoutPage(s, status);
  });
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function checkoutPage(s: Services, d: Awaited<ReturnType<typeof donationStatus>>): string {
  const amount = formatMoney(d.amountCents, d.currency);
  const accent = /^#[0-9a-f]{6}$/i.test(d.fund.accentColor) ? d.fund.accentColor : "#0E7C66";
  const done = d.status === "captured";
  const simulated = s.paypal.mode === "simulated";
  const sdk = simulated
    ? ""
    : `<script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(s.paypal.clientId ?? "")}&currency=${encodeURIComponent(d.currency)}&intent=capture&components=buttons&enable-funding=venmo,paylater" data-partner-attribution-id="" defer></script>`;
  const what = d.need
    ? `Fund an approved ${esc(d.need.categoryLabel.toLowerCase())} grant. The money goes out the moment your payment completes.`
    : `Every dollar goes to neighbors in an emergency. You'll see where it goes on the fund's public page.`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Give ${esc(amount)} · ${esc(d.fund.name)}</title>
<style>
:root{--accent:${accent};--ink:#14211D;--muted:#5B6B66;--bg:#F6F4EF;--card:#fff;--line:#E6E1D6}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:480px;margin:0 auto;padding:24px 16px 48px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;margin-bottom:20px}
.logo{width:30px;height:30px;border-radius:9px;background:var(--accent);display:grid;place-items:center;color:#fff;font-size:17px}
.card{background:var(--card);border-radius:22px;padding:24px;box-shadow:0 1px 0 var(--line),0 12px 32px rgba(20,33,29,.06)}
.fund{color:var(--muted);font-size:14px;margin:0 0 6px}.amount{font-size:44px;font-weight:800;letter-spacing:-.03em;margin:0}
.what{color:var(--muted);line-height:1.5;margin:10px 0 22px}
.notice{font-size:13px;background:#FFF7E6;border:1px solid #F5D9A8;color:#7A5300;border-radius:12px;padding:10px 12px;margin-bottom:16px}
.err{display:none;color:#B42318;font-size:14px;margin-top:12px}
.done{text-align:center;padding:12px 0}.check{width:56px;height:56px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;margin:0 auto 12px;font-size:28px}
.sim{border:1px solid var(--line);border-radius:16px;padding:16px}
.sim h3{margin:0 0 4px;font-size:15px}.sim p{margin:0 0 12px;color:var(--muted);font-size:13px}
.ppbtn{width:100%;border:0;border-radius:999px;padding:14px;font-weight:700;font-size:16px;cursor:pointer;background:#FFC439;color:#111;margin-bottom:10px}
.ppbtn.venmo{background:#008CFF;color:#fff}
.foot{color:var(--muted);font-size:12px;text-align:center;margin-top:18px;line-height:1.5}
</style>${sdk}</head>
<body><div class="wrap">
<div class="brand"><div class="logo">≈</div>Tideover</div>
<div class="card">
${
  done
    ? `<div class="done"><div class="check">✓</div><p class="amount">${esc(amount)}</p><p class="what">Thank you! This gift is complete.</p><a href="${esc(s.config.publicUrl)}/f/${esc(d.fund.slug)}/thanks/${esc(d.id)}">See your impact →</a></div>`
    : `<p class="fund">${esc(d.fund.name)}</p><p class="amount">${esc(amount)}</p><p class="what">${what}</p>
${simulated ? `<div class="notice">PayPal is in <b>simulator mode</b> on this server: no real money moves. Configure PayPal sandbox credentials to use real PayPal checkout.</div>` : ""}
<div id="buttons">${
        simulated
          ? `<div class="sim"><h3>PayPal (simulated)</h3><p>Choose how to pay:</p>
<button class="ppbtn" data-src="paypal">Pay with PayPal</button>
<button class="ppbtn venmo" data-src="venmo">Pay with Venmo</button></div>`
          : ""
      }</div>
<div class="err" id="err"></div>`
}
</div>
<p class="foot">Payments are processed by PayPal. Tideover never sees your card or bank details.<br>Gifts are shown on the fund's public page${d.need ? "" : ""}; you can stay anonymous.</p>
</div>
<script>
const DONATION = ${JSON.stringify(d.id)};
const err = (m) => { const e = document.getElementById('err'); if (e) { e.textContent = m; e.style.display = 'block'; } };
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || 'Something went wrong');
  return j;
}
async function createOrder(source) { return (await post('/api/donations/' + DONATION + '/order', { fundingSource: source || null })).orderId; }
async function capture(orderId) { const j = await post('/api/donations/' + DONATION + '/capture', { orderId }); location.href = j.redirect; }
${
  done
    ? ""
    : simulated
      ? `document.querySelectorAll('.ppbtn').forEach(b => b.addEventListener('click', async () => {
  try { const id = await createOrder(b.dataset.src); location.href = '/sim/paypal/checkout?token=' + encodeURIComponent(id) + '&donation=' + encodeURIComponent(DONATION); }
  catch (e) { err(e.message); }
}));`
      : `window.addEventListener('load', () => {
  if (!window.paypal) { err('PayPal could not load. '); const a = document.createElement('a'); a.href = '/api/donations/' + DONATION + '/redirect'; a.textContent = 'Continue to PayPal instead'; document.getElementById('err').appendChild(a); return; }
  paypal.Buttons({
    style: { shape: 'pill', layout: 'vertical', label: 'donate' },
    createOrder: (data) => createOrder(data && data.paymentSource),
    onApprove: (data) => capture(data.orderID).catch(e => err(e.message)),
    onCancel: () => err('Payment cancelled. You can try again.'),
    onError: (e) => err('PayPal reported a problem: ' + (e && e.message ? e.message : e)),
  }).render('#buttons');
});`
}
</script></body></html>`;
}
