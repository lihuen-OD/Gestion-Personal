import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListTimeEntriesQuery, TimeEntriesExportQuery, TimeEntriesPeriodEmployeesQuery, TimeEntriesSummaryQuery } from "./timeEntries.schemas";
import { clearTimeEntriesReadCaches, timeEntriesListCache, timeEntriesPeriodEmployeesCache, timeEntriesSummaryCache } from "./timeEntries.cache";
import { timeEntriesExportToCsv, timeEntriesService } from "./timeEntries.service";

function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const timeEntriesController = {
  list: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = timeEntriesListCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await timeEntriesService.list(req.query as unknown as ListTimeEntriesQuery, req.user!);
    timeEntriesListCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  summary: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = timeEntriesSummaryCache.get(key);
    if (cached) return res.json({ data: cached });
    const result = await timeEntriesService.summary(req.query as unknown as TimeEntriesSummaryQuery, req.user!);
    timeEntriesSummaryCache.set(key, result);
    res.json({ data: result });
  }) satisfies RequestHandler,

  periodEmployees: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = timeEntriesPeriodEmployeesCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await timeEntriesService.periodEmployees(req.query as unknown as TimeEntriesPeriodEmployeesQuery, req.user!);
    timeEntriesPeriodEmployeesCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await timeEntriesService.create(req.body, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await timeEntriesService.update(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  submit: (async (req, res) => {
    const item = await timeEntriesService.submit(requireParam(req, "id"), req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  approve: (async (req, res) => {
    const item = await timeEntriesService.approve(requireParam(req, "id"), req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  reject: (async (req, res) => {
    const item = await timeEntriesService.reject(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  returnForCorrection: (async (req, res) => {
    const item = await timeEntriesService.returnForCorrection(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  exportJson: (async (req, res) => {
    const result = await timeEntriesService.exportByPerson(req.query as unknown as TimeEntriesExportQuery, req.user!, requestAuditContext(req));
    res.json({ data: result });
  }) satisfies RequestHandler,

  exportCsv: (async (req, res) => {
    const query = req.query as unknown as TimeEntriesExportQuery;
    const result = await timeEntriesService.exportByPerson(query, req.user!, requestAuditContext(req));
    const csv = timeEntriesExportToCsv(result.rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="horas_trabajadas_${query.period}.csv"`);
    res.send(`\uFEFF${csv}`);
  }) satisfies RequestHandler,
};
