import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { holidayWorkAssignmentService } from "./holidayWorkAssignment.service";
import type { HolidayWorkCandidatesQuery } from "./holidayWorkAssignment.schemas";

export const holidayWorkAssignmentController = {
  // Etapa 12D: req.query.from/to ya vienen validados/coercidos a Date por
  // validateQuery(holidayDatesQuerySchema) — mismo patrón que
  // workforce.controller.ts (doubleRulesCalendar).
  dates: (async (req, res) => {
    const data = await holidayWorkAssignmentService.holidayDates(new Date(String(req.query.from)), new Date(String(req.query.to)));
    res.json({ data });
  }) satisfies RequestHandler,

  candidates: (async (req, res) => {
    const result = await holidayWorkAssignmentService.candidates(req.query as unknown as HolidayWorkCandidatesQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  listByDate: (async (req, res) => {
    const data = await holidayWorkAssignmentService.listByDate(new Date(String(req.query.date)), req.user!);
    res.json({ data });
  }) satisfies RequestHandler,

  save: (async (req, res) => {
    const data = await holidayWorkAssignmentService.save(req.body, req.user!, requestAuditContext(req));
    res.json({ data });
  }) satisfies RequestHandler,
};
