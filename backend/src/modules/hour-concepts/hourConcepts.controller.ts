import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListHourConceptsQuery } from "./hourConcepts.schemas";
import { hourConceptsService } from "./hourConcepts.service";

export const hourConceptsController = {
  list: (async (req, res) => {
    const result = await hourConceptsService.list(req.query as unknown as ListHourConceptsQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await hourConceptsService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await hourConceptsService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
