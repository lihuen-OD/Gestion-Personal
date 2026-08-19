import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListWorkRegimeEmployeesQuery, ListWorkRegimesQuery, CurrentWorkRegimeQuery } from "./workRegimes.schemas";
import { workRegimesService } from "./workRegimes.service";

export const workRegimesController = {
  list: (async (req, res) => {
    const result = await workRegimesService.list(req.query as unknown as ListWorkRegimesQuery);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const item = await workRegimesService.getById(requireParam(req, "id"));
    res.json({ data: item });
  }) satisfies RequestHandler,

  listEmployees: (async (req, res) => {
    const result = await workRegimesService.listEmployees(requireParam(req, "id"), req.query as unknown as ListWorkRegimeEmployeesQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await workRegimesService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await workRegimesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  updateStatus: (async (req, res) => {
    const item = await workRegimesService.updateStatus(requireParam(req, "id"), req.body.status, requestAuditContext(req));
    res.json({ data: item });
  }) satisfies RequestHandler,

  getHistory: (async (req, res) => {
    const items = await workRegimesService.getHistory(requireParam(req, "employeeId"));
    res.json({ data: items });
  }) satisfies RequestHandler,

  getCurrent: (async (req, res) => {
    const query = req.query as unknown as CurrentWorkRegimeQuery;
    const item = await workRegimesService.getCurrent(requireParam(req, "employeeId"), query.date);
    res.json({ data: item ?? null });
  }) satisfies RequestHandler,

  assign: (async (req, res) => {
    const item = await workRegimesService.assign(requireParam(req, "employeeId"), req.body, requestAuditContext(req));
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  updateAssignment: (async (req, res) => {
    const item = await workRegimesService.updateAssignment(
      requireParam(req, "employeeId"),
      requireParam(req, "assignmentId"),
      req.body,
      requestAuditContext(req),
    );
    res.json({ data: item });
  }) satisfies RequestHandler,

  closeAssignment: (async (req, res) => {
    const item = await workRegimesService.closeAssignment(
      requireParam(req, "employeeId"),
      requireParam(req, "assignmentId"),
      req.body.effectiveTo,
      requestAuditContext(req),
    );
    res.json({ data: item });
  }) satisfies RequestHandler,
};
