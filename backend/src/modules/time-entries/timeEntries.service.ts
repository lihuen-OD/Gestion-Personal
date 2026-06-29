import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import { timeEntriesRepository } from "./timeEntries.repository";
import type { CreateTimeEntryInput, ListTimeEntriesQuery, RejectTimeEntryInput, TimeEntriesExportQuery, UpdateTimeEntryInput } from "./timeEntries.schemas";

export type TimeEntriesExportRow = {
  CUIL: string;
  Apellido: string;
  Nombre: string;
  Legajo: string;
  Empresa: string;
  "Centro de costo": string;
  "Horas normales": string;
  "Horas especiales": string;
  "Horas trabajadas totales": string;
  Estado: string;
};

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      throw new AppError("Time entry not found", 404, "TIME_ENTRY_NOT_FOUND");
    }
    if (error.code === "P2003") {
      throw new AppError("Related employee or hour concept not found", 400, "RELATION_CONSTRAINT");
    }
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

async function ensureEmployeeScope(employeeId: string, user: Express.AuthUser) {
  const count = await timeEntriesRepository.countEmployeeInScope(employeeId, employeeAccessWhere(user));
  if (!count) {
    throw new AppError("Employee not found or outside your scope", 403, "EMPLOYEE_SCOPE_FORBIDDEN");
  }
}

async function ensureHourConceptEnabled(employeeId: string, hourConceptId: string) {
  const enabled = await timeEntriesRepository.findEnabledHourConcept(employeeId, hourConceptId);
  if (!enabled || enabled.hourConcept.status !== "ACTIVO") {
    throw new AppError("Hour concept is not enabled for this employee", 400, "HOUR_CONCEPT_NOT_ENABLED");
  }
}

async function ensureNoDuplicate(employeeId: string, hourConceptId: string, date: Date, exceptId?: string) {
  const duplicate = await timeEntriesRepository.findDuplicate(employeeId, hourConceptId, date, exceptId);
  if (duplicate) {
    throw new AppError("Time entry already exists for this employee, date and hour concept", 409, "TIME_ENTRY_DUPLICATED");
  }
}

async function ensureDayIsNotBlocked(employeeId: string, date: Date, hours?: number) {
  if (!hours || hours <= 0) return;
  const blockingNovelty = await timeEntriesRepository.findBlockingNovelty(employeeId, date);
  if (blockingNovelty) {
    throw new AppError(
      `The day is blocked by novelty ${blockingNovelty.noveltyType.code} - ${blockingNovelty.noveltyType.name}`,
      409,
      "TIME_ENTRY_DAY_BLOCKED_BY_NOVELTY",
    );
  }
}

function assertCanReview(user: Express.AuthUser) {
  if (user.role !== roles.rrhh && user.role !== roles.supervision) {
    throw new AppError("Only RRHH or supervision can review time entries", 403, "FORBIDDEN");
  }
}

function assertEditable(status: string) {
  if (status === "APROBADO" || status === "CERRADO") {
    throw new AppError("Approved or closed time entries cannot be edited", 400, "TIME_ENTRY_LOCKED");
  }
}

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function escapeCsv(value: string) {
  if (/[",\r\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function timeEntriesExportToCsv(rows: TimeEntriesExportRow[]) {
  const headers: (keyof TimeEntriesExportRow)[] = [
    "CUIL",
    "Apellido",
    "Nombre",
    "Legajo",
    "Empresa",
    "Centro de costo",
    "Horas normales",
    "Horas especiales",
    "Horas trabajadas totales",
    "Estado",
  ];
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(";"))].join("\r\n");
}

