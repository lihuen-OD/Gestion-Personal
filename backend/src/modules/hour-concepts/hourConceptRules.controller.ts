import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListHourConceptRulesQuery } from "./hourConceptRules.schemas";
import { hourConceptRulesService } from "./hourConceptRules.service";

export const hourConceptRulesController = {
  list: (async (req, res) => {
    const result = await hourConceptRulesService.list(req.query as unknown as ListHourConceptRulesQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const item = await hourConceptRulesService.getById(requireParam(req, "id"));
    res.json({ data: item });
  }) satisfies RequestHandler,

  getByConcept: (async (req, res) => {
    const items = await hourConceptRulesService.getByConcept(requireParam(req, "hourConceptId"));
    res.json({ data: items });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await hourConceptRulesService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await hourConceptRulesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  updateStatus: (async (req, res) => {
    const item = await hourConceptRulesService.updateStatus(requireParam(req, "id"), req.body.status, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
