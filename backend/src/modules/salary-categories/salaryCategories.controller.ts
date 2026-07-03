import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import { salaryCategoriesService } from "./salaryCategories.service";
import type { ListSalaryCategoriesQuery } from "./salaryCategories.schemas";

const salaryCategoriesReadCache = createTtlCache<Awaited<ReturnType<typeof salaryCategoriesService.list>>>(60_000);

export const salaryCategoriesController = {
  list: (async (req, res) => {
    const cached = salaryCategoriesReadCache.get(req.originalUrl);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await salaryCategoriesService.list(req.query as unknown as ListSalaryCategoriesQuery);
    salaryCategoriesReadCache.set(req.originalUrl, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await salaryCategoriesService.create(req.body, requestAuditContext(req));
    salaryCategoriesReadCache.clear();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await salaryCategoriesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    salaryCategoriesReadCache.clear();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
