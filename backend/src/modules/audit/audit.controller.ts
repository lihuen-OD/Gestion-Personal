import type { RequestHandler } from "express";
import { createTtlCache } from "../../shared/cache/ttlCache";
import type { ListAuditQuery } from "./audit.schemas";
import { auditService } from "./audit.service";

const auditListCache = createTtlCache<Awaited<ReturnType<typeof auditService.list>>>(15_000);

export const auditController = {
  list: (async (req, res) => {
    const key = req.originalUrl;
    const cached = auditListCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await auditService.list(req.query as unknown as ListAuditQuery);
    auditListCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,
};
