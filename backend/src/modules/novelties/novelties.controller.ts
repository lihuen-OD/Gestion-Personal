import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListNoveltiesQuery } from "./novelties.schemas";
import { noveltiesService } from "./novelties.service";

export const noveltiesController = {
  list: (async (req, res) => {
    const result = await noveltiesService.list(req.query as unknown as ListNoveltiesQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const items = await noveltiesService.create(req.body, req.user!, requestAuditContext(req));
    res.status(201).json({ data: items });
  }) satisfies RequestHandler,

  approve: (async (req, res) => {
    const item = await noveltiesService.approve(requireParam(req, "id"), req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  reject: (async (req, res) => {
    const item = await noveltiesService.reject(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
