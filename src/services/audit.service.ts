import { AuditLog } from "../modules/auditLogs/audit.model.js";
import type { Types } from "mongoose";

export async function writeAudit(params: {
  organizationId: string | Types.ObjectId;
  actorId?: string | Types.ObjectId | null;
  action: string;
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  await AuditLog.create({
    organizationId: params.organizationId,
    actorId: params.actorId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    meta: params.meta ?? {},
    ip: params.ip ?? "",
  });
}
