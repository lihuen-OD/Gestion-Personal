import type { RequestHandler } from "express";
import type { DoubleHourRuleKind } from "@prisma/client";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { workforceService } from "./workforce.service";
import type { ListNotificationsQuery } from "./workforce.schemas";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { clearEmployeeReadCaches } from "../employees/employees.controller";
import { clearDoubleRulesReadCache, clearShiftTemplatesReadCache, doubleRulesCache, shiftTemplatesCache } from "./workforce.cache";

// Etapa 9C: mismo patrón ya usado en novelties/documents/time-entries/employees
// controllers — clave por usuario+rol+URL (ninguno de los dos endpoints tiene
// query params hoy, pero mantiene el mismo criterio "seguro por defecto" si
// alguna vez se filtran por scope).
function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const workforceController = {
  closures: (async (req,res)=>res.json({data:await workforceService.closures(String(req.query.period),req.user!)})) satisfies RequestHandler,
  submit: (async (req,res)=>res.status(201).json({data:await workforceService.submitClosures(req.body.period,req.body.employeeIds,req.user!,requestAuditContext(req))})) satisfies RequestHandler,
  approve: (async (req,res)=>res.json({data:await workforceService.approveClosures(req.body.ids,req.body.note,req.user!,requestAuditContext(req))})) satisfies RequestHandler,
  returnClosure: (async (req,res)=>res.json({data:await workforceService.returnClosure(requireParam(req,"id"),req.body.reason,req.user!,requestAuditContext(req))})) satisfies RequestHandler,
  corrections: (async (req,res)=>res.json({data:await workforceService.corrections(req.user!)})) satisfies RequestHandler,
  createCorrection: (async (req,res)=>res.status(201).json({data:await workforceService.createCorrection(req.body,req.user!,requestAuditContext(req))})) satisfies RequestHandler,
  // Etapa 9B: approveCorrection modifica TimeEntry.hours/totalMinutes (workforce.service.ts) —
  // igual que cada escritura equivalente en timeEntries.controller.ts, debe invalidar los
  // caches de lectura de horas/legajo para no mostrar el valor viejo hasta que expire el TTL.
  approveCorrection: (async (req,res)=>{
    const data=await workforceService.approveCorrection(requireParam(req,"id"),req.user!,requestAuditContext(req));
    clearTimeEntriesReadCaches();
    clearEmployeeReadCaches();
    res.json({data});
  }) satisfies RequestHandler,
  rejectCorrection: (async (req,res)=>res.json({data:await workforceService.rejectCorrection(requireParam(req,"id"),req.body.note,req.user!,requestAuditContext(req))})) satisfies RequestHandler,
  notifications: (async (req,res)=>{
    const result=await workforceService.notifications(req.query as unknown as ListNotificationsQuery,req.user!);
    res.json({data:result.items,meta:result.meta});
  }) satisfies RequestHandler,
  unreadNotificationCount: (async (req,res)=>res.json({data:{count:await workforceService.unreadNotificationCount(req.user!)}})) satisfies RequestHandler,
  readNotification: (async (req,res)=>res.json({data:await workforceService.markNotificationRead(requireParam(req,"id"),req.user!)})) satisfies RequestHandler,
  // Etapa 9C: cache de lectura TTL corto (ver workforce.cache.ts) — mismo
  // shape de respuesta que antes, sólo cambia si la data viene de Prisma o
  // del cache.
  shiftTemplates: (async (req,res)=>{
    const key=userScopedCacheKey(req);
    const cached=shiftTemplatesCache.get(key);
    if(cached) return res.json({data:cached});
    const data=await workforceService.shiftTemplates();
    shiftTemplatesCache.set(key,data);
    res.json({data});
  }) satisfies RequestHandler,
  createShiftTemplate: (async (req,res)=>{
    const data=await workforceService.createShiftTemplate(req.body,requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.status(201).json({data});
  }) satisfies RequestHandler,
  updateShiftTemplate: (async (req,res)=>{
    const data=await workforceService.updateShiftTemplate(requireParam(req,"id"),req.body,requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.json({data});
  }) satisfies RequestHandler,
  removeShiftTemplate: (async (req,res)=>{
    const data=await workforceService.removeShiftTemplate(requireParam(req,"id"),requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.json({data});
  }) satisfies RequestHandler,
  doubleRules: (async (req,res)=>{
    const key=userScopedCacheKey(req);
    const cached=doubleRulesCache.get(key);
    if(cached) return res.json({data:cached});
    const data=await workforceService.doubleRules();
    doubleRulesCache.set(key,data);
    res.json({data});
  }) satisfies RequestHandler,
  createDoubleRule: (async (req,res)=>{
    const data=await workforceService.createDoubleRule(req.body,req.user!,requestAuditContext(req));
    clearDoubleRulesReadCache();
    res.status(201).json({data});
  }) satisfies RequestHandler,
  updateDoubleRule: (async (req,res)=>{
    const data=await workforceService.updateDoubleRule(requireParam(req,"id"),req.body,requestAuditContext(req));
    clearDoubleRulesReadCache();
    res.json({data});
  }) satisfies RequestHandler,
  removeDoubleRule: (async (req,res)=>{
    const data=await workforceService.removeDoubleRule(requireParam(req,"id"),requestAuditContext(req));
    clearDoubleRulesReadCache();
    res.json({data});
  }) satisfies RequestHandler,
  // Etapa 12B: req.query.kind ya viene validado/coercido por
  // validateQuery(calendarRangeQuerySchema) (mismo patrón que from/to) —
  // undefined si no se mandó, sin filtro adicional en ese caso.
  doubleRulesCalendar: (async (req,res)=>res.json({data:await workforceService.calendarPreview(new Date(String(req.query.from)),new Date(String(req.query.to)),req.query.kind as DoubleHourRuleKind|undefined)})) satisfies RequestHandler,
};
