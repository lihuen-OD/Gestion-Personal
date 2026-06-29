import type { RequestHandler } from "express";
import type { ListAuditQuery } from "./audit.schemas";
import { auditService } from "./audit.service";

export const auditController = {
  list: (async (req, res) => {
    const result = await auditService.list(req.query as unknown as ListAuditQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,
};
