import { ApprovalStatus, DocumentStatus, EmployeeStatus, LaborMovementType, NoveltyTypeKind } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextMonth(period: string) {
  const [year = 0, month = 1] = period.split("-").map(Number);
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
}

function activeWhere(accessWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput {
  return { ...accessWhere, status: EmployeeStatus.ACTIVO };
}

const absenceKinds: NoveltyTypeKind[] = [
  NoveltyTypeKind.AUSENCIA,
  NoveltyTypeKind.LICENCIA,
  NoveltyTypeKind.ACCIDENTE,
  NoveltyTypeKind.VACACIONES,
  NoveltyTypeKind.SANCION,
];

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const dashboardRepository = {
  // ── Headcounts ────────────────────────────────────────────────────────────

  countTotal(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: accessWhere });
  },

  countActive(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: activeWhere(accessWhere) });
  },

  /**
   * Count employees who are currently INACTIVO and had a BAJA movement
   * during the given calendar year.
   */
  countExitsThisYear(accessWhere: Prisma.EmployeeWhereInput, year: number) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    return prisma.employee.count({
      where: {
        ...accessWhere,
        status: EmployeeStatus.INACTIVO,
        laborMovements: {
          some: {
            type: LaborMovementType.BAJA,
            effectiveFrom: { gte: yearStart, lt: yearEnd },
          },
        },
      },
    });
  },

  // ── Transport ─────────────────────────────────────────────────────────────

  countTransported(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({
      where: { ...activeWhere(accessWhere), transport: { usesCompanyTransport: true } },
    });
  },

  /**
   * Minimal projection for transported employees — only the fields needed
   * to compute transportByCity and transportRoutes breakdowns.
   */
  findTransportedEmployees(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findMany({
      where: { ...activeWhere(accessWhere), transport: { usesCompanyTransport: true } },
      select: {
        address: { select: { city: true } },
        transport: { select: { locality: true, busLine: true } },
      },
    });
  },

  // ── Time entries ──────────────────────────────────────────────────────────

  /**
   * Sum of hours for APROBADO + EN_REVISION entries in the period.
   */
  sumLoadedHours(period: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.aggregate({
      where: {
        period,
        employee: accessWhere,
        status: { in: [ApprovalStatus.APROBADO, ApprovalStatus.EN_REVISION] },
      },
      _sum: { hours: true },
    });
  },

  /**
   * Count of distinct active employees who have at least one countable
   * (APROBADO | EN_REVISION) time entry in the period.
   */
  countEmployeesWithEntries(period: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({
      where: {
        ...activeWhere(accessWhere),
        timeEntries: {
          some: {
            period,
            status: { in: [ApprovalStatus.APROBADO, ApprovalStatus.EN_REVISION] },
          },
        },
      },
    });
  },

  /**
   * Count of distinct active employees who have NO countable time entry
   * in the period (pending load).
   */
  countEmployeesWithoutEntries(period: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({
      where: {
        ...activeWhere(accessWhere),
        timeEntries: {
          none: {
            period,
            status: { in: [ApprovalStatus.APROBADO, ApprovalStatus.EN_REVISION] },
          },
        },
      },
    });
  },

  /**
   * Count of distinct employees (any status) with at least one EN_REVISION
   * time entry in the period.
   */
  countEmployeesInReview(period: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({
      where: {
        ...accessWhere,
        timeEntries: {
          some: { period, status: ApprovalStatus.EN_REVISION },
        },
      },
    });
  },

  // ── Novelties ─────────────────────────────────────────────────────────────

  /**
   * Returns the fromDate/toDate pairs of absence novelties that overlap the
   * given period. Used to compute absenceDays in the service.
   */
  findPeriodAbsenceDateRanges(period: string, accessWhere: Prisma.EmployeeWhereInput) {
    const start = new Date(`${period}-01T00:00:00.000Z`);
    const end = nextMonth(period);
    return prisma.novelty.findMany({
      where: {
        employee: accessWhere,
        noveltyType: { kind: { in: absenceKinds } },
        fromDate: { lt: end },
        OR: [{ toDate: null }, { toDate: { gte: start } }],
      },
      select: { fromDate: true, toDate: true },
    });
  },

  countPendingNovelties(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.novelty.count({
      where: { employee: accessWhere, status: ApprovalStatus.PENDIENTE },
    });
  },

  // ── Documents ─────────────────────────────────────────────────────────────

  countExpiredDocuments(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employeeDocument.count({
      where: { employee: accessWhere, status: DocumentStatus.VENCIDO },
    });
  },

  countExpiringDocuments(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employeeDocument.count({
      where: { employee: accessWhere, status: DocumentStatus.POR_VENCER },
    });
  },

  // ── Assignments ───────────────────────────────────────────────────────────

  /**
   * Count active employees who have NO assignment of type TIME_RESPONSIBLE.
   */
  countMissingTimeResponsible(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({
      where: {
        ...activeWhere(accessWhere),
        assignments: { none: { type: "TIME_RESPONSIBLE" } },
      },
    });
  },

  // ── Birthdays ─────────────────────────────────────────────────────────────

  /**
   * All active employees with a birthDate — minimal projection.
   * Filtering for the 30-day window is done in the service (requires local
   * date arithmetic that Prisma cannot express portably).
   */
  findActiveDashboardEmployees(accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findMany({
      where: activeWhere(accessWhere),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        createdAt: true,
        sector: { select: { name: true } },
        companies: {
          select: { isPrimary: true, company: { select: { name: true } } },
        },
        laborMovements: {
          where: { type: LaborMovementType.ALTA },
          orderBy: { effectiveFrom: "asc" },
          take: 1,
          select: { effectiveFrom: true },
        },
      },
    });
  },
};
