import { EmployeeStatus } from "@prisma/client";
import { runInBatches } from "../../shared/prisma/runInBatches";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { dashboardMetricsCache } from "./dashboard.cache";
import { dashboardRepository } from "./dashboard.repository";
import type { DashboardMetricsQuery } from "./dashboard.schemas";

// Etapa 14E.1: `calculateMetrics` disparaba 15 queries Prisma en un único
// `Promise.all` — bajo carga real (journeys de Legajos 14D.1-14D.7) esto
// saturaba el pool de conexiones de Neon de forma intermitente (distintos
// modelos fallando en distintas corridas con `P1017`/"Server has closed the
// connection" — patrón de contención, no un bug puntual de un modelo). Se
// pasa a lotes de `DASHBOARD_METRICS_BATCH_SIZE` queries concurrentes como
// máximo, en vez de las 15 (ahora 14, ver countTotalAndActive) de una — ver
// docs/decisions/DASHBOARD_METRICS_PERFORMANCE_14E1.md para el diagnóstico
// completo y por qué se eligió 5 (no 3, no ilimitado).
const DASHBOARD_METRICS_BATCH_SIZE = 5;

const dayMs = 86_400_000;

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function yearsBetween(from?: Date | null, to = new Date()) {
  if (!from) return 0;
  return (to.getTime() - from.getTime()) / (365.25 * dayMs);
}

