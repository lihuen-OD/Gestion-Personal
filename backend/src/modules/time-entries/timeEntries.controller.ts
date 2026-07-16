import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { AppError } from "../../shared/errors/AppError";
import { requireParam } from "../../shared/http/params";
import type { AdminCloseWorkShiftInput, AdminWorkShiftReasonInput, AttendanceObservationsQuery, AttendanceSummaryQuery, ClockByDniInput, ClockByEmployeeInput, ClockEmployeeSearchQuery, ClockPhotoPunchInput, CreateWorkShiftInput, ListTimeEntriesQuery, PreviewWorkShiftInput, ResolveAttendanceObservationInput, TimeEntriesExportQuery, TimeEntriesPeriodEmployeesQuery, TimeEntriesSummaryQuery } from "./timeEntries.schemas";
import { attendanceSummaryCache, clearTimeEntriesReadCaches, timeEntriesListCache, timeEntriesPeriodEmployeesCache, timeEntriesSummaryCache } from "./timeEntries.cache";
import { timeEntriesExportToCsv, timeEntriesService } from "./timeEntries.service";
import { clearEmployeeReadCaches } from "../employees/employees.controller";

function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const timeEntriesController = {
  clockSearch: (async (req, res) => {
    const result = await timeEntriesService.clockSearch(req.query as unknown as ClockEmployeeSearchQuery);
    res.json({ data: result });
  }) satisfies RequestHandler,

  clockStatus: (async (req, res) => {
    const result = await timeEntriesService.clockStatus(req.body as ClockByDniInput);
    res.json({ data: result });
  }) satisfies RequestHandler,

  clockStatusByEmployee: (async (req, res) => {
    const result = await timeEntriesService.clockStatusByEmployee(req.body as ClockByEmployeeInput);
    res.json({ data: result });
  }) satisfies RequestHandler,

  clockIn: (async (req, res) => {
    const result = await timeEntriesService.clockIn(req.body as ClockByDniInput);
    clearTimeEntriesReadCaches();
    clearEmployeeReadCaches();
    res.status(201).json({ data: result });
  }) satisfies RequestHandler,

  clockInByEmployee: (async (req, res) => {
    const result = await timeEntriesService.clockInByEmployee(req.body as ClockByEmployeeInput);
    clearTimeEntriesReadCaches();
    res.status(201).json({ data: result });
  }) satisfies RequestHandler,

  clockOut: (async (req, res) => {
    const result = await timeEntriesService.clockOut(req.body as ClockByDniInput);
    clearTimeEntriesReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  clockOutByEmployee: (async (req, res) => {
    const result = await timeEntriesService.clockOutByEmployee(req.body as ClockByEmployeeInput);
    clearTimeEntriesReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  clockPhotoPunch: (async (req, res) => {
    const result = await timeEntriesService.clockPhotoPunchIdempotent(req.body as ClockPhotoPunchInput, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.status(201).json({ data: result });
  }) satisfies RequestHandler,

  clockPunchAttemptStatus: (async (req, res) => {
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : "";
    if (!employeeId) throw new AppError("employeeId is required", 400, "CLOCK_ATTEMPT_EMPLOYEE_REQUIRED");
    const result = await timeEntriesService.clockPunchAttemptStatus(requireParam(req, "requestId"), employeeId);
    res.json({ data: result });
  }) satisfies RequestHandler,

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

  homeSummary: (async (req, res) => {
    const result = await timeEntriesService.homeSummary(req.user!);
    res.json({ data: result });
  }) satisfies RequestHandler,

  attendanceSummary: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = attendanceSummaryCache.get(key);
    if (cached) return res.json({ data: cached });
    const result = await timeEntriesService.attendanceSummary(req.query as unknown as AttendanceSummaryQuery, req.user!);
    attendanceSummaryCache.set(key, result);
    res.json({ data: result });
  }) satisfies RequestHandler,

  attendanceObservations: (async (req, res) => {
    const result = await timeEntriesService.attendanceObservations(req.query as unknown as AttendanceObservationsQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  resolveAttendanceObservation: (async (req, res) => {
    const result = await timeEntriesService.resolveAttendanceObservation(requireParam(req, "kind"), requireParam(req, "id"), req.body as ResolveAttendanceObservationInput, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    clearEmployeeReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  attendancePunchPhoto: (async (req, res) => {
    const result = await timeEntriesService.attendancePunchPhoto(requireParam(req, "id"), req.user!);
    if (result.kind === "redirect") {
      res.redirect(result.url);
      return;
    }
    if (result.kind === "buffer") {
      res.setHeader("Content-Type", result.mimeType);
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
      res.send(result.buffer);
      return;
    }
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    res.sendFile(result.path);
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await timeEntriesService.create(req.body, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  previewWorkShift: (async (req, res) => {
    const result = await timeEntriesService.previewWorkShift(req.body as PreviewWorkShiftInput, req.user!);
    res.json({ data: result });
  }) satisfies RequestHandler,

  createWorkShift: (async (req, res) => {
    const result = await timeEntriesService.createWorkShift(req.body as CreateWorkShiftInput, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.status(201).json({ data: result });
  }) satisfies RequestHandler,

  closeWorkShiftManually: (async (req, res) => {
    const result = await timeEntriesService.closeWorkShiftManually(requireParam(req, "id"), req.body as AdminCloseWorkShiftInput, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  observeWorkShift: (async (req, res) => {
    const result = await timeEntriesService.observeWorkShift(requireParam(req, "id"), req.body as AdminWorkShiftReasonInput, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  markMissingOut: (async (req, res) => {
    const result = await timeEntriesService.markMissingOut(requireParam(req, "id"), req.body as AdminWorkShiftReasonInput, req.user!, requestAuditContext(req));
    clearTimeEntriesReadCaches();
    res.json({ data: result });
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
