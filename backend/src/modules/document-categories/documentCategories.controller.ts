import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import type { ListDocumentCategoriesQuery } from "./documentCategories.schemas";
import { documentCategoriesService } from "./documentCategories.service";

const documentCategoriesReadCache = createTtlCache<Awaited<ReturnType<typeof documentCategoriesService.list>>>(60_000);

export const documentCategoriesController = {
  list: (async (req, res) => {
    const cached = documentCategoriesReadCache.get(req.originalUrl);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await documentCategoriesService.list(req.query as unknown as ListDocumentCategoriesQuery);
    documentCategoriesReadCache.set(req.originalUrl, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await documentCategoriesService.create(req.body, requestAuditContext(req));
    documentCategoriesReadCache.clear();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await documentCategoriesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    documentCategoriesReadCache.clear();
    res.json({ data: item });
  }) satisfies RequestHandler,
};
