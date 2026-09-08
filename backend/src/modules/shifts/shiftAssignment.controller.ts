import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListShiftAssignmentsQuery } from "./shiftAssignment.schemas";
import { shiftAssignmentService } from "./shiftAssignment.service";
import { clearShiftAssignmentSummaryCache, shiftAssignmentSummaryCache } from "./shiftAssignment.cache";

// Etapa 14H.3: mismo patrón que workforce.controller.ts/shiftAlert.controller.ts
// — clave por usuario+rol+URL (summary() no tiene query params hoy, pero
// mantiene el mismo criterio "seguro por defecto").
function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const shiftAssignmentController = {
  // Etapa 14H.3: cache de lectura TTL corto (30s, ver shiftAssignment.cache.ts).
  summary: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = shiftAssignmentSummaryCache.get(key);
    if (cached) return res.json({ data: cached });
    const data = await shiftAssignmentService.summary(req.user!);
    shiftAssignmentSummaryCache.set(key, data);
    res.json({ data });
  }) satisfies RequestHandler,

  list: (async (req, res) => {
    const data = await shiftAssignmentService.list(req.query as unknown as ListShiftAssignmentsQuery, req.user!);
    res.json({ data });
  }) satisfies RequestHandler,

  assign: (async (req, res) => {
    const data = await shiftAssignmentService.assign(req.body, req.user!, requestAuditContext(req));
    clearShiftAssignmentSummaryCache();
    res.status(201).json({ data });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const data = await shiftAssignmentService.update(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    clearShiftAssignmentSummaryCache();
    res.json({ data });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const data = await shiftAssignmentService.remove(requireParam(req, "id"), requestAuditContext(req));
    clearShiftAssignmentSummaryCache();
    res.json({ data });
  }) satisfies RequestHandler,
};
