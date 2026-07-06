import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import { timeEntriesRepository } from "./timeEntries.repository";
import type {
  CreateTimeEntryInput,
  CreateWorkShiftInput,
  ClockByEmployeeInput,
  ClockByDniInput,
  ClockEmployeeSearchQuery,
  ListTimeEntriesQuery,
  PreviewWorkShiftInput,
  RejectTimeEntryInput,
  TimeEntriesExportQuery,
  TimeEntriesPeriodEmployeesQuery,
  TimeEntriesSummaryQuery,
  UpdateTimeEntryInput,
} from "./timeEntries.schemas";

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

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

const ARGENTINA_OFFSET_MINUTES = -180;
const MAX_SHIFT_MINUTES = 16 * 60;

function offsetMs() {
  return ARGENTINA_OFFSET_MINUTES * 60_000;
}

function localDateParts(value: Date) {
  const shifted = new Date(value.getTime() + offsetMs());
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    key: shifted.toISOString().slice(0, 10),
  };
}

function dateAtUtcMidnight(localDateKey: string) {
  return new Date(`${localDateKey}T00:00:00.000Z`);
}

function nextLocalMidnightUtc(value: Date) {
  const parts = localDateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offsetMs());
}

function formatLocalTime(value: Date) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function buildShiftSegments(startAt: Date, endAt: Date) {
  if (endAt <= startAt) {
    throw new AppError("La hora de salida debe ser posterior a la hora de ingreso.", 400, "WORK_SHIFT_INVALID_RANGE");
  }
  const totalMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
  if (totalMinutes > MAX_SHIFT_MINUTES) {
    throw new AppError("La jornada supera el máximo permitido de 16 horas. Requiere revisión manual.", 400, "WORK_SHIFT_TOO_LONG");
  }

  const segments: Array<{ date: Date; startAt: Date; endAt: Date; minutes: number; hours: number; label: string }> = [];
  let cursor = startAt;
  while (cursor < endAt) {
    const segmentEnd = new Date(Math.min(endAt.getTime(), nextLocalMidnightUtc(cursor).getTime()));
    const minutes = Math.round((segmentEnd.getTime() - cursor.getTime()) / 60_000);
    const localDate = localDateParts(cursor).key;
    if (minutes > 0) {
      segments.push({
        date: dateAtUtcMidnight(localDate),
        startAt: cursor,
        endAt: segmentEnd,
        minutes,
        hours: Number((minutes / 60).toFixed(2)),
        label: `${localDate} ${formatLocalTime(cursor)}-${formatLocalTime(segmentEnd)} (${formatNumber(minutes / 60)} h)`,
      });
    }
    cursor = segmentEnd;
  }
  return { totalMinutes, segments };
}

async function resolveShiftEmployee(input: Pick<PreviewWorkShiftInput, "employeeId" | "dni">, user: Express.AuthUser) {
  const employee = await timeEntriesRepository.findEmployeeForShift(input, employeeAccessWhere(user));
  if (!employee) throw new AppError("No se encontró un legajo habilitado para ese DNI o empleado.", 404, "WORK_SHIFT_EMPLOYEE_NOT_FOUND");
  return employee;
}

async function resolveShiftConcept(employeeId: string, hourConceptId?: string) {
  const enabled = await timeEntriesRepository.findDefaultHourConcept(employeeId, hourConceptId);
  if (!enabled || enabled.hourConcept.status !== "ACTIVO") {
    throw new AppError("El empleado no tiene una hora normal habilitada para generar la carga.", 400, "WORK_SHIFT_HOUR_CONCEPT_NOT_ENABLED");
  }
  return enabled.hourConcept;
}

async function validateShift(input: PreviewWorkShiftInput, user: Express.AuthUser) {
  const employee = await resolveShiftEmployee(input, user);
  const hourConcept = await resolveShiftConcept(employee.id, input.hourConceptId);
  const calculation = buildShiftSegments(input.startAt, input.endAt);

  const overlap = await timeEntriesRepository.findOverlappingWorkShift(employee.id, input.startAt, input.endAt);
  if (overlap) {
    throw new AppError("Ya existe una marcación superpuesta para este empleado.", 409, "WORK_SHIFT_OVERLAP");
  }

  for (const segment of calculation.segments) {
    await ensureDayIsNotBlocked(employee.id, segment.date, segment.hours);
  }

  return { employee, hourConcept, ...calculation };
}

function publicEmployeeLabel(employee: { id?: string; firstName: string; lastName: string; legajo: string; dni?: string }) {
  return {
    id: employee.id,
    legajo: employee.legajo,
    dni: employee.dni,
    firstName: employee.firstName,
    lastName: employee.lastName,
    name: `${employee.lastName}, ${employee.firstName}`,
  };
}

