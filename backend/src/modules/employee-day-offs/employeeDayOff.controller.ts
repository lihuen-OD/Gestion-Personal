import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { clearShiftAlertReadCaches } from "../shifts/shiftAlert.cache";
import { clearWorkedTimeDerivedReadCaches } from "../time-entries/workedTimeReadCaches";
import { clearNotificationsListCache } from "../workforce-management/workforce.cache";
import { employeeDayOffService } from "./employeeDayOff.service";
import type { EmployeeDayOffsByDateQuery, ListEmployeeDayOffsQuery } from "./employeeDayOff.schemas";

export const employeeDayOffController = {
  list: (async (req, res) => {
    const result = await employeeDayOffService.list(req.query as unknown as ListEmployeeDayOffsQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  byDate: (async (req, res) => {
    const result = await employeeDayOffService.byDate(req.query as unknown as EmployeeDayOffsByDateQuery, req.user!);
    res.json({ data: { date: result.date, items: result.items }, meta: result.meta });
  }) satisfies RequestHandler,

  save: (async (req, res) => {
    const data = await employeeDayOffService.save(req.body, req.user!, requestAuditContext(req));
    // Un franco reinterpreta horas (grilla, resumen, dashboard, cierres) y
    // puede crear/resolver alertas con su notificación (EMPLOYEE_DAY_OFF.md §14).
    clearWorkedTimeDerivedReadCaches();
    clearShiftAlertReadCaches();
    clearNotificationsListCache();
    res.json({ data });
  }) satisfies RequestHandler,
};
