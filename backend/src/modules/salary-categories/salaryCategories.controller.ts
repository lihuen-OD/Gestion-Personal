import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { salaryCategoriesService } from "./salaryCategories.service";
import type { ListSalaryCategoriesQuery } from "./salaryCategories.schemas";

export const salaryCategoriesController = {
  list: (async (req, res) => {
    const result = await salaryCategoriesService.list(req.query as unknown as ListSalaryCategoriesQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await salaryCategoriesService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await salaryCategoriesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
