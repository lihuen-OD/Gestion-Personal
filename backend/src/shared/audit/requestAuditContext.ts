import type { Request } from "express";
import type { AuditContext } from "../../modules/audit/audit.service";

export function requestAuditContext(req: Request): AuditContext {
  return {
    userId: req.user?.id || null,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || null,
  };
}
