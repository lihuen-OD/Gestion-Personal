import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListDocumentCategoriesQuery } from "./documentCategories.schemas";
import { documentCategoriesService } from "./documentCategories.service";

export const documentCategoriesController = {
  list: (async (req, res) => {
    const result = await documentCategoriesService.list(req.query as unknown as ListDocumentCategoriesQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await documentCategoriesService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await documentCategoriesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
