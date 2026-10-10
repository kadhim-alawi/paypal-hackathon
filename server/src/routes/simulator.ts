import type { FastifyInstance } from "fastify";
import { formatMoney, toCents } from "../lib/money.js";
import { SIM_PERSONAS, SimulatedPayPalGateway } from "../paypal/simulator.js";
import type { Services } from "../services.js";

/**
 * Pages that stand in for paypal.com when PAYPAL_MODE=simulated: order approval
 * and "Log in with PayPal". They are clearly labelled and only mounted in
 * simulated mode.
 */
export async function simulatorRoutes(app: FastifyInstance, s: Services) {
  if (!(s.paypal instanceof SimulatedPayPalGateway)) return;
  const sim = s.paypal;

  const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F5F7FA;color:#001435}
.top{background:#fff;border-bottom:1px solid #E5E8EC;padding:14px 16px;display:flex;align-items:center;gap:10px}
.pp{font-weight:900;font-style:italic;font-size:22px;color:#003087}.pp span{color:#0070E0}.tag{margin-left:auto;font-size:12px;background:#FFF4CE;color:#6B4E00;border-radius:999px;padding:4px 10px}
.wrap{max-width:440px;margin:24px auto;padding:0 16px}.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.amt{font-size:34px;font-weight:800;margin:4px 0 2px}.muted{color:#5B6B7F;font-size:14px}
label.p{display:flex;gap:12px;align-items:center;border:1px solid #DDE3EA;border-radius:12px;padding:12px;margin:10px 0;cursor:pointer}
label.p input{accent-color:#0070E0}.btn{width:100%;border:0;border-radius:999px;padding:14px;background:#0070E0;color:#fff;font-weight:700;font-size:16px;margin-top:12px;cursor:pointer}
.ghost{background:#fff;color:#0070E0;border:1px solid #0070E0}</style></head>
<body><div class="top"><div class="pp">Pay<span>Pal</span></div><div class="tag">Sandbox simulator · no real money</div></div><div class="wrap"><div class="card">${body}</div></div></body></html>`;

  const personaRadios = (defaultKey: string) =>
    SIM_PERSONAS.map(
      (p) => `<label class="p"><input type="radio" name="persona" value="${p.key}" ${p.key === defaultKey ? "checked" : ""}>
<div><b>${p.name}</b><div class="muted">${p.email}${p.verified ? " · verified" : " · unverified"}</div></div></label>`,
    ).join("");

  app.get<{ Querystring: { token?: string; donation?: string } }>("/sim/paypal/checkout", async (req, reply) => {
    const order = await sim.getOrder(req.query.token ?? "");
    const unit = order.purchase_units?.[0];
    const amount = unit?.amount ? formatMoney(toCents(unit.amount.value), unit.amount.currency_code) : "";
    reply.type("text/html");
    return page(
      "PayPal Checkout (simulated)",
      `<div class="muted">${unit?.description ?? "Payment"}</div><div class="amt">${amount}</div>
<form method="post" action="/sim/paypal/checkout/approve">
<input type="hidden" name="token" value="${order.id}"><input type="hidden" name="donation" value="${req.query.donation ?? unit?.custom_id ?? ""}">
<p class="muted" style="margin-top:18px">Log in as a sandbox buyer:</p>${personaRadios("donor")}
<button class="btn" type="submit">Complete purchase</button></form>
<form method="get" action="/give/checkout/${req.query.donation ?? unit?.custom_id ?? ""}"><button class="btn ghost" type="submit">Cancel and return</button></form>`,
    );
  });

  app.post<{ Body: { token?: string; donation?: string; persona?: string } }>(
    "/sim/paypal/checkout/approve",
    async (req, reply) => {
      const body = req.body ?? {};
      const order = sim.approveOrder(body.token ?? "", body.persona ?? "donor");
      const donation = body.donation || order.purchase_units?.[0]?.custom_id || "";
      return reply.redirect(`/api/donations/${encodeURIComponent(donation)}/return?token=${encodeURIComponent(order.id)}`);
    },
  );

  app.get<{ Querystring: { state?: string; redirect_uri?: string } }>("/sim/paypal/login", async (req, reply) => {
    reply.type("text/html");
    return page(
      "Log in with PayPal (simulated)",
      `<h2 style="margin:0 0 6px">Log in with PayPal</h2><p class="muted">Tideover is asking to verify your PayPal account so it can send you money. It will see your name, email and whether your account is verified.</p>
<form method="post" action="/sim/paypal/login"><input type="hidden" name="state" value="${req.query.state ?? ""}"><input type="hidden" name="redirect_uri" value="${req.query.redirect_uri ?? ""}">
${personaRadios("maria")}<button class="btn" type="submit">Agree and connect</button></form>`,
    );
  });

  app.post<{ Body: { state?: string; redirect_uri?: string; persona?: string } }>("/sim/paypal/login", async (req, reply) => {
    const body = req.body ?? {};
    const redirect = body.redirect_uri ?? "";
    if (!redirect.startsWith(s.config.publicUrl)) return reply.code(400).send("Invalid redirect_uri");
    const code = sim.issueLoginCode(body.persona ?? "maria");
    const sep = redirect.includes("?") ? "&" : "?";
    return reply.redirect(`${redirect}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(body.state ?? "")}`);
  });
}
