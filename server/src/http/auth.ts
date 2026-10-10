import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { type User, users } from "../db/schema.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import type { Services } from "../services.js";

const enc = (secret: string) => new TextEncoder().encode(secret);

export async function signStaffToken(s: Services, user: User): Promise<string> {
  return new SignJWT({ role: user.role, name: user.name, kind: "staff" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(enc(s.config.jwtSecret));
}

export async function signState(s: Services, payload: Record<string, unknown>, ttl = "15m"): Promise<string> {
  return new SignJWT({ ...payload, kind: "state" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(enc(s.config.jwtSecret));
}

export async function verifyState(s: Services, token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, enc(s.config.jwtSecret));
  if (payload.kind !== "state") throw unauthorized("Invalid state");
  return payload as Record<string, unknown>;
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  // EventSource can't set headers, so SSE endpoints accept ?token=.
  const q = (request.query as Record<string, unknown> | undefined)?.token;
  return typeof q === "string" ? q : undefined;
}

export async function requireStaff(s: Services, request: FastifyRequest, role?: "admin"): Promise<User> {
  const token = bearer(request);
  if (!token) throw unauthorized();
  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, enc(s.config.jwtSecret));
    if (payload.kind !== "staff") throw new Error("wrong token kind");
    sub = payload.sub;
  } catch {
    throw unauthorized("Your session expired. Please sign in again.");
  }
  const [user] = await s.db.select().from(users).where(eq(users.id, sub!)).limit(1);
  if (!user) throw unauthorized();
  if (role === "admin" && user.role !== "admin") throw forbidden("Admins only");
  return user;
}

export function applicantToken(request: FastifyRequest): string | undefined {
  const header = request.headers["x-applicant-token"];
  if (typeof header === "string") return header;
  const q = (request.query as Record<string, unknown> | undefined)?.token;
  return typeof q === "string" ? q : undefined;
}