export const timeEntriesService = {
  async list(query: ListTimeEntriesQuery, user: Express.AuthUser) {
    const [items, total] = await timeEntriesRepository.findMany(query, employeeAccessWhere(user));
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async create(input: CreateTimeEntryInput, user: Express.AuthUser, audit?: AuditContext) {
    await ensureEmployeeScope(input.employeeId, user);
    await ensureHourConceptEnabled(input.employeeId, input.hourConceptId);
    await ensureDayIsNotBlocked(input.employeeId, input.date, input.hours);
    await ensureNoDuplicate(input.employeeId, input.hourConceptId, input.date);
    const item = await execute(() => timeEntriesRepository.create(input, user.id));

    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "TimeEntry",
      entityId: item.id,
      description: `Se cargo ${item.hours.toString()} hs para el legajo ${item.employee.legajo}.`,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async update(id: string, input: UpdateTimeEntryInput, user: Express.AuthUser, audit?: AuditContext) {
    const before = await timeEntriesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Time entry not found", 404, "TIME_ENTRY_NOT_FOUND");
    assertEditable(before.status);

    const employeeId = before.employeeId;
    const hourConceptId = input.hourConceptId || before.hourConceptId;
    const date = input.date || before.date;
    await ensureHourConceptEnabled(employeeId, hourConceptId);
    await ensureDayIsNotBlocked(employeeId, date, input.hours);
    await ensureNoDuplicate(employeeId, hourConceptId, date, id);

    const item = await execute(() => timeEntriesRepository.update(id, before, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "TimeEntry",
      entityId: item.id,
      description: `Se actualizo carga horaria del legajo ${item.employee.legajo}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async submit(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const before = await timeEntriesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Time entry not found", 404, "TIME_ENTRY_NOT_FOUND");
    if (before.status !== "BORRADOR" && before.status !== "DEVUELTO") {
      throw new AppError("Only draft or returned entries can be submitted", 400, "TIME_ENTRY_STATUS_NOT_SUBMITTABLE");
    }
    const item = await execute(() => timeEntriesRepository.submit(id));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "TimeEntry",
      entityId: item.id,
      description: `Se envio a revision carga horaria del legajo ${item.employee.legajo}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async approve(id: string, user: Express.AuthUser, audit?: AuditContext) {
    assertCanReview(user);
    const before = await timeEntriesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Time entry not found", 404, "TIME_ENTRY_NOT_FOUND");
    if (before.status !== "EN_REVISION") {
      throw new AppError("Only entries in review can be approved", 400, "TIME_ENTRY_STATUS_NOT_APPROVABLE");
    }
    const item = await execute(() => timeEntriesRepository.approve(id, user.id));
    await auditService.register({
      ...audit,
      action: "APPROVE",
      entity: "TimeEntry",
      entityId: item.id,
      description: `Se aprobo carga horaria del legajo ${item.employee.legajo}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async reject(id: string, input: RejectTimeEntryInput, user: Express.AuthUser, audit?: AuditContext) {
    assertCanReview(user);
    const before = await timeEntriesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Time entry not found", 404, "TIME_ENTRY_NOT_FOUND");
    if (before.status !== "EN_REVISION") {
      throw new AppError("Only entries in review can be rejected", 400, "TIME_ENTRY_STATUS_NOT_REJECTABLE");
    }
    const item = await execute(() => timeEntriesRepository.reject(id));
    await auditService.register({
      ...audit,
      action: "REJECT",
      entity: "TimeEntry",
      entityId: item.id,
      description: `Se rechazo carga horaria del legajo ${item.employee.legajo}. Motivo: ${input.reason}`,
      before: before as Prisma.InputJsonValue,
      after: { item, reason: input.reason } as Prisma.InputJsonValue,
    });
    return item;
  },

  async returnForCorrection(id: string, input: RejectTimeEntryInput, user: Express.AuthUser, audit?: AuditContext) {
    assertCanReview(user);
    const before = await timeEntriesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Time entry not found", 404, "TIME_ENTRY_NOT_FOUND");
    if (before.status !== "EN_REVISION") {
      throw new AppError("Only entries in review can be returned", 400, "TIME_ENTRY_STATUS_NOT_RETURNABLE");
    }
    const item = await execute(() => timeEntriesRepository.returnForCorrection(id));
    await auditService.register({
      ...audit,
      action: "RETURN",
      entity: "TimeEntry",
      entityId: item.id,
      description: `Se devolvio carga horaria del legajo ${item.employee.legajo}. Motivo: ${input.reason}`,
      before: before as Prisma.InputJsonValue,
      after: { item, reason: input.reason } as Prisma.InputJsonValue,
    });
    return item;
  },

  async exportByPerson(query: TimeEntriesExportQuery, user: Express.AuthUser, audit?: AuditContext) {
    const entries = await timeEntriesRepository.findForExport(query, employeeAccessWhere(user));
    const grouped = new Map<string, { normal: number; special: number; statuses: Set<string>; entry: (typeof entries)[number] }>();

    for (const entry of entries) {
      const current = grouped.get(entry.employeeId) || { normal: 0, special: 0, statuses: new Set<string>(), entry };
      const hours = Number(entry.hours.toString());
      if (entry.hourConcept.kind === "NORMAL") current.normal += hours;
      else current.special += hours;
      current.statuses.add(entry.status);
      grouped.set(entry.employeeId, current);
    }

    const rows = Array.from(grouped.values()).map(({ normal, special, statuses, entry }) => {
      const primaryCompany = entry.employee.companies.find((company) => company.isPrimary)?.company || entry.employee.companies[0]?.company;
      return {
        CUIL: entry.employee.cuil,
        Apellido: entry.employee.lastName,
        Nombre: entry.employee.firstName,
        Legajo: entry.employee.legajo,
        Empresa: primaryCompany?.name || "",
        "Centro de costo": entry.employee.costCenter?.code || "",
        "Horas normales": formatNumber(normal),
        "Horas especiales": formatNumber(special),
        "Horas trabajadas totales": formatNumber(normal + special),
        Estado: statuses.size === 1 ? Array.from(statuses)[0] || "" : "MIXTO",
      };
    });

    await auditService.register({
      ...audit,
      action: "EXPORT",
      entity: "TimeEntry",
      description: `Se preparo exportacion de horas del periodo ${query.period} con ${rows.length} personas.`,
      after: { query, totalRows: rows.length } as Prisma.InputJsonValue,
    });

    return { total: rows.length, rows };
  },
};
