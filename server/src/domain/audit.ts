import { auditEvents } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { newId } from "../lib/ids.js";
import type { ActorType } from "./types.js";

export interface AuditInput {
  fundId?: string | null;
  entityType: "application" | "donation" | "payout" | "fund" | "user" | "webhook" | "copilot";
  entityId: string;
  actorType: ActorType;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  summary: string;
  data?: Record<string, unknown>;
}

/** Append-only audit trail. Every money movement and every decision lands here. */
export async function audit(db: Db, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId("aud"),
    fundId: input.fundId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: input.action,
    summary: input.summary,
    data: input.data ?? {},
  });
}
