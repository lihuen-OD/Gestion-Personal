import { ApprovalStatus, DocumentStatus, EmployeeStatus, LaborMovementType, NoveltyTypeKind } from "@prisma/client";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { dashboardRepository } from "./dashboard.repository";
import type { DashboardMetricsQuery } from "./dashboard.schemas";

const dayMs = 86_400_000;
const countableTimeStatuses = new Set<ApprovalStatus>([ApprovalStatus.APROBADO, ApprovalStatus.EN_REVISION]);
const absenceKinds = new Set<NoveltyTypeKind>([
  NoveltyTypeKind.AUSENCIA,
  NoveltyTypeKind.LICENCIA,
  NoveltyTypeKind.ACCIDENTE,
  NoveltyTypeKind.VACACIONES,
  NoveltyTypeKind.SANCION,
]);

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

function primaryCompany(employee: Awaited<ReturnType<typeof dashboardRepository.findEmployees>>[number]) {
  return employee.companies.find((link) => link.isPrimary)?.company || employee.companies[0]?.company;
}

function firstAlta(employee: Awaited<ReturnType<typeof dashboardRepository.findEmployees>>[number]) {
  return employee.laborMovements.find((movement) => movement.type === LaborMovementType.ALTA);
}

function bajasThisYear(employee: Awaited<ReturnType<typeof dashboardRepository.findEmployees>>[number], year: number) {
  return employee.laborMovements.some((movement) => movement.type === LaborMovementType.BAJA && movement.effectiveFrom.getUTCFullYear() === year);
}

function upcomingBirthdays(employees: Awaited<ReturnType<typeof dashboardRepository.findEmployees>>) {
  const referenceDate = new Date();
  return employees
    .filter((employee) => {
      if (!employee.birthDate) return false;
      let next = new Date(referenceDate.getFullYear(), employee.birthDate.getUTCMonth(), employee.birthDate.getUTCDate(), 12);
      if (next < referenceDate) next = new Date(referenceDate.getFullYear() + 1, employee.birthDate.getUTCMonth(), employee.birthDate.getUTCDate(), 12);
      return (next.getTime() - referenceDate.getTime()) / dayMs <= 30;
    })
    .sort((a, b) => {
      const aKey = a.birthDate ? `${String(a.birthDate.getUTCMonth() + 1).padStart(2, "0")}-${String(a.birthDate.getUTCDate()).padStart(2, "0")}` : "";
      const bKey = b.birthDate ? `${String(b.birthDate.getUTCMonth() + 1).padStart(2, "0")}-${String(b.birthDate.getUTCDate()).padStart(2, "0")}` : "";
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
    const accessWhere = employeeAccessWhere(user);
    const [employees, timeEntries, periodNovelties, allNovelties, documents] = await Promise.all([
      dashboardRepository.findEmployees(accessWhere),
      dashboardRepository.findTimeEntries(period, accessWhere),
      dashboardRepository.findNovelties(period, accessWhere),
      dashboardRepository.findAllNovelties(accessWhere),
      dashboardRepository.findDocuments(accessWhere),
    ]);

    const active = employees.filter((employee) => employee.status === EmployeeStatus.ACTIVO);
    const countableEntries = timeEntries.filter((entry) => countableTimeStatuses.has(entry.status));
    const absenceDays = periodNovelties
      .filter((novelty) => absenceKinds.has(novelty.noveltyType.kind))
      .reduce((total, novelty) => total + dayCount(novelty.fromDate, novelty.toDate), 0);
    const transported = active.filter((employee) => employee.transport?.usesCompanyTransport);
    const withEntries = new Set(countableEntries.map((entry) => entry.employeeId));
    const now = new Date();
    const inactiveThisYear = employees.filter((employee) => employee.status === EmployeeStatus.INACTIVO && bajasThisYear(employee, now.getUTCFullYear()));

    return {
      period,
      total: employees.length,
      active: active.length,
      inactive: employees.length - active.length,
      absenceDays,
      absenceRate: active.length ? (absenceDays / (active.length * 21) * 100).toFixed(1) : "0.0",
      turnoverRate: employees.length ? (inactiveThisYear.length / ((active.length + employees.length) / 2) * 100).toFixed(1) : "0.0",
      exits: inactiveThisYear.length,
      upcomingBirthdays: upcomingBirthdays(active),
      averageAge: active.length ? (active.reduce((total, employee) => total + yearsBetween(employee.birthDate), 0) / active.length).toFixed(1) : "0.0",
      averageTenure: active.length ? (active.reduce((total, employee) => total + yearsBetween(firstAlta(employee)?.effectiveFrom || employee.createdAt), 0) / active.length).toFixed(1) : "0.0",
      transported: transported.length,
      transportByCity: groupCount(transported.map((employee) => employee.address?.city || employee.transport?.locality || "")),
      transportRoutes: groupCount(transported.map((employee) => employee.transport?.busLine || "")),
      loadedHours: countableEntries.reduce((total, entry) => total + formatDecimal(entry.hours), 0),
      loadCoverage: active.length ? Math.round((new Set(countableEntries.map((entry) => entry.employeeId)).size / active.length) * 100) : 0,
      pendingLoads: active.filter((employee) => !withEntries.has(employee.id)).length,
      reviewLoads: new Set(timeEntries.filter((entry) => entry.status === ApprovalStatus.EN_REVISION).map((entry) => entry.employeeId)).size,
      expiredDocuments: documents.filter((document) => document.status === DocumentStatus.VENCIDO).length,
      expiringDocuments: documents.filter((document) => document.status === DocumentStatus.POR_VENCER).length,
      missingResponsible: active.filter((employee) => !employee.assignments.some((assignment) => assignment.type === "TIME_RESPONSIBLE")).length,
      pendingNovelties: allNovelties.filter((novelty) => novelty.status === ApprovalStatus.PENDIENTE).length,
      headcountByCompany: groupCount(active.map((employee) => primaryCompany(employee)?.name || "")),
      headcountBySector: groupCount(active.map((employee) => employee.sector?.name || "")),
    };
  },
};
