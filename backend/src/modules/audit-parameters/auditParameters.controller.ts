import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { auditParametersService } from "./auditParameters.service";
import type { ListAuditParametersQuery } from "./auditParameters.schemas";

export const auditParametersController = {
  list: (async (req, res) => {
    const result = await auditParametersService.list(req.query as unknown as ListAuditParametersQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await auditParametersService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await auditParametersService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
