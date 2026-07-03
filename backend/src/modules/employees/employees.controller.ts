import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import { clearDocumentsReadCaches } from "../documents/documents.cache";
import type { ListEmployeeHistoryQuery, ListEmployeeOptionsQuery, ListEmployeeOrgChartQuery, ListEmployeesQuery } from "./employees.schemas";
import { employeesService } from "./employees.service";

const employeeDetailCache = createTtlCache<unknown>(30_000);
const employeeListCache = createTtlCache<Awaited<ReturnType<typeof employeesService.list>>>(20_000);
const employeeSummaryCache = createTtlCache<Awaited<ReturnType<typeof employeesService.summary>>>(20_000);
const employeeOrgChartCache = createTtlCache<Awaited<ReturnType<typeof employeesService.listOrgChart>>>(20_000);
const employeeOptionsCache = createTtlCache<Awaited<ReturnType<typeof employeesService.listOptions>>>(30_000);

function detailCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${requireParam(req, "id")}`;
}

function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

function clearEmployeeReadCaches() {
  employeeDetailCache.clear();
  employeeListCache.clear();
  employeeSummaryCache.clear();
  employeeOrgChartCache.clear();
  employeeOptionsCache.clear();
}

export const employeesController = {
  list: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = employeeListCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await employeesService.list(req.query as unknown as ListEmployeesQuery, req.user!);
    employeeListCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  listOrgChart: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = employeeOrgChartCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await employeesService.listOrgChart(req.query as unknown as ListEmployeeOrgChartQuery, req.user!);
    employeeOrgChartCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  listOptions: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = employeeOptionsCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await employeesService.listOptions(req.query as unknown as ListEmployeeOptionsQuery, req.user!);
    employeeOptionsCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  summary: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = employeeSummaryCache.get(key);
    if (cached) return res.json({ data: cached });
    const result = await employeesService.summary(req.user!);
    employeeSummaryCache.set(key, result);
    res.json({ data: result });
  }) satisfies RequestHandler,

  getById: (async (req, res) => {
    const key = detailCacheKey(req);
    const cached = employeeDetailCache.get(key);
    if (cached) return res.json({ data: cached });
    const employee = await employeesService.getById(requireParam(req, "id"), req.user!);
    employeeDetailCache.set(key, employee);
    res.json({ data: employee });
  }) satisfies RequestHandler,

  getOverviewById: (async (req, res) => {
    const key = `${detailCacheKey(req)}:overview`;
    const cached = employeeDetailCache.get(key);
    if (cached) return res.json({ data: cached });
    const employee = await employeesService.getOverviewById(requireParam(req, "id"), req.user!);
    employeeDetailCache.set(key, employee);
    res.json({ data: employee });
  }) satisfies RequestHandler,

  getPositionValidation: (async (req, res) => {
    const result = await employeesService.getPositionValidation(requireParam(req, "id"), req.user!);
    res.json({ data: result });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const employee = await employeesService.create(req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.status(201).json({ data: employee });
  }) satisfies RequestHandler,

  syncLaborStatuses: (async (req, res) => {
    const result = await employeesService.syncLaborStatuses(requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const employee = await employeesService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: employee });
  }) satisfies RequestHandler,

  updateContact: (async (req, res) => {
    const employee = await employeesService.updateContact(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: employee });
  }) satisfies RequestHandler,

  upsertAddress: (async (req, res) => {
    const employee = await employeesService.upsertAddress(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: employee });
  }) satisfies RequestHandler,

  upsertTransport: (async (req, res) => {
    const employee = await employeesService.upsertTransport(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: employee });
  }) satisfies RequestHandler,

  replaceAssignments: (async (req, res) => {
    const employee = await employeesService.replaceAssignments(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: employee });
  }) satisfies RequestHandler,

  replaceHourConcepts: (async (req, res) => {
    const employee = await employeesService.replaceHourConcepts(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: employee });
  }) satisfies RequestHandler,

  createLaborMovement: (async (req, res) => {
    const employee = await employeesService.createLaborMovement(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    res.status(201).json({ data: employee });
  }) satisfies RequestHandler,

  createDocument: (async (req, res) => {
    const employee = await employeesService.createDocument(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearEmployeeReadCaches();
    clearDocumentsReadCaches();
    res.status(201).json({ data: employee });
  }) satisfies RequestHandler,

  listFieldHistory: (async (req, res) => {
    const rows = await employeesService.listFieldHistory(requireParam(req, "id"), req.query as unknown as ListEmployeeHistoryQuery, req.user!);
    res.json({ data: rows });
  }) satisfies RequestHandler,

  createFieldHistory: (async (req, res) => {
    const row = await employeesService.createFieldHistory(requireParam(req, "id"), req.body, requestAuditContext(req), req.user!);
    clearEmployeeReadCaches();
    res.status(201).json({ data: row });
  }) satisfies RequestHandler,

  listBlockHistory: (async (req, res) => {
    const rows = await employeesService.listBlockHistory(requireParam(req, "id"), req.query as unknown as ListEmployeeHistoryQuery, req.user!);
    res.json({ data: rows });
  }) satisfies RequestHandler,

  createBlockHistory: (async (req, res) => {
    const row = await employeesService.createBlockHistory(requireParam(req, "id"), req.body, requestAuditContext(req), req.user!);
    clearEmployeeReadCaches();
    res.status(201).json({ data: row });
  }) satisfies RequestHandler,
};
