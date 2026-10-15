import type { Request, RequestHandler, Response } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { AppError } from "../../shared/errors/AppError";
import { requireParam } from "../../shared/http/params";
import { authenticatedClockDevice } from "../clock-devices/clockDeviceAuthentication";
import { clearEmployeeTimeGridCache } from "../employees/employees.controller";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import type { ClockByEmployeeInput, ClockEmployeeSearchQuery, ClockPhotoPunchInput } from "../time-entries/timeEntries.schemas";
import { timeEntriesService } from "../time-entries/timeEntries.service";
import { clockPunchMetric } from "../../shared/observability/clockPunchTelemetry";

/**
 * Transporte HTTP del fichador (F7, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md
 * §26) en `/api/clock/*`, su único namespace desde F11. El núcleo de la
 * fichada sigue en timeEntriesService; acá sólo se arma el contexto
 * autenticado.
 */
export const clockController = {
  searchEmployees: (async (req, res) => {
    const result = await timeEntriesService.clockSearch(req.query as unknown as ClockEmployeeSearchQuery);
    res.json({ data: result });
  }) satisfies RequestHandler,

  status: (async (req, res) => {
    const result = await timeEntriesService.clockStatusByEmployee(req.body as ClockByEmployeeInput);
    res.json({ data: result });
  }) satisfies RequestHandler,

  // Etapa 15M.2 (docs/decisions/ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md): una
  // salida cierra el WorkShift y crea/actualiza TimeEntry NORMAL_BASE (y
  // dispara la sincronización automática de HourConceptBreakdown), así que
  // invalida la grilla por-legajo además de las cachés de time-entries — la
  // misma invalidación acotada que create()/update() (Etapa 14C.2).
  //
  // El source (KIOSK) lo fija este handler y el dispositivo sale de
  // requireClockDevice: el body no puede elegir ninguno de los dos.
  photoPunch: (async (req: Request, res: Response) => {
    const requestStartedAt = performance.now();
    const device = authenticatedClockDevice(req);
    const requestId = (req.body as ClockPhotoPunchInput).requestId;
    const payloadBytes = Buffer.byteLength(JSON.stringify(req.body), "utf8");
    clockPunchMetric({ requestId, phase: "payload", durationMs: 0, bytes: payloadBytes });
    clockPunchMetric({ requestId, phase: "auth", durationMs: req.clockPunchTimings?.authMs || 0 });
    clockPunchMetric({ requestId, phase: "parse", durationMs: req.clockPunchTimings?.parseMs || 0, bytes: payloadBytes });
    const result = await timeEntriesService.clockPhotoPunchIdempotent(
      req.body as ClockPhotoPunchInput,
      { device: { id: device.id, name: device.name }, source: "KIOSK" },
      requestAuditContext(req),
    );
    clearTimeEntriesReadCaches();
    clearEmployeeTimeGridCache();
    res.once("finish", () => clockPunchMetric({
      requestId,
      phase: "http_response_write",
      durationMs: performance.now() - requestStartedAt,
      result: res.statusCode < 400 ? "success" : "error",
    }));
    res.status(201).json({ data: result });
  }) satisfies RequestHandler,

  attemptStatus: (async (req, res) => {
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : "";
    if (!employeeId) throw new AppError("employeeId is required", 400, "CLOCK_ATTEMPT_EMPLOYEE_REQUIRED");
    const result = await timeEntriesService.clockPunchAttemptStatus(requireParam(req, "requestId"), employeeId, authenticatedClockDevice(req).id);
    res.json({ data: result });
  }) satisfies RequestHandler,
};