function groupCount(values: string[]) {
  return Object.entries(
    values.reduce<Record<string, number>>((result, value) => {
      const label = value || "Sin cargar";
      result[label] = (result[label] || 0) + 1;
      return result;
    }, {}),
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function dayCount(from: Date, to?: Date | null) {
  const end = to || from;
  return Math.max(1, Math.round((end.getTime() - from.getTime()) / dayMs) + 1);
}

function formatDecimal(value: unknown) {
  return Number(value?.toString?.() || 0);
}

function upcomingBirthdays(
  employees: Awaited<ReturnType<typeof dashboardRepository.findActiveDashboardEmployees>>,
) {
  const referenceDate = new Date();
  return employees
    .filter((employee) => {
      if (!employee.birthDate) return false;
      let next = new Date(
        referenceDate.getFullYear(),
        employee.birthDate.getUTCMonth(),
        employee.birthDate.getUTCDate(),
        12,
      );
      if (next < referenceDate)
        next = new Date(
          referenceDate.getFullYear() + 1,
          employee.birthDate.getUTCMonth(),
          employee.birthDate.getUTCDate(),
          12,
        );
      return (next.getTime() - referenceDate.getTime()) / dayMs <= 30;
    })
    .sort((a, b) => {
      const aKey = a.birthDate
        ? `${String(a.birthDate.getUTCMonth() + 1).padStart(2, "0")}-${String(a.birthDate.getUTCDate()).padStart(2, "0")}`
        : "";
      const bKey = b.birthDate
        ? `${String(b.birthDate.getUTCMonth() + 1).padStart(2, "0")}-${String(b.birthDate.getUTCDate()).padStart(2, "0")}`
        : "";
      return aKey.localeCompare(bKey);
    })
    .map((employee) => ({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      birthDate: employee.birthDate?.toISOString().slice(0, 10) || "",
      sector: employee.sector?.name || "",
    }));
}

export const dashboardService = {
  async metrics(query: DashboardMetricsQuery, user: Express.AuthUser) {
    const period = query.period || currentPeriod();
    const cacheKey = JSON.stringify({
      period,
      userId: user.id,
      role: user.role,
      companyId: user.companyId || null,
      sectorId: user.sectorId || null,
    });
    const cached = dashboardMetricsCache.get(cacheKey);
    if (cached) return cached;

    const metrics = await calculateMetrics(period, user);
    dashboardMetricsCache.set(cacheKey, metrics);
    return metrics;
  },
};

// Etapa 14E.1: loguea (sin PII — sólo el nombre de la query, el período y el
// rol, mismo criterio que `performanceLogger.ts`) y re-lanza — nunca traga
// el error ni devuelve un valor por defecto. El objetivo es que un futuro
// P1017/timeout de pool identifique la query exacta en el log sin tener que
// inspeccionar el stack completo de Prisma.
function withQueryErrorLog<T>(query: string, period: string, role: string, task: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await task();
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "dashboard_metrics_query_error",
          query,
          period,
          role,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  };
}

async function calculateMetrics(period: string, user: Express.AuthUser) {
  const accessWhere = employeeAccessWhere(user);
  const now = new Date();
  const year = now.getUTCFullYear();
  const role = user.role;
  const task = <T>(query: string, run: () => Promise<T>) => withQueryErrorLog(query, period, role, run);

  // Etapa 14E.1: antes 15 queries en un único Promise.all (root cause de los
  // 500 por saturación de pool, ver docs/decisions/
  // DASHBOARD_METRICS_PERFORMANCE_14E1.md §1/§6). Ahora 14 (countTotal +
  // countActive colapsados en 1 groupBy) repartidas en 3 lotes de máximo
  // `DASHBOARD_METRICS_BATCH_SIZE` (5) queries concurrentes — los 2
  // `findMany` más pesados (activeDashboardEmployees/transportedEmployees)
  // se repartieron en lotes distintos (1 y 3) para no acumular el costo más
  // alto en un mismo lote.
  const [
    statusGroups,
    exits,
    transported,
    hoursResult,
    activeDashboardEmployees,
    employeesWithEntries,
    pendingLoads,
    reviewLoads,
    absenceRanges,
    pendingNovelties,
    expiredDocuments,
    expiringDocuments,
    missingResponsible,
    transportedEmployees,
  ] = await runInBatches(
    [
      task("Employee.groupBy(status)", () => dashboardRepository.countTotalAndActive(accessWhere)),
      task("Employee.count(exitsThisYear)", () => dashboardRepository.countExitsThisYear(accessWhere, year)),
      task("Employee.count(transported)", () => dashboardRepository.countTransported(accessWhere)),
      task("TimeEntry.aggregate(loadedHours)", () => dashboardRepository.sumLoadedHours(period, accessWhere)),
      task("Employee.findMany(activeDashboardEmployees)", () => dashboardRepository.findActiveDashboardEmployees(accessWhere)),
      task("Employee.count(withEntries)", () => dashboardRepository.countEmployeesWithEntries(period, accessWhere)),
      task("Employee.count(withoutEntries)", () => dashboardRepository.countEmployeesWithoutEntries(period, accessWhere)),
      task("Employee.count(inReview)", () => dashboardRepository.countEmployeesInReview(period, accessWhere)),
      task("Novelty.findMany(absenceRanges)", () => dashboardRepository.findPeriodAbsenceDateRanges(period, accessWhere)),
      task("Novelty.count(pending)", () => dashboardRepository.countPendingNovelties(accessWhere)),
      task("EmployeeDocument.count(expired)", () => dashboardRepository.countExpiredDocuments(accessWhere)),
      task("EmployeeDocument.count(expiring)", () => dashboardRepository.countExpiringDocuments(accessWhere)),
      task("Employee.count(missingTimeResponsible)", () => dashboardRepository.countMissingTimeResponsible(accessWhere)),
      task("Employee.findMany(transportedEmployees)", () => dashboardRepository.findTransportedEmployees(accessWhere)),
    ] as const,
    DASHBOARD_METRICS_BATCH_SIZE,
  );

  const total = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
  const active = statusGroups.find((group) => group.status === EmployeeStatus.ACTIVO)?._count._all || 0;
  const inactive = total - active;
  const loadedHours = formatDecimal(hoursResult._sum.hours);

  const absenceDays = absenceRanges.reduce(
    (total, novelty) => total + dayCount(novelty.fromDate, novelty.toDate),
    0,
  );

  const averageAge =
    active > 0
      ? (activeDashboardEmployees.reduce((sum: number, e) => sum + yearsBetween(e.birthDate), 0) / active).toFixed(1)
      : "0.0";

  const averageTenure =
    active > 0
      ? (
          activeDashboardEmployees.reduce(
            (sum: number, e) => sum + yearsBetween(e.laborMovements[0]?.effectiveFrom ?? e.createdAt),
            0,
          ) / active
        ).toFixed(1)
      : "0.0";

  const transportByCity = groupCount(
    transportedEmployees.map((e) => e.address?.city || e.transport?.locality || ""),
  );
  const transportRoutes = groupCount(transportedEmployees.map((e) => e.transport?.busLine || ""));
  const headcountBySector = groupCount(activeDashboardEmployees.map((e) => e.sector?.name || ""));
  const headcountByCompany = groupCount(
    activeDashboardEmployees.map((e) => {
      const primary = e.companies.find((link) => link.isPrimary) ?? e.companies[0];
      return primary?.company.name || "";
    }),
  );

  return {
    period,
    total,
    active,
    inactive,
    absenceDays,
    absenceRate: active ? ((absenceDays / (active * 21)) * 100).toFixed(1) : "0.0",
    turnoverRate: total ? ((exits / ((active + total) / 2)) * 100).toFixed(1) : "0.0",
    exits,
    upcomingBirthdays: upcomingBirthdays(activeDashboardEmployees.filter((employee) => employee.birthDate)),
    averageAge,
    averageTenure,
    transported,
    transportByCity,
    transportRoutes,
    loadedHours,
    loadCoverage: active ? Math.round((employeesWithEntries / active) * 100) : 0,
    pendingLoads,
    reviewLoads,
    expiredDocuments,
    expiringDocuments,
    missingResponsible,
    pendingNovelties,
    headcountByCompany,
    headcountBySector,
  };
}

export type DashboardMetricsResult = Awaited<ReturnType<typeof calculateMetrics>>;
