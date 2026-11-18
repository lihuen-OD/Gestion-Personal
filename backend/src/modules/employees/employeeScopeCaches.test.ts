import { describe, expect, it, vi } from "vitest";
import { dashboardMetricsCache } from "../dashboard/dashboard.cache";
import { documentsListCache } from "../documents/documents.cache";
import { noveltiesListCache } from "../novelties/novelties.cache";
import { shiftAlertListCache } from "../shifts/shiftAlert.cache";
import { shiftAssignmentSummaryCache } from "../shifts/shiftAssignment.cache";
import {
  attendanceObservationsCache, attendanceSummaryCache, homeSummaryCache, timeEntriesListCache, timeEntriesPeriodEmployeesCache, timeEntriesSummaryCache,
} from "../time-entries/timeEntries.cache";
import { closuresCache, correctionsCache, doubleRulesCache, notificationsListCache, shiftTemplatesCache } from "../workforce-management/workforce.cache";
import { clearEmployeeReadCaches } from "./employees.controller";
import { invalidateEmployeeScopeCaches } from "./employeeScopeCaches";

// Las 6 cachés de Legajos son privadas del controller: se verifica la llamada.
vi.mock("./employees.controller", () => ({ clearEmployeeReadCaches: vi.fn() }));

type AnyCache = { get(key: string): unknown; set(key: string, value: never): void };
const KEY = "user-n2:NIVEL_2_SUPERVISION:/api/x";
const fill = (caches: AnyCache[]) => caches.forEach((cache) => cache.set(KEY, { cached: true } as never));

describe("invalidateEmployeeScopeCaches", () => {
  const scoped: Array<[string, AnyCache]> = [
    ["horas: listado", timeEntriesListCache],
    ["horas: resumen", timeEntriesSummaryCache],
    ["horas: período por persona", timeEntriesPeriodEmployeesCache],
    ["asistencia: resumen", attendanceSummaryCache],
    ["horas: inicio", homeSummaryCache],
    ["asistencia: observaciones", attendanceObservationsCache],
    ["novedades", noveltiesListCache],
    ["documentos", documentsListCache],
    ["alertas de turnos", shiftAlertListCache],
    ["turnos: resumen", shiftAssignmentSummaryCache],
    ["cierres", closuresCache],
    ["correcciones", correctionsCache],
    ["dashboard", dashboardMetricsCache],
  ] as Array<[string, AnyCache]>;
  const global: Array<[string, AnyCache]> = [
    ["plantillas de turno", shiftTemplatesCache],
    ["reglas de hora especial", doubleRulesCache],
    ["notificaciones (por destinatario)", notificationsListCache],
  ] as Array<[string, AnyCache]>;

  it("limpia todas las cachés de lectura que dependen de employeeAccessWhere, incluidas las de Legajos", () => {
    fill(scoped.map(([, cache]) => cache));
    invalidateEmployeeScopeCaches();
    for (const [name, cache] of scoped) expect(cache.get(KEY), name).toBeUndefined();
    expect(clearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("no toca cachés globales ni las que no dependen del alcance", () => {
    fill(global.map(([, cache]) => cache));
    invalidateEmployeeScopeCaches();
    for (const [name, cache] of global) expect(cache.get(KEY), name).toEqual({ cached: true });
  });
});
