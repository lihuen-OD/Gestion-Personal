import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListShiftAssignmentsQuery } from "./shiftAssignment.schemas";
import { shiftAssignmentService } from "./shiftAssignment.service";
import { requestShiftGroupScope, shiftGroupScopeCacheKey } from "./shiftGroupAccess";
import { requestShiftActor } from "./shiftWriteAccess";
import { clearShiftAssignmentSummaryCache, shiftAssignmentSummaryCache } from "./shiftAssignment.cache";
import { clearNoveltyCoverageReadCaches } from "../novelties/noveltyCoverageReadCaches";

// Etapa 14H.3: mismo patrón que workforce.controller.ts/shiftAlert.controller.ts
// — clave por usuario+rol+URL (summary() no tiene query params hoy, pero
// mantiene el mismo criterio "seguro por defecto").
function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const shiftAssignmentController = {
  // Etapa 14H.3: cache de lectura TTL corto (30s, ver shiftAssignment.cache.ts).
  // R8: la clave incluye la huella del alcance por grupo resuelto en esta
  // request: una revocación nunca sirve una entrada vieja.
  summary: (async (req, res) => {
    const scope = await requestShiftGroupScope(req);
    const key = `${userScopedCacheKey(req)}:${shiftGroupScopeCacheKey(scope)}`;
    const cached = shiftAssignmentSummaryCache.get(key);
    if (cached) return res.json({ data: cached });
    const data = await shiftAssignmentService.summary(req.user!, scope);
    shiftAssignmentSummaryCache.set(key, data);
    res.json({ data });
  }) satisfies RequestHandler,

  list: (async (req, res) => {
    const data = await shiftAssignmentService.list(req.query as unknown as ListShiftAssignmentsQuery, req.user!, await requestShiftGroupScope(req));
    res.json({ data });
  }) satisfies RequestHandler,

  assign: (async (req, res) => {
    const data = await shiftAssignmentService.assign(req.body, await requestShiftActor(req), requestAuditContext(req));
    clearShiftAssignmentSummaryCache();
    clearNoveltyCoverageReadCaches();
    res.status(201).json({ data });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const data = await shiftAssignmentService.update(requireParam(req, "id"), req.body, await requestShiftActor(req), requestAuditContext(req));
    clearShiftAssignmentSummaryCache();
    clearNoveltyCoverageReadCaches();
    res.json({ data });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const data = await shiftAssignmentService.remove(requireParam(req, "id"), await requestShiftActor(req), requestAuditContext(req));
    clearShiftAssignmentSummaryCache();
    clearNoveltyCoverageReadCaches();
    res.json({ data });
  }) satisfies RequestHandler,
};
