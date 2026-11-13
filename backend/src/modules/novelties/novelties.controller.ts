import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
// Etapa 4 (NOVELTY_COVERAGE_ENGINE.md §12): una novedad aprobada ya cambia
// totales (cobertura), así que sus mutaciones limpian todas las cachés que
// exponen la contabilidad de horas (grillas, resumen, dashboard, cierres).
import { clearWorkedTimeDerivedReadCaches } from "../time-entries/workedTimeReadCaches";
import { clearNoveltiesReadCaches, noveltiesListCache } from "./novelties.cache";
import type { ListNoveltiesQuery } from "./novelties.schemas";
import { noveltiesService } from "./novelties.service";

function userScopedCacheKey(req: Parameters<RequestHandler>[0]) {
  return `${req.user?.id || "anon"}:${req.user?.role || "none"}:${req.originalUrl}`;
}

export const noveltiesController = {
  list: (async (req, res) => {
    const key = userScopedCacheKey(req);
    const cached = noveltiesListCache.get(key);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await noveltiesService.list(req.query as unknown as ListNoveltiesQuery, req.user!);
    noveltiesListCache.set(key, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const items = await noveltiesService.create(req.body, req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches();
    clearWorkedTimeDerivedReadCaches();
    res.status(201).json({ data: items });
  }) satisfies RequestHandler,

  approve: (async (req, res) => {
    const item = await noveltiesService.approve(requireParam(req, "id"), req.user!, requestAuditContext(req), req.body);
    clearNoveltiesReadCaches();
    clearWorkedTimeDerivedReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  approveMany: (async (req, res) => {
    const items = await noveltiesService.approveMany(req.body.ids, req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches(); clearWorkedTimeDerivedReadCaches(); res.json({ data: items });
  }) satisfies RequestHandler,

  reject: (async (req, res) => {
    const item = await noveltiesService.reject(requireParam(req, "id"), req.body, req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches();
    clearWorkedTimeDerivedReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const result = await noveltiesService.remove(requireParam(req, "id"), req.user!, requestAuditContext(req), req.body);
    clearNoveltiesReadCaches();
    clearWorkedTimeDerivedReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  // ── Cobertura (etapa 3, docs/decisions/NOVELTY_COVERAGE_ENGINE.md) ──────
  // Vista previa: no escribe nada ni se cachea (depende de turnos, francos,
  // reglas y relación laboral vigentes).
  previewCoverage: (async (req, res) => {
    res.json({ data: await noveltiesService.previewCoverage(req.body, req.user!) });
  }) satisfies RequestHandler,

  getCoverage: (async (req, res) => {
    res.json({ data: await noveltiesService.getCoverage(requireParam(req, "id"), req.user!) });
  }) satisfies RequestHandler,

  resolveCoverageDay: (async (req, res) => {
    const day = await noveltiesService.resolveCoverageDay(requireParam(req, "id"), requireParam(req, "date"), req.body, req.user!, requestAuditContext(req));
    clearNoveltiesReadCaches();
    clearWorkedTimeDerivedReadCaches();
    res.json({ data: day });
  }) satisfies RequestHandler,
};
