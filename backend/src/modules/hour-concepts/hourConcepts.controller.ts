import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { createTtlCache } from "../../shared/cache/ttlCache";
import { requireParam } from "../../shared/http/params";
import { clearEmployeeReadCaches } from "../employees/employees.controller";
import { invalidateTimeGridCatalogCache } from "../employees/employees.repository";
import { clearNoveltiesReadCaches } from "../novelties/novelties.cache";
import { clearWorkedTimeDerivedReadCaches } from "../time-entries/workedTimeReadCaches";
import type { EnableHourConceptEmployeesInput, ListHourConceptEmployeesQuery, ListHourConceptsQuery } from "./hourConcepts.schemas";
import { hourConceptsService } from "./hourConcepts.service";

const hourConceptsReadCache = createTtlCache<Awaited<ReturnType<typeof hourConceptsService.list>>>(60_000);

/**
 * Editar (nombre, estado, tratamiento) o eliminar un concepto cambia lo que
 * muestran todas las lecturas que lo unen con sus horas — sobre todo
 * `workTreatment`, que reinterpreta la historia completa
 * (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §12). Se limpian todas en el
 * momento, sin depender de su TTL:
 * - catálogo de conceptos (controller + repository, este último en el service);
 * - Legajo y grilla por legajo (`/employees/:id/time-grid`, panel de cierre)
 *   y el catálogo embebido en esa grilla;
 * - Carga de horas: grilla de período, Bandeja "Por persona", resumen,
 *   asistencia (segmentos reclasificados al eliminar);
 * - dashboard ("Horas cargadas");
 * - cierres (el payload incluye el snapshot recalculado);
 * - novedades (al eliminar se desvincula su concepto destino).
 * El export no tiene caché: se calcula en cada pedido.
 */
function clearHourConceptDependentReadCaches() {
  hourConceptsReadCache.clear();
  clearEmployeeReadCaches();
  invalidateTimeGridCatalogCache();
  clearWorkedTimeDerivedReadCaches();
  clearNoveltiesReadCaches();
}

export const hourConceptsController = {
  list: (async (req, res) => {
    const cached = hourConceptsReadCache.get(req.originalUrl);
    if (cached) return res.json({ data: cached.items, meta: cached.meta });
    const result = await hourConceptsService.list(req.query as unknown as ListHourConceptsQuery);
    hourConceptsReadCache.set(req.originalUrl, result);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  nextCode: (async (_req, res) => {
    res.json({ data: await hourConceptsService.nextCode() });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    const item = await hourConceptsService.create(req.body, requestAuditContext(req));
    hourConceptsReadCache.clear();
    res.status(201).json({ data: item });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const item = await hourConceptsService.update(requireParam(req, "id"), req.body, requestAuditContext(req));
    clearHourConceptDependentReadCaches();
    res.json({ data: item });
  }) satisfies RequestHandler,

  listEmployees: (async (req, res) => {
    const result = await hourConceptsService.listEmployees(requireParam(req, "id"), req.query as unknown as ListHourConceptEmployeesQuery, req.user!);
    res.json({ data: result.items, meta: result.meta });
  }) satisfies RequestHandler,

  enableEmployees: (async (req, res) => {
    const result = await hourConceptsService.enableEmployees(requireParam(req, "id"), req.body as EnableHourConceptEmployeesInput, requestAuditContext(req));
    // Etapa 6L.1: EmployeeHourConcept es la misma fuente de verdad que lee el
    // Legajo (/employees/:id, /overview-details) — sin este clear, esas
    // lecturas podían devolver el snapshot cacheado de hasta 30s antes de la
    // asignación hecha desde este módulo.
    clearEmployeeReadCaches();
    res.status(201).json({ data: result });
  }) satisfies RequestHandler,

  disableEmployee: (async (req, res) => {
    const result = await hourConceptsService.disableEmployee(requireParam(req, "id"), requireParam(req, "employeeId"), requestAuditContext(req));
    clearEmployeeReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,

  remove: (async (req, res) => {
    const result = await hourConceptsService.remove(requireParam(req, "id"), requestAuditContext(req));
    clearHourConceptDependentReadCaches();
    res.json({ data: result });
  }) satisfies RequestHandler,
};
