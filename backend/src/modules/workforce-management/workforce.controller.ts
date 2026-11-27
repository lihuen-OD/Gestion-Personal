import type { RequestHandler } from "express";
import { requestShiftGroupScope, shiftGroupScopeCacheKey } from "../shifts/shiftGroupAccess";
import { requestShiftActor } from "../shifts/shiftWriteAccess";
import { deletionConflictResponse } from "../../shared/deletion/deletionPlan";
import type { DoubleHourRuleKind } from "@prisma/client";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { workforceService } from "./workforce.service";
import { drainClockPunchPostProcess } from "../clock/clockPunchPostProcess.worker";
import type { ListNotificationsQuery } from "./workforce.schemas";
import { clearNoveltyCoverageReadCaches } from "../novelties/noveltyCoverageReadCaches";
import { clearDoubleRulesReadCache, clearMonthlyClosuresReadCaches, clearNotificationsListCache, clearShiftTemplatesReadCache, closuresCache, doubleRulesCache, notificationsListCache, shiftTemplatesCache } from "./workforce.cache";
import { clearShiftAssignmentSummaryCache } from "../shifts/shiftAssignment.cache";

// Etapa 9C: mismo patrón ya usado en novelties/documents/time-entries/employees
// controllers — clave por usuario+rol+URL (ninguno de los dos endpoints tiene
// query params hoy, pero mantiene el mismo criterio "seguro por defecto" si
// alguna vez se filtran por scope).
function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const workforceController = {
  // Etapa 14G.8: cache de lectura TTL corto (15s, ver workforce.cache.ts) --
  // mismo patrón exacto que shiftTemplates/doubleRules/notifications más abajo.
  closures: (async (req,res)=>{
    const key=userScopedCacheKey(req);
    const cached=closuresCache.get(key);
    if(cached){ res.json({data:cached}); return; }
    const data=await workforceService.closures(String(req.query.period),req.user!);
    closuresCache.set(key,data);
    res.json({data});
  }) satisfies RequestHandler,
  closureBlockers: (async (req,res)=>{
    res.json({data:await workforceService.closureBlockers(String(req.query.period),req.user!)});
  }) satisfies RequestHandler,
  close: (async (req,res)=>{
    const data=await workforceService.closeClosures(req.body.period,req.body.employeeIds,req.user!,requestAuditContext(req),{ settleClockPunchPostProcess: drainClockPunchPostProcess });
    clearMonthlyClosuresReadCaches();
    res.status(201).json({data});
  }) satisfies RequestHandler,
  reopen: (async (req,res)=>{
    const data=await workforceService.reopenClosure(requireParam(req,"id"),req.body,req.user!,requestAuditContext(req));
    clearMonthlyClosuresReadCaches();
    res.json({data});
  }) satisfies RequestHandler,
  // Etapa 14G.6: cache de lectura TTL corto (10s, ver workforce.cache.ts) --
  // mismo patrón exacto que shiftTemplates/doubleRules más abajo.
  notifications: (async (req,res)=>{
    const key=userScopedCacheKey(req);
    const cached=notificationsListCache.get(key);
    if(cached){ res.json({data:cached.items,meta:cached.meta}); return; }
    const result=await workforceService.notifications(req.query as unknown as ListNotificationsQuery,req.user!);
    notificationsListCache.set(key,result);
    res.json({data:result.items,meta:result.meta});
  }) satisfies RequestHandler,
  unreadNotificationCount: (async (req,res)=>res.json({data:{count:await workforceService.unreadNotificationCount(req.user!)}})) satisfies RequestHandler,
  readNotification: (async (req,res)=>{
    const data=await workforceService.markNotificationRead(requireParam(req,"id"),req.user!);
    clearNotificationsListCache();
    res.json({data});
  }) satisfies RequestHandler,
  // Etapa 9C: cache de lectura TTL corto (ver workforce.cache.ts) — mismo
  // shape de respuesta que antes, sólo cambia si la data viene de Prisma o
  // del cache.
  // R8: la clave incluye la huella del alcance por grupo, resuelto en esta
  // request: un grupo asignado o revocado nunca sirve una entrada vieja.
  shiftTemplates: (async (req,res)=>{
    const scope=await requestShiftGroupScope(req);
    const key=`${userScopedCacheKey(req)}:${shiftGroupScopeCacheKey(scope)}`;
    const cached=shiftTemplatesCache.get(key);
    if(cached) return res.json({data:cached});
    const data=await workforceService.shiftTemplates(scope);
    shiftTemplatesCache.set(key,data);
    res.json({data});
  }) satisfies RequestHandler,
  createShiftTemplate: (async (req,res)=>{
    const data=await workforceService.createShiftTemplate(req.body,await requestShiftActor(req),requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.status(201).json({data});
  }) satisfies RequestHandler,
  updateShiftTemplate: (async (req,res)=>{
    const data=await workforceService.updateShiftTemplate(requireParam(req,"id"),req.body,await requestShiftActor(req),requestAuditContext(req));
    clearShiftTemplatesReadCache();
    clearNoveltyCoverageReadCaches();
    res.json({data});
  }) satisfies RequestHandler,
  removeShiftTemplate: (async (req,res)=>{
    const data=await workforceService.removeShiftTemplate(requireParam(req,"id"),await requestShiftActor(req),requestAuditContext(req));
    clearShiftTemplatesReadCache();
    clearNoveltyCoverageReadCaches();
    res.json({data});
  }) satisfies RequestHandler,
  previewShiftTemplateScheduleReplacement: (async (req,res)=>{
    const data=await workforceService.previewShiftTemplateScheduleReplacement(requireParam(req,"id"),req.body,await requestShiftActor(req));
    res.json({data});
  }) satisfies RequestHandler,
  replaceShiftTemplateSchedule: (async (req,res)=>{
    const data=await workforceService.replaceShiftTemplateSchedule(requireParam(req,"id"),req.body,await requestShiftActor(req),requestAuditContext(req));
    clearShiftTemplatesReadCache();
    clearShiftAssignmentSummaryCache();
    clearNoveltyCoverageReadCaches();
    res.status(201).json({data});
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
    // La regla reinterpreta horas ya cargadas: equivalencias, grillas y cierres.
    clearNoveltyCoverageReadCaches();
    res.status(201).json({data});
  }) satisfies RequestHandler,
  updateDoubleRule: (async (req,res)=>{
    const data=await workforceService.updateDoubleRule(requireParam(req,"id"),req.body,requestAuditContext(req));
    clearDoubleRulesReadCache();
    // La regla reinterpreta horas ya cargadas: equivalencias, grillas y cierres.
    clearNoveltyCoverageReadCaches();
    res.json({data});
  }) satisfies RequestHandler,
  removeDoubleRule: (async (req,res)=>{
    const data=await workforceService.removeDoubleRule(requireParam(req,"id"),requestAuditContext(req));
    clearDoubleRulesReadCache();
    // La regla reinterpreta horas ya cargadas: equivalencias, grillas y cierres.
    clearNoveltyCoverageReadCaches();
    res.json({data});
  }) satisfies RequestHandler,
  // Eliminación controlada (shared/deletion): vista previa con la reinterpretación
  // calculada en una transacción revertida y confirmación con su huella.
  doubleRuleDeletionPreview: (async (req,res)=>{
    res.json({data: await workforceService.previewDoubleRuleDeletion(requireParam(req,"id"))});
  }) satisfies RequestHandler,
  executeDoubleRuleDeletion: (async (req,res)=>{
    try {
      const data=await workforceService.executeDoubleRuleDeletion(requireParam(req,"id"),req.body,requestAuditContext(req));
      clearDoubleRulesReadCache();
      clearNoveltyCoverageReadCaches();
      res.json({data});
    } catch (error) {
      const conflict=deletionConflictResponse(error);
      if (!conflict) throw error;
      res.status(conflict.status).json(conflict.body);
    }
  }) satisfies RequestHandler,
  // Etapa 12B: req.query.kind ya viene validado/coercido por
  // validateQuery(calendarRangeQuerySchema) (mismo patrón que from/to) —
  // undefined si no se mandó, sin filtro adicional en ese caso.
  doubleRulesCalendar: (async (req,res)=>res.json({data:await workforceService.calendarPreview(new Date(String(req.query.from)),new Date(String(req.query.to)),req.query.kind as DoubleHourRuleKind|undefined)})) satisfies RequestHandler,
};
