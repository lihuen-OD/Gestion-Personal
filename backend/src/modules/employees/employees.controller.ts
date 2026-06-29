import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListEmployeeHistoryQuery, ListEmployeeOrgChartQuery, ListEmployeesQuery } from "./employees.schemas";
import { employeesService } from "./employees.service";

export const employeesController = {
  list: (async (req, res) => {
    const result = await employeesService.list(req.query as unknown as ListEmployeesQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  listOrgChart: (async (req, res) => {
    const result = await employeesService.listOrgChart(req.query as unknown as ListEmployeeOrgChartQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const employee = await employeesService.getById(requireParam(req, "id"), req.user!);
    res.json({ data: employee });
  }) satisfies RequestHandler,

  getPositionValidation: (async (req, res) => {
    const result = await employeesService.getPositionValidation(requireParam(req, "id"), req.user!);
    res.json({ data: result });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const employee = await employeesService.create(req.body, requestAuditContext(req));
    res.status(201).json({ data: employee });
  }) satisfies RequestHandler,

  syncLaborStatuses: (async (req, res) => {
    const result = await employeesService.syncLaborStatuses(requestAuditContext(req));
    res.json({ data: result });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const employee = await employeesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: employee });
  }) satisfies RequestHandler,

  updateContact: (async (req, res) => {
    const employee = await employeesService.updateContact(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: employee });
  }) satisfies RequestHandler,

  upsertAddress: (async (req, res) => {
    const employee = await employeesService.upsertAddress(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: employee });
  }) satisfies RequestHandler,

  upsertTransport: (async (req, res) => {
    const employee = await employeesService.upsertTransport(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: employee });
  }) satisfies RequestHandler,

  replaceAssignments: (async (req, res) => {
    const employee = await employeesService.replaceAssignments(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: employee });
  }) satisfies RequestHandler,

  replaceHourConcepts: (async (req, res) => {
    const employee = await employeesService.replaceHourConcepts(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.json({ data: employee });
  }) satisfies RequestHandler,

  createLaborMovement: (async (req, res) => {
    const employee = await employeesService.createLaborMovement(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.status(201).json({ data: employee });
  }) satisfies RequestHandler,

  createDocument: (async (req, res) => {
    const employee = await employeesService.createDocument(requireParam(req, "id"), req.body, requestAuditContext(req));
    res.status(201).json({ data: employee });
  }) satisfies RequestHandler,

  listFieldHistory: (async (req, res) => {
    const rows = await employeesService.listFieldHistory(requireParam(req, "id"), req.query as unknown as ListEmployeeHistoryQuery, req.user!);
    res.json({ data: rows });
  }) satisfies RequestHandler,

  createFieldHistory: (async (req, res) => {
    const row = await employeesService.createFieldHistory(requireParam(req, "id"), req.body, requestAuditContext(req), req.user!);
    res.status(201).json({ data: row });
  }) satisfies RequestHandler,

  listBlockHistory: (async (req, res) => {
    const rows = await employeesService.listBlockHistory(requireParam(req, "id"), req.query as unknown as ListEmployeeHistoryQuery, req.user!);
    res.json({ data: rows });
  }) satisfies RequestHandler,

  createBlockHistory: (async (req, res) => {
    const row = await employeesService.createBlockHistory(requireParam(req, "id"), req.body, requestAuditContext(req), req.user!);
    res.status(201).json({ data: row });
  }) satisfies RequestHandler,
};
