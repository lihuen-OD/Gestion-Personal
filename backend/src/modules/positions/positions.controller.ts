import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListPositionsQuery } from "./positions.schemas";
import { positionsService } from "./positions.service";

export const positionsController = {
  list: (async (req, res) => {
    const result = await positionsService.list(req.query as unknown as ListPositionsQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const item = await positionsService.getById(requireParam(req, "id"));
    res.json({ data: item });
  }) satisfies RequestHandler,

  assignedEmployees: (async (req, res) => {
    const items = await positionsService.listAssignedEmployees(requireParam(req, "id"));
    res.json({ data: items });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await positionsService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await positionsService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const item = await positionsService.remove(requireParam(req, "id"), requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,
};
