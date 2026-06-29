import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListNoveltyTypesQuery } from "./noveltyTypes.schemas";
import { noveltyTypesService } from "./noveltyTypes.service";

export const noveltyTypesController = {
  list: (async (req, res) => {
    const result = await noveltyTypesService.list(req.query as unknown as ListNoveltyTypesQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const item = await noveltyTypesService.getById(requireParam(req, "id"));
    res.json({ data: item });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await noveltyTypesService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await noveltyTypesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