async function resolveClockEmployee(dni: string) {
  const employee = await timeEntriesRepository.findEmployeeByDniForClock(dni);
  if (!employee) throw new AppError("No se encontró un legajo para el DNI ingresado.", 404, "CLOCK_EMPLOYEE_NOT_FOUND");
  return employee;
}

async function resolveClockEmployeeById(employeeId: string) {
  const employee = await timeEntriesRepository.findEmployeeByIdForClock(employeeId);
  if (!employee) throw new AppError("No se encontró el legajo seleccionado.", 404, "CLOCK_EMPLOYEE_NOT_FOUND");
  return employee;
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

  summary(query: TimeEntriesSummaryQuery, user: Express.AuthUser) {
    return timeEntriesRepository.summary(query.period || currentPeriod(), employeeAccessWhere(user));
  },

  async periodEmployees(query: TimeEntriesPeriodEmployeesQuery, user: Express.AuthUser) {
    const result = await timeEntriesRepository.findPeriodEmployees(query, employeeAccessWhere(user));
    return {
      items: result.items,
      meta: {
        total: result.total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < result.total,
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

  async previewWorkShift(input: PreviewWorkShiftInput, user: Express.AuthUser) {
    const result = await validateShift(input, user);
    return {
      employee: result.employee,
      hourConcept: result.hourConcept,
      totalMinutes: result.totalMinutes,
      totalHours: Number((result.totalMinutes / 60).toFixed(2)),
      segments: result.segments.map((segment) => ({
        date: segment.date,
        startAt: segment.startAt,
        endAt: segment.endAt,
        minutes: segment.minutes,
        hours: segment.hours,
        label: segment.label,
      })),
    };
  },

  async createWorkShift(input: CreateWorkShiftInput, user: Express.AuthUser, audit?: AuditContext) {
    const result = await validateShift(input, user);
    try {
      const created = await timeEntriesRepository.createFromWorkShift({
        employeeId: result.employee.id,
        hourConceptId: result.hourConcept.id,
        source: input.source,
        startAt: input.startAt,
        endAt: input.endAt,
        totalMinutes: result.totalMinutes,
        observation: input.observation,
        segments: result.segments,
        createdByUserId: user.id,
      });

      await auditService.register({
        ...audit,
        action: "CREATE",
        entity: "WorkShift",
        entityId: created.workShift.id,
        description: `Se registro marcacion de ${formatNumber(result.totalMinutes / 60)} hs para el legajo ${result.employee.legajo}.`,
        after: {
          workShift: created.workShift,
          segments: result.segments.map((segment) => segment.label),
          timeEntryIds: created.entries.map((entry) => entry.id),
        } as Prisma.InputJsonValue,
      });

      return {
        ...created,
        preview: {
          employee: result.employee,
          hourConcept: result.hourConcept,
          totalMinutes: result.totalMinutes,
          totalHours: Number((result.totalMinutes / 60).toFixed(2)),
          segments: result.segments,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TIME_ENTRY_LOCKED:")) {
        throw new AppError("La jornada coincide con una carga horaria aprobada o cerrada. Debe corregirse manualmente.", 409, "WORK_SHIFT_LOCKED_TIME_ENTRY");
      }
      throw error;
    }
  },

  async clockStatus(input: ClockByDniInput) {
    const employee = await resolveClockEmployee(input.dni);
    const openShift = await timeEntriesRepository.findOpenWorkShift(employee.id);
    return {
      employee: publicEmployeeLabel(employee),
      openShift: openShift ? {
        id: openShift.id,
        startAt: openShift.startAt,
      } : null,
    };
  },

  async clockSearch(query: ClockEmployeeSearchQuery) {
    const employees = await timeEntriesRepository.searchEmployeesForClock(query.search);
    return employees.map(publicEmployeeLabel);
  },

  async clockStatusByEmployee(input: ClockByEmployeeInput) {
    const employee = await resolveClockEmployeeById(input.employeeId);
    const openShift = await timeEntriesRepository.findOpenWorkShift(employee.id);
    return {
      employee: publicEmployeeLabel(employee),
      openShift: openShift ? {
        id: openShift.id,
        startAt: openShift.startAt,
      } : null,
    };
  },

  async clockIn(input: ClockByDniInput) {
    const employee = await resolveClockEmployee(input.dni);
    const openShift = await timeEntriesRepository.findOpenWorkShift(employee.id);
    if (openShift) {
      throw new AppError("Ya existe un ingreso abierto para este empleado.", 409, "CLOCK_ALREADY_OPEN");
    }
    const now = new Date();
    const workShift = await timeEntriesRepository.createOpenWorkShift({
      employeeId: employee.id,
      source: "PORTAL_DNI",
      startAt: now,
    });
    return {
      employee: publicEmployeeLabel(employee),
      workShift: {
        id: workShift.id,
        startAt: workShift.startAt,
      },
    };
  },

  async clockInByEmployee(input: ClockByEmployeeInput) {
    const employee = await resolveClockEmployeeById(input.employeeId);
    const openShift = await timeEntriesRepository.findOpenWorkShift(employee.id);
    if (openShift) {
      throw new AppError("Ya existe un ingreso abierto para este empleado.", 409, "CLOCK_ALREADY_OPEN");
    }
    const now = new Date();
    const workShift = await timeEntriesRepository.createOpenWorkShift({
      employeeId: employee.id,
      source: "PORTAL_DNI",
      startAt: now,
    });
    return {
      employee: publicEmployeeLabel(employee),
      workShift: {
        id: workShift.id,
        startAt: workShift.startAt,
      },
    };
  },

  async clockOut(input: ClockByDniInput) {
    const employee = await resolveClockEmployee(input.dni);
    const openShift = await timeEntriesRepository.findOpenWorkShift(employee.id);
    if (!openShift) {
      throw new AppError("No hay un ingreso abierto para este empleado.", 409, "CLOCK_NO_OPEN_SHIFT");
    }
    const hourConcept = await resolveShiftConcept(employee.id);
    const endAt = new Date();
    const calculation = buildShiftSegments(openShift.startAt, endAt);
    for (const segment of calculation.segments) {
      await ensureDayIsNotBlocked(employee.id, segment.date, segment.hours);
    }
    try {
      const created = await timeEntriesRepository.closeOpenWorkShift({
        workShiftId: openShift.id,
        employeeId: employee.id,
        hourConceptId: hourConcept.id,
        source: "PORTAL_DNI",
        endAt,
        totalMinutes: calculation.totalMinutes,
        segments: calculation.segments,
      });
      return {
        employee: publicEmployeeLabel(employee),
        workShift: {
          id: created.workShift.id,
          startAt: created.workShift.startAt,
          endAt: created.workShift.endAt,
          totalMinutes: created.workShift.totalMinutes,
          totalHours: Number((calculation.totalMinutes / 60).toFixed(2)),
        },
        segments: calculation.segments.map((segment) => ({
          date: segment.date,
          startAt: segment.startAt,
          endAt: segment.endAt,
          minutes: segment.minutes,
          hours: segment.hours,
          label: segment.label,
        })),
        entries: created.entries,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TIME_ENTRY_LOCKED:")) {
        throw new AppError("La salida coincide con una carga horaria aprobada o cerrada. Avisá a RRHH para corregirla.", 409, "CLOCK_LOCKED_TIME_ENTRY");
      }
      throw error;
    }
  },

  async clockOutByEmployee(input: ClockByEmployeeInput) {
    const employee = await resolveClockEmployeeById(input.employeeId);
    const openShift = await timeEntriesRepository.findOpenWorkShift(employee.id);
    if (!openShift) {
      throw new AppError("No hay un ingreso abierto para este empleado.", 409, "CLOCK_NO_OPEN_SHIFT");
    }
    const hourConcept = await resolveShiftConcept(employee.id);
    const endAt = new Date();
    const calculation = buildShiftSegments(openShift.startAt, endAt);
    for (const segment of calculation.segments) {
      await ensureDayIsNotBlocked(employee.id, segment.date, segment.hours);
    }
    try {
      const created = await timeEntriesRepository.closeOpenWorkShift({
        workShiftId: openShift.id,
        employeeId: employee.id,
        hourConceptId: hourConcept.id,
        source: "PORTAL_DNI",
        endAt,
        totalMinutes: calculation.totalMinutes,
        segments: calculation.segments,
      });
      return {
        employee: publicEmployeeLabel(employee),
        workShift: {
          id: created.workShift.id,
          startAt: created.workShift.startAt,
          endAt: created.workShift.endAt,
          totalMinutes: created.workShift.totalMinutes,
          totalHours: Number((calculation.totalMinutes / 60).toFixed(2)),
        },
        segments: calculation.segments.map((segment) => ({
          date: segment.date,
          startAt: segment.startAt,
          endAt: segment.endAt,
          minutes: segment.minutes,
          hours: segment.hours,
          label: segment.label,
        })),
        entries: created.entries,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TIME_ENTRY_LOCKED:")) {
        throw new AppError("La salida coincide con una carga horaria aprobada o cerrada. Avisá a RRHH para corregirla.", 409, "CLOCK_LOCKED_TIME_ENTRY");
      }
      throw error;
    }
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
