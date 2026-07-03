import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import type { ListHourConceptsQuery } from "./hourConcepts.schemas";
import { hourConceptsService } from "./hourConcepts.service";

const hourConceptsReadCache = createTtlCache<Awaited<ReturnType<typeof hourConceptsService.list>>>(60_000);

export const hourConceptsController = {
  list: (async (req, res) => {
    const cached = hourConceptsReadCache.get(req.originalUrl);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await hourConceptsService.list(req.query as unknown as ListHourConceptsQuery);
    hourConceptsReadCache.set(req.originalUrl, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await hourConceptsService.create(req.body, requestAuditContext(req));
    hourConceptsReadCache.clear();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await hourConceptsService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    hourConceptsReadCache.clear();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
