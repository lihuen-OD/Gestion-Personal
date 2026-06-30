import { employeeAccessWhere } from "../employees/employeeAccess";
import { dashboardRepository } from "./dashboard.repository";
import type { DashboardMetricsQuery } from "./dashboard.schemas";

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
  employees: Awaited<ReturnType<typeof dashboardRepository.findActiveBirthDateEmployees>>,
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
    const accessWhere = employeeAccessWhere(user);
    const now = new Date();
    const year = now.getUTCFullYear();

    const [
      total,
      active,
      exits,
      transported,
      hoursResult,
      employeesWithEntries,
      pendingLoads,
      reviewLoads,
      absenceRanges,
      pendingNovelties,
      expiredDocuments,
      expiringDocuments,
      missingResponsible,
      birthdayEmployees,
      dateFieldEmployees,
      sectorEmployees,
      companyLinkEmployees,
    ] = await Promise.all([
      dashboardRepository.countTotal(accessWhere),
      dashboardRepository.countActive(accessWhere),
      dashboardRepository.countExitsThisYear(accessWhere, year),
      dashboardRepository.countTransported(accessWhere),
      dashboardRepository.sumLoadedHours(period, accessWhere),
      dashboardRepository.countEmployeesWithEntries(period, accessWhere),
      dashboardRepository.countEmployeesWithoutEntries(period, accessWhere),
      dashboardRepository.countEmployeesInReview(period, accessWhere),
      dashboardRepository.findPeriodAbsenceDateRanges(period, accessWhere),
      dashboardRepository.countPendingNovelties(accessWhere),
      dashboardRepository.countExpiredDocuments(accessWhere),
      dashboardRepository.countExpiringDocuments(accessWhere),
      dashboardRepository.countMissingTimeResponsible(accessWhere),
      dashboardRepository.findActiveBirthDateEmployees(accessWhere),
      dashboardRepository.findActiveDateFields(accessWhere),
      dashboardRepository.findActiveSectors(accessWhere),
      dashboardRepository.findActiveCompanyLinks(accessWhere),
    ]);

    const inactive = total - active;
    const loadedHours = formatDecimal(hoursResult._sum.hours);

    const absenceDays = absenceRanges.reduce(
      (total, novelty) => total + dayCount(novelty.fromDate, novelty.toDate),
      0,
    );

    // averageAge — uses birthDate only
    const averageAge =
      active > 0
        ? (
            dateFieldEmployees.reduce((sum: number, e) => sum + yearsBetween(e.birthDate), 0) / active
          ).toFixed(1)
        : "0.0";

    // averageTenure — uses first ALTA effectiveFrom, falling back to createdAt
    const averageTenure =
      active > 0
        ? (
            dateFieldEmployees.reduce(
              (sum: number, e) =>
                sum + yearsBetween(e.laborMovements[0]?.effectiveFrom ?? e.createdAt),
              0,
            ) / active
          ).toFixed(1)
        : "0.0";

    // Transport breakdowns
    const transportedEmployees = await dashboardRepository.findTransportedEmployees(accessWhere);
    const transportByCity = groupCount(
      transportedEmployees.map((e) => e.address?.city || e.transport?.locality || ""),
    );
    const transportRoutes = groupCount(
      transportedEmployees.map((e) => e.transport?.busLine || ""),
    );

    // Sector breakdown
    const headcountBySector = groupCount(sectorEmployees.map((e) => e.sector?.name || ""));

    // Company breakdown — primary company wins, fallback to first
    const headcountByCompany = groupCount(
      companyLinkEmployees.map((e) => {
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
      upcomingBirthdays: upcomingBirthdays(birthdayEmployees),
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
  },
};
