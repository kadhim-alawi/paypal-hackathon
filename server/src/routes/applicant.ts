import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { documents } from "../db/schema.js";
import {
  addDocument,
  buildApplicantView,
  loadApplication,
  loadApplicationForApplicant,
  MAX_DOCUMENT_BYTES,
  postApplicantMessage,
  setPayoutDestination,
  startApplication,
  submitApplication,
  withdrawApplication,
} from "../domain/applications.js";
import { applicantToken, signState, verifyState } from "../http/auth.js";
import { streamEvents } from "../http/sse.js";
import { badRequest, notFound } from "../lib/errors.js";
import { sha256Hex } from "../lib/ids.js";
import type { Services } from "../services.js";

const StartBody = z.object({ language: z.string().max(8).optional() }).optional();
const MessageBody = z.object({ content: z.string().min(1).max(4000) });
const PayoutBody = z.object({
  method: z.enum(["paypal_email", "venmo_phone"]),
  receiver: z.string().min(3).max(200),
});
const SubmitBody = z.object({
  consentPublicStory: z.boolean().default(false),
  category: z.string().max(60).nullish(),
  amountCents: z.number().int().positive().max(10_000_000).nullish(),
  name: z.string().max(120).nullish(),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest("Invalid request", r.error.issues);
  return r.data;
}

export async function applicantRoutes(app: FastifyInstance, s: Services) {
  // Start a new request (anonymous). Returns the secret token for the private link.
  app.post<{ Params: { slug: string } }>(
    "/api/funds/:slug/applications",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const body = parse(StartBody, req.body);
      const fingerprint = sha256Hex(`${req.ip}|${req.headers["user-agent"] ?? ""}`).slice(0, 24);
      const { application, token } = await startApplication(s, req.params.slug, {
        fingerprint,
        language: body?.language,
      });
      reply.code(201);
      return { id: application.id, publicRef: application.publicRef, token };
    },
  );

  app.get<{ Params: { id: string } }>("/api/applications/:id", async (req) => {
    const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
    return buildApplicantView(s, a.id);
  });

  app.get<{ Params: { id: string } }>("/api/applications/:id/events", async (req, reply) => {
    const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
    await streamEvents(req, reply, s.bus, [`app:${a.id}`], async () => [
      { type: "application.updated", data: await buildApplicantView(s, a.id), at: new Date().toISOString() },
    ]);
  });

  app.post<{ Params: { id: string } }>(
    "/api/applications/:id/messages",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
      const { content } = parse(MessageBody, req.body);
      const msg = await postApplicantMessage(s, a, content);
      reply.code(202);
      return { id: msg.id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/applications/:id/documents",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
      const file = await req.file({ limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });
      if (!file) throw badRequest("No file uploaded");
      const data = await file.toBuffer();
      if (file.file.truncated) throw badRequest("Files can be up to 10 MB.");
      const id = await addDocument(s, a, { filename: file.filename, mimeType: file.mimetype, data });
      reply.code(201);
      return { id };
    },
  );

  app.get<{ Params: { id: string; docId: string } }>("/api/applications/:id/documents/:docId", async (req, reply) => {
    const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
    const [doc] = await s.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, req.params.docId), eq(documents.applicationId, a.id)))
      .limit(1);
    if (!doc) throw notFound("Document");
    reply.header("Content-Type", doc.mimeType).header("Cache-Control", "private, max-age=300");
    return reply.send(doc.data);
  });

  app.put<{ Params: { id: string } }>("/api/applications/:id/payout", async (req) => {
    const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
    const body = parse(PayoutBody, req.body);
    await setPayoutDestination(s, a, body);
    return buildApplicantView(s, a.id);
  });

  /** Starts "Log in with PayPal" to verify the applicant's PayPal account for payouts. */
  app.get<{ Params: { id: string }; Querystring: { client?: string } }>(
    "/api/applications/:id/paypal/connect",
    async (req) => {
      const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
      const state = await signState(s, { appId: a.id, client: req.query.client === "app" ? "app" : "web" });
      return { url: s.paypal.buildLoginUrl(state, `${s.config.publicUrl}/api/paypal/login/callback`) };
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/paypal/login/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      let payload: Record<string, unknown>;
      try {
        payload = await verifyState(s, state ?? "");
      } catch {
        return reply.code(400).type("text/html").send(resultPage("This link expired. Please go back and try again.", false));
      }
      const appId = String(payload.appId);
      const back = payload.client === "app" ? null : `${s.config.publicUrl}/r/${appId}`;
      if (error || !code) {
        return back ? reply.redirect(`${back}?paypal=cancelled`) : reply.type("text/html").send(resultPage("PayPal sign-in was cancelled.", false));
      }
      try {
        const identity = await s.paypal.exchangeLoginCode(code, `${s.config.publicUrl}/api/paypal/login/callback`);
        const a = await loadApplication(s, appId);
        await setPayoutDestination(s, a, {
          method: "paypal_account",
          payerId: identity.payerId,
          email: identity.email,
          name: identity.name,
          verified: identity.verifiedAccount,
        });
      } catch (err) {
        req.log.error({ err }, "Log in with PayPal failed");
        return back ? reply.redirect(`${back}?paypal=error`) : reply.type("text/html").send(resultPage("We couldn't connect PayPal. Please try again.", false));
      }
      return back
        ? reply.redirect(`${back}?paypal=connected`)
        : reply.type("text/html").send(resultPage("PayPal connected. You can return to the Tideover app.", true));
    },
  );

  app.post<{ Params: { id: string } }>("/api/applications/:id/submit", async (req) => {
    const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
    await submitApplication(s, a, parse(SubmitBody, req.body ?? {}));
    return buildApplicantView(s, a.id);
  });

  app.post<{ Params: { id: string } }>("/api/applications/:id/withdraw", async (req) => {
    const a = await loadApplicationForApplicant(s, req.params.id, applicantToken(req));
    await withdrawApplication(s, a);
    return buildApplicantView(s, a.id);
  });
}

function resultPage(message: string, ok: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tideover</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F6F4EF;color:#14211D;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.card{background:#fff;border-radius:20px;padding:32px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08)}
.dot{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;font-size:28px;color:#fff;background:${ok ? "#0E7C66" : "#B42318"}}</style></head>
<body><div class="card"><div class="dot">${ok ? "✓" : "!"}</div><p>${message}</p></div></body></html>`;
}
