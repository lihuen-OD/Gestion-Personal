import { ApprovalStatus, EmployeeStatus, Prisma, WorkShiftSource, WorkShiftStatus } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { FICHADA_ORIGIN_NOTE } from "./timeEntryObservationText";
import { noveltyCoversDay } from "../novelties/novelties.dateRange";
import { resolveActiveWorkRegime } from "../work-regimes/workRegimes.service";
import { flagOpenShiftOverflowForReview, resolveOpenShiftOverflowAlert } from "../shifts/workShiftEvaluationRunner";
import { buildActiveDatesByRule, resolveWinningRules, ruleMatchesDate, specialHourApplicationRows, specialHourRulesForEmployeeOnDate, type SpecialHourRuleResolution } from "../workforce-management/doubleHourRuleMatching";
import {
  accountEmployeePeriods,
  accountingBaseEntrySelect,
  accountingBreakdownSelect,
  countedBreakdownStatusWhere,
  emptyPeriodAccounting,
  toAccountingBaseEntry,
  toAccountingBreakdown,
  totalWorkedHours,
} from "./workedTimeAccounting";
import {
  argentinaCalendarDate,
  argentinaDateKey,
  calendarDateKey,
  dayOfMonthFromCalendarDate,
  dayOfMonthFromInstant,
  periodFromCalendarDate,
  periodFromInstant,
} from "../../shared/datetime/argentinaTime";
import type { CreateTimeEntryInput, employeeRowSortKeys, ListTimeEntriesQuery, TimeEntriesExportQuery, TimeEntriesPeriodEmployeesQuery, timeEntryListSortKeys, UpdateTimeEntryInput } from "./timeEntries.schemas";
import { resolveOrderBy, type SortOrderByMap } from "../../shared/validation/listSort";

const timeEntryListOrderBy: SortOrderByMap<(typeof timeEntryListSortKeys)[number], Prisma.TimeEntryOrderByWithRelationInput> = {
  legajo: (order) => [{ employee: { legajo: order } }, { date: "desc" }],
  employee: (order) => [{ employee: { lastName: order } }, { employee: { firstName: order } }, { date: "desc" }],
  date: (order) => [{ date: order }, { employee: { lastName: "asc" } }],
  hourConcept: (order) => [{ hourConcept: { name: order } }, { date: "desc" }],
  hours: (order) => [{ hours: order }, { date: "desc" }],
  status: (order) => [{ status: order }, { date: "desc" }],
};

const employeeRowOrderBy: SortOrderByMap<(typeof employeeRowSortKeys)[number], Prisma.EmployeeOrderByWithRelationInput> = {
  legajo: (order) => [{ legajo: order }],
  employee: (order) => [{ lastName: order }, { firstName: order }],
};
const employeeRowDefaultOrderBy: Prisma.EmployeeOrderByWithRelationInput[] = [{ lastName: "asc" }, { firstName: "asc" }];

function isEmployeeRowSortKey(key: string | undefined): key is (typeof employeeRowSortKeys)[number] {
  return key === "legajo" || key === "employee";
}

function periodRange(period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

const timeEntryInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, firstName: true, lastName: true, status: true } },
  hourConcept: true,
  // Etapa 11B: nombre de la/las regla(s) ganadora(s) de Hora Especial — usado
  // por la Bandeja de revisión (mismo criterio ya usado en findPeriodEmployees
  // desde 11A y en el detalle por legajo desde 11B). appliedMultiplier ya
  // viaja por default (escalar de TimeEntry); esto agrega sólo la relación.
  timeSegment: {
    select: {
      specialHourRuleApplications: {
        where: { isWinner: true },
        select: { wasConflicting: true, doubleHourRule: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.TimeEntryInclude;

// Contrato compartido entre attendanceSummary y attendanceObservations (ver
// auditoría 8E): antes cada uno seleccionaba un subconjunto distinto de
// TimeSegment/TimeEntry sin ninguna razón de negocio — attendanceSummary
// recortaba hourConceptId/hourConceptRuleId/conceptStatus/appliedMultiplier/
// actualMinutes, attendanceObservations los traía por default de Prisma.
// Un solo select para los dos evita que la diferencia sea un accidente de
// implementación en vez de una decisión.
const attendanceTimeSegmentSelect = {
  id: true,
  date: true,
  fromDateTime: true,
  toDateTime: true,
  minutes: true,
  hourConceptId: true,
  hourConceptName: true,
  hourConceptRuleId: true,
  conceptStatus: true,
  isHoliday: true,
  isNight: true,
  isSpecial: true,
  observation: true,
  // SpecialHourRuleApplication nunca se leía en ningún endpoint (ver
  // auditoría 8E) — se agrega acá porque es un select anidado más, sin
  // migración ni endpoint nuevo. doubleHourRule.name es la única forma hoy
  // de saber CUÁL regla especial se aplicó, no solo que "isSpecial=true".
  specialHourRuleApplications: {
    select: {
      id: true,
      multiplierApplied: true,
      doubleHourRule: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.TimeSegmentSelect;

const attendanceTimeEntrySelect = {
  id: true,
  date: true,
  hours: true,
  totalMinutes: true,
  actualMinutes: true,
  appliedMultiplier: true,
  timeSegmentId: true,
  status: true,
  observation: true,
  hourConcept: { select: { id: true, name: true, kind: true } },
} satisfies Prisma.TimeEntrySelect;

// Etapa 14C.2: recortado a lo que la grilla de Carga Horaria realmente
// renderiza — ver docs/decisions/TIME_ENTRIES_PERFORMANCE_14C2.md §1.6-1.7.
// `HoursPage.tsx` (grilla principal) sólo usa legajo/nombre/empresa/centro de
// costo/estado; `sector`/`position`/`dni`/`cuil` no se muestran en ningún
// lado de esta pantalla. `companies` se mantiene (alimenta `employee.company`
// vía el mapper compartido) y `costCenter` se mantiene (se muestra).
const periodEmployeeSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  firstName: true,
  lastName: true,
  status: true,
  costCenter: { select: { id: true, name: true, code: true } },
  companies: { select: { isPrimary: true, company: { select: { id: true, name: true, code: true } } } },
} satisfies Prisma.EmployeeSelect;

const exportEmployeeInclude = {
  costCenter: true,
  companies: { include: { company: true }, orderBy: { isPrimary: "desc" } },
} satisfies Prisma.EmployeeInclude;

const statusPriority = ["DEVUELTO", "EN_REVISION", "RECHAZADO", "PENDIENTE", "BORRADOR", "APROBADO", "CERRADO"] as const;
const editableStatuses: ApprovalStatus[] = [ApprovalStatus.BORRADOR, ApprovalStatus.PENDIENTE, ApprovalStatus.DEVUELTO, ApprovalStatus.RECHAZADO];

type PunchEvidenceInput = {
  photoUrl?: string | null;
  photoStoragePath?: string | null;
  photoFileId?: string | null;
  thumbnailFileId?: string | null;
  faceDetected?: boolean;
  faceValidationStatus?: "VALID" | "NO_FACE" | "MULTIPLE_FACES" | "LOW_LIGHT" | "FACE_TOO_SMALL" | "CAMERA_ERROR" | null;
  faceDetectionScore?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  // F6: ClockDevice autenticado que registró la fichada. Sale sólo de
  // requireClockDevice (nunca del body); las fichadas sin dispositivo
  // (ADMIN, PORTAL_DNI, históricas) quedan en NULL.
  deviceId?: string | null;
  rawPayload?: Prisma.InputJsonValue;
};

// Segmento ya clasificado (etapa de Turnos V1 — clasificación multi-concepto):
// cada tramo trae su propio concepto detectado, no uno uniforme para toda la
// jornada. conceptStatus/hourConceptRuleId son opcionales para no romper los
// llamadores que todavía no clasifican (quedan en el default del schema:
// MANUAL / null).
export type ClassifiedSegmentForPersistence = {
  date: Date;
  startAt: Date;
  endAt: Date;
  minutes: number;
  hours: number;
  hourConceptId: string;
  hourConceptName: string;
  conceptStatus?: "SUGERIDO" | "MANUAL" | "SIN_CONCEPTO_COMPATIBLE" | "CONCEPTO_NO_HABILITADO";
  hourConceptRuleId?: string | null;
};

function punchEvidenceData(evidence?: PunchEvidenceInput) {
  if (!evidence) return {};
  return {
    photoUrl: evidence.photoUrl || null,
    photoStoragePath: evidence.photoStoragePath || null,
    photoFileId: evidence.photoFileId || null,
    thumbnailFileId: evidence.thumbnailFileId || null,
    faceDetected: Boolean(evidence.faceDetected),
    faceValidationStatus: evidence.faceValidationStatus || null,
    faceDetectionScore: evidence.faceDetectionScore ?? null,
    ipAddress: evidence.ipAddress || null,
    userAgent: evidence.userAgent || null,
    deviceId: evidence.deviceId || null,
    rawPayload: evidence.rawPayload,
  };
}

function minutesFromHours(hours: number) {
  return Math.round(hours * 60);
}

// HourConceptKind es un enum genérico del schema (RRHH elige el kind al
// configurar cada HourConcept; el nombre del concepto sigue siendo 100%
// configurable) — no un nombre de cliente. Usarlo para derivar isNight no
// viola "no hardcodear conceptos": no se compara ningún string de nombre.
const NIGHT_HOUR_CONCEPT_KINDS = new Set(["NOCTURNA", "GUARDIA", "SERENO"]);

type DoubleHourRuleForEngine = Prisma.DoubleHourRuleGetPayload<{ include: { dates: true } }>;

// Filtro de una dimensión de alcance (sector/centro de costo/puesto): la
// regla matchea si no restringe esa dimensión (null) o si restringe
// exactamente al valor del empleado. OJO: no se puede escribir como
// `{ OR: [{ [field]: null }, { [field]: employeeValue ?? undefined }] }` —
// `undefined` hace que Prisma OMITA esa condición del OR (no que no
// matchee), y un objeto `{}` dentro de un OR matchea cualquier fila. Por eso,
// si el empleado no tiene valor en esa dimensión, la única condición posible
// es "la regla tampoco la restringe" — nunca "vale cualquier cosa".
function scopeDimensionFilter(field: "sectorId" | "costCenterId" | "positionId", employeeValue: string | null | undefined): Prisma.DoubleHourRuleWhereInput {
  return employeeValue ? { OR: [{ [field]: null }, { [field]: employeeValue }] } : { [field]: null };
}

// Filtro Prisma de alcance por empleado (empresa/sector/centro de
// costo/puesto/empleados específicos, todos opcionales y combinados con AND).
// Lo usa sólo el motor único resolveSpecialHourRulesByDate, que recibe el
// cliente (`prisma` o el `tx` de la transacción) tipado como
// PrismaTransactionClient.
function doubleHourRuleScopeWhere(employeeId: string, employeeCompanyIds: string[], employeeSectorId: string | null | undefined, employeeCostCenterId: string | null | undefined, employeePositionId: string | null | undefined): Prisma.DoubleHourRuleWhereInput["AND"] {
  return [
    { OR: [{ employees: { none: {} } }, { employees: { some: { employeeId } } }] },
    employeeCompanyIds.length ? { OR: [{ companyId: null }, { companyId: { in: employeeCompanyIds } }] } : { companyId: null },
    scopeDimensionFilter("sectorId", employeeSectorId),
    scopeDimensionFilter("costCenterId", employeeCostCenterId),
    scopeDimensionFilter("positionId", employeePositionId),
  ];
}

// De las reglas ya alcanzadas por scope (doubleHourRuleScopeWhere), cuáles
// matchean la fecha calendario de este tramo puntual — mismo criterio de
// fecha para todos los tramos de la jornada, evaluado por separado en cada
// uno (cruce de medianoche: el tramo del día siguiente puede matchear una
// regla que el tramo anterior no).
function matchingDoubleHourRules(rules: DoubleHourRuleForEngine[], segmentDate: Date): DoubleHourRuleForEngine[] {
  const activeDatesByRule = buildActiveDatesByRule(rules);
  return rules.filter((rule) => ruleMatchesDate(rule, segmentDate, activeDatesByRule));
}

// Etapa 11A: carga manual (create()/update()) no corre dentro de la
// transacción con `tx` extendido que usan createFromWorkShift/
// closeOpenWorkShift (ver comentario de doubleHourRuleScopeWhere sobre por
// qué ese `tx` no se puede tipar como función async de nivel superior) — acá
// alcanza con `prisma` directo, que sí tiene un tipo estable. A diferencia
// del fichador, una carga manual no tiene jornada real que partir en tramos:
// no crea TimeSegment ni SpecialHourRuleApplication (no hay a qué tramo
// asociar la trazabilidad), sólo resuelve el multiplicador efectivo para que
// TimeEntry.appliedMultiplier quede correcto — hours/totalMinutes siguen
// siendo siempre minutos reales, igual que en el fichador desde la Etapa 8F.
async function resolveDoubleHourMultiplierForManualEntry(employeeId: string, date: Date): Promise<number> {
  return (await resolveDoubleHourMultipliersByDate(employeeId, [date])).get(calendarDateKey(date)) ?? 1;
}

export type SpecialHourResolution = SpecialHourRuleResolution<DoubleHourRuleForEngine>;

type SpecialHourRuleReader = Pick<PrismaTransactionClient, "employee" | "doubleHourRule" | "holidayWorkAssignment">;

// Motor ÚNICO de Hora Especial por empleado + fecha (docs/decisions/
// WORKED_TIME_ACCOUNTING_MODEL.md §6, §15 y §16). Lo usan la carga manual, los
// desgloses, el fichador (createFromWorkShift/closeOpenWorkShift) y la
// reinterpretación de la historia:
// - reglas ACTIVAS vigentes en la fecha y alcanzadas por el empleado
//   (empresa/sector/centro de costo/puesto/empleados);
// - FERIADO + convocatoria: si la fecha tiene convocados (HolidayWorkAssignment
//   ACTIVA), las reglas FERIADO aplican sólo a ellos
//   (specialHourRulesForEmployeeOnDate);
// - ganadoras por prioridad (resolveWinningRules).
// Siempre 4 consultas (alcance del empleado, reglas en alcance, reglas FERIADO
// y convocatorias del rango) sin importar cuántas fechas — nunca una por
// fecha. Clave = calendarDateKey del @db.Date (mismo criterio UTC-calendario
// que ruleMatchesDate). `db` permite correrlo dentro de la transacción que
// cambia una regla o una convocatoria, para ver su estado nuevo.
export async function resolveSpecialHourRulesByDate(employeeId: string, dates: Date[], db: SpecialHourRuleReader = prisma): Promise<Map<string, SpecialHourResolution>> {
  const result = new Map<string, SpecialHourResolution>();
  if (!dates.length) return result;
  const times = dates.map((date) => date.getTime());
  const from = new Date(Math.min(...times));
  const to = new Date(Math.max(...times));
  const employeeScope = await db.employee.findUnique({
    where: { id: employeeId },
    select: { sectorId: true, costCenterId: true, positionId: true, companies: { select: { companyId: true } } },
  });
  const vigencyWhere = { status: "ACTIVO" as const, fromDate: { lte: to }, OR: [{ toDate: null }, { toDate: { gte: from } }] };
  const [rulesInScope, feriadoRules, convocations] = await Promise.all([
    db.doubleHourRule.findMany({
      where: {
        ...vigencyWhere,
        AND: doubleHourRuleScopeWhere(employeeId, employeeScope?.companies.map((item) => item.companyId) ?? [], employeeScope?.sectorId, employeeScope?.costCenterId, employeeScope?.positionId),
      },
      include: { dates: true },
    }),
    // Sin filtro de alcance: con convocatoria, el convocado queda alcanzado
    // aunque la regla FERIADO tenga otro alcance.
    db.doubleHourRule.findMany({ where: { ...vigencyWhere, kind: "FERIADO" }, include: { dates: true } }),
    db.holidayWorkAssignment.findMany({ where: { status: "ACTIVA", date: { gte: from, lte: to } }, select: { date: true, employeeId: true } }),
  ]);
  const convokedByDate = new Map<string, Set<string>>();
  for (const convocation of convocations) {
    const key = calendarDateKey(convocation.date);
    convokedByDate.set(key, (convokedByDate.get(key) ?? new Set<string>()).add(convocation.employeeId));
  }
  const isVigent = (rule: DoubleHourRuleForEngine, date: Date) => rule.fromDate <= date && (!rule.toDate || rule.toDate >= date);
  for (const date of dates) {
    const key = calendarDateKey(date);
    if (result.has(key)) continue;
    const candidates = specialHourRulesForEmployeeOnDate({
      employeeId,
      rulesInEmployeeScope: rulesInScope.filter((rule) => isVigent(rule, date)),
      feriadoRules: feriadoRules.filter((rule) => isVigent(rule, date)),
      convokedEmployeeIds: convokedByDate.get(key) ?? new Set<string>(),
    });
    const matchedRules = matchingDoubleHourRules(candidates, date);
    const { winners, multiplier, conflicting } = resolveWinningRules(matchedRules);
    result.set(key, { multiplier, matchedRules, winners, conflicting });
  }
  return result;
}

// Sólo el multiplicador: carga manual de horas y desgloses (manual/automáticos).
export async function resolveDoubleHourMultipliersByDate(employeeId: string, dates: Date[], db?: SpecialHourRuleReader): Promise<Map<string, number>> {
  const resolutions = await resolveSpecialHourRulesByDate(employeeId, dates, db);
  return new Map(Array.from(resolutions, ([key, resolution]) => [key, resolution.multiplier]));
}

function employeeSearchWhere(search?: string): Prisma.EmployeeWhereInput {
  const trimmed = search?.trim();
  if (!trimmed) return {};
  return {
    OR: [
      { legajo: { contains: trimmed, mode: "insensitive" } },
      { legajoFinnegans: { contains: trimmed, mode: "insensitive" } },
      { cuil: { contains: trimmed, mode: "insensitive" } },
      { dni: { contains: trimmed, mode: "insensitive" } },
      { firstName: { contains: trimmed, mode: "insensitive" } },
      { lastName: { contains: trimmed, mode: "insensitive" } },
    ],
  };
}

function buildWhere(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.TimeEntryWhereInput {
  return {
    employee: {
      AND: [
        employeeAccessWhere,
        {
          ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
          ...employeeSearchWhere(query.search),
        },
      ],
    },
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.hourConceptId ? { hourConceptId: query.hourConceptId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.period ? { period: query.period } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
}

function buildReviewByEmployeeWhere(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput {
  return {
    AND: [
      employeeAccessWhere,
      {
        ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
        ...employeeSearchWhere(query.search),
        timeEntries: {
          some: {
            ...(query.status ? { status: query.status } : {}),
            ...(query.period ? { period: query.period } : {}),
          },
        },
      },
    ],
  };
}

// Etapa 14G.7: `prisma.$transaction(async (tx) => {...})` (forma
// interactiva) -> queries planas sobre el cliente `prisma` global. Mismo
// antipatrón ya corregido 5 veces en esta serie (14C.2/14G.2/14G.3/14G.5/
// 14G.6), documentado 2 veces sin corregir (14G.1 §15, 14G.5 §14): una
// transacción interactiva usa una única conexión, así que el `Promise.all`
// de `tx.*` de acá adentro no lograba concurrencia real (mismo hallazgo que
// `findPeriodEmployees` tenía antes de 14C.2). Las 4 lecturas (employee
// findMany+count, luego timeEntry+hourConceptBreakdown) son de sólo lectura
// e independientes entre sí dentro de cada etapa — sin necesidad de una foto
// transaccional consistente para una lista operativa que se refresca sola.
// Mismos `where`/`select`/`orderBy`/`skip`/`take` exactos, misma lógica de
// agregación en memoria (sin cambios).
async function findManyByEmployeeGrouped(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
  const employeeWhere = buildReviewByEmployeeWhere(query, employeeAccessWhere);
  const skip = (query.page - 1) * query.take;

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where: employeeWhere,
      select: periodEmployeeSelect,
      orderBy: resolveOrderBy({ sortBy: isEmployeeRowSortKey(query.sortBy) ? query.sortBy : undefined, sortOrder: query.sortOrder }, employeeRowOrderBy, employeeRowDefaultOrderBy, { id: "asc" }),
      skip,
      take: query.take,
    }),
    prisma.employee.count({ where: employeeWhere }),
  ]);

  const employeeIds = employees.map((employee) => employee.id);
  const [entries, breakdowns] = employeeIds.length
    ? await Promise.all([
        prisma.timeEntry.findMany({
          where: {
            employeeId: { in: employeeIds },
            ...(query.status ? { status: query.status } : {}),
            ...(query.period ? { period: query.period } : {}),
            // Horas base (NORMAL_BASE) — los conceptos viven en
            // HourConceptBreakdown y se contabilizan aparte (abajo).
            hourConcept: { systemRole: "NORMAL_BASE" },
          },
          select: {
            ...accountingBaseEntrySelect,
            timeSegment: {
              select: {
                specialHourRuleApplications: {
                  where: { isWinner: true },
                  select: { wasConflicting: true, doubleHourRule: { select: { name: true } } },
                },
              },
            },
          },
        }),
        query.period
          ? prisma.hourConceptBreakdown.findMany({
              where: { employeeId: { in: employeeIds }, period: query.period, status: countedBreakdownStatusWhere },
              select: accountingBreakdownSelect,
            })
          : Promise.resolve([]),
      ])
    : [[], []];

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: total trabajado = base +
  // conceptos adicionales (nunca + dentro de la jornada); la equivalencia
  // para liquidación sale de las categorías ya sin duplicar. Mismos filtros
  // de estado que antes (TimeEntry según query.status, desgloses sin
  // RECHAZADO).
  const accountingByEmployee = accountEmployeePeriods(entries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown));
  const ruleNamesByEmployee = new Map<string, Set<string>>();
  const conflictByEmployee = new Set<string>();
  for (const entry of entries) {
    if (Number(entry.appliedMultiplier ?? 1) <= 1) continue;
    const ruleNames = ruleNamesByEmployee.get(entry.employeeId) || new Set<string>();
    for (const application of entry.timeSegment?.specialHourRuleApplications ?? []) {
      ruleNames.add(application.doubleHourRule.name);
      if (application.wasConflicting) conflictByEmployee.add(entry.employeeId);
    }
    ruleNamesByEmployee.set(entry.employeeId, ruleNames);
  }

  const items = employees.map((employee) => {
    const { days: _days, ...accounting } = accountingByEmployee.get(employee.id) ?? emptyPeriodAccounting();
    return {
      employee,
      summary: {
        status: query.status || ApprovalStatus.EN_REVISION,
        accounting,
        specialHourRuleNames: Array.from(ruleNamesByEmployee.get(employee.id) || []),
        specialHourConflict: conflictByEmployee.has(employee.id),
      },
    };
  });

  return [items, total] as const;
}

function buildPeriodEmployeeWhere(query: TimeEntriesPeriodEmployeesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput {
  return {
    AND: [
      employeeAccessWhere,
      {
        status: EmployeeStatus.ACTIVO,
        ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
        ...employeeSearchWhere(query.search),
      },
    ],
  };
}

function resolvePeriodStatus(statuses: string[]) {
  return statusPriority.find((status) => statuses.includes(status)) || "PENDIENTE";
}

export const timeEntriesRepository = {
  createClockPunchAttempt(input: { requestId: string; employeeId: string; deviceId: string; punchType: "INGRESO" | "SALIDA"; requestHash: string }) {
    return prisma.clockPunchAttempt.create({ data: input });
  },

  findClockPunchAttempt(requestId: string) {
    return prisma.clockPunchAttempt.findUnique({ where: { requestId } });
  },

  completeClockPunchAttempt(requestId: string, response: Prisma.InputJsonValue) {
    return prisma.clockPunchAttempt.update({
      where: { requestId },
      data: { status: "COMPLETED", response, completedAt: new Date(), errorCode: null, errorMessage: null, httpStatus: 200 },
    });
  },

  failClockPunchAttempt(requestId: string, error: { code: string; message: string; httpStatus: number }) {
    return prisma.clockPunchAttempt.update({
      where: { requestId },
      data: { status: "FAILED", errorCode: error.code, errorMessage: error.message, httpStatus: error.httpStatus, completedAt: new Date() },
    });
  },

  expireClockPunchAttempts(processingBefore: Date) {
    return prisma.clockPunchAttempt.updateMany({
      where: { status: "PROCESSING", startedAt: { lt: processingBefore } },
      data: {
        status: "FAILED",
        errorCode: "CLOCK_ATTEMPT_TIMEOUT",
        errorMessage: "La fichada excedió el tiempo máximo de procesamiento.",
        httpStatus: 503,
        completedAt: new Date(),
      },
    });
  },

  deleteClockPunchAttempts(completedBefore: Date) {
    return prisma.clockPunchAttempt.deleteMany({
      where: { status: { in: ["COMPLETED", "FAILED"] }, completedAt: { lt: completedBefore } },
    });
  },

  // Etapa 14G.7: `prisma.$transaction([...])` (forma array) -> `Promise.all([...])`
  // sobre el cliente `prisma` global. Mismo antipatrón que
  // `findManyByEmployeeGrouped` de arriba, encontrado en el mismo repositorio
  // durante el mismo diagnóstico -- gobierna el mismo endpoint (`GET
  // /time-entries`) del que depende la vista "Por registro" de la Bandeja de
  // revisión (`view=flat`, el default). Las 2 queries son de sólo lectura e
  // independientes (un listado + su count total), sin necesidad de una foto
  // transaccional consistente entre sí. Mismos `where`/`include`/`orderBy`/
  // `skip`/`take` exactos.
  findMany(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    if (query.view === "byEmployee") return findManyByEmployeeGrouped(query, employeeAccessWhere);
    const where = buildWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    return Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: timeEntryInclude,
        orderBy: resolveOrderBy(query, timeEntryListOrderBy, [{ date: "desc" }, { employee: { lastName: "asc" } }], { id: "asc" }),
        skip,
        take: query.take,
      }),
      prisma.timeEntry.count({ where }),
    ]);
  },

  // Etapa 14C.2: `$transaction([...])` -> `Promise.all([...])`. Mismo criterio
  // que `findPeriodEmployees` y que `employees.summary()` (Etapa 14C.1): 5
  // conteos/agregados independientes de sólo lectura para tarjetas de
  // resumen, sin necesidad de una foto transaccional consistente entre sí —
  // la forma-array de `$transaction` los ejecutaba secuencialmente sobre una
  // única conexión.
  async summary(period: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const countableStatuses = [ApprovalStatus.APROBADO, ApprovalStatus.EN_REVISION];
    const [activeEmployees, employeesWithEntries, pendingEmployees, reviewEmployeeGroups, hoursResult, additiveResult] = await Promise.all([
      prisma.employee.count({
        where: { ...employeeAccessWhere, status: EmployeeStatus.ACTIVO },
      }),
      prisma.employee.count({
        where: {
          ...employeeAccessWhere,
          status: EmployeeStatus.ACTIVO,
          timeEntries: {
            some: {
              period,
              status: { in: countableStatuses },
            },
          },
        },
      }),
      prisma.employee.count({
        where: {
          ...employeeAccessWhere,
          status: EmployeeStatus.ACTIVO,
          timeEntries: {
            none: {
              period,
              status: { in: countableStatuses },
            },
          },
        },
      }),
      prisma.timeEntry.groupBy({
        by: ["employeeId"],
        orderBy: { employeeId: "asc" },
        where: {
          period,
          employee: employeeAccessWhere,
          status: ApprovalStatus.EN_REVISION,
        },
      }),
      prisma.timeEntry.aggregate({
        where: {
          period,
          employee: employeeAccessWhere,
          status: { in: countableStatuses },
          // Horas base (NORMAL_BASE). Los conceptos se suman abajo sólo si
          // son ADDITIVE_TO_WORKED_TOTAL (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
          hourConcept: { systemRole: "NORMAL_BASE" },
        },
        _sum: { hours: true },
      }),
      prisma.hourConceptBreakdown.aggregate({
        where: {
          period,
          employee: employeeAccessWhere,
          status: countedBreakdownStatusWhere,
          hourConcept: { workTreatment: "ADDITIVE_TO_WORKED_TOTAL" },
        },
        _sum: { minutes: true },
      }),
    ]);

    // Total trabajado = base + adicionales (nunca + conceptos dentro de la
    // jornada) — mismo criterio que accountDay, sin re-leer día por día.
    const countableHours = totalWorkedHours(Number(hoursResult._sum.hours?.toString() || 0), additiveResult._sum.minutes ?? 0);

    return {
      activeEmployees,
      employeesWithEntries,
      pendingEmployees,
      reviewEmployees: reviewEmployeeGroups.length,
      countableHours,
      coverage: activeEmployees ? Math.round((employeesWithEntries / activeEmployees) * 100) : 0,
    };
  },

  // Etapa 14G.2: mismo criterio que `findPeriodEmployees` (14C.2, ver
  // comentario abajo) — estos 3 counts son de sólo lectura e independientes
  // entre sí, así que envolverlos en `prisma.$transaction([...])` (array-
  // form) sólo fuerza que corran uno detrás del otro sobre una única
  // conexión, sin ninguna ganancia de atomicidad real (nadie necesita ver
  // los 3 counts como una foto consistente de un mismo instante — es un
  // contador de "para hacer hoy", se refresca solo en el próximo request).
  // Medido en 6246ms en el journey real (ver
  // docs/decisions/WORKFORCE_MANAGEMENT_HOME_SUMMARY_PERFORMANCE_14G2.md).
  async homeCounts(period: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const [sinCargar, devueltos, enRevision] = await Promise.all([
      prisma.employee.count({
        where: {
          ...employeeAccessWhere,
          status: EmployeeStatus.ACTIVO,
          timeEntries: { none: { period } },
        },
      }),
      prisma.timeEntry.count({
        where: { period, employee: employeeAccessWhere, status: ApprovalStatus.DEVUELTO },
      }),
      prisma.timeEntry.count({
        where: { period, employee: employeeAccessWhere, status: ApprovalStatus.EN_REVISION },
      }),
    ]);

    return { sinCargar, devueltos, enRevision };
  },

  pendingNoveltiesCount(employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.novelty.count({
      where: {
        employee: employeeAccessWhere,
        status: { in: [ApprovalStatus.PENDIENTE, ApprovalStatus.EN_REVISION] },
      },
    });
  },

  // Etapa 14G.2: mismo criterio que `homeCounts` arriba — 3 counts de sólo
  // lectura e independientes, sin necesidad de atomicidad transaccional.
  async attendanceObservedCount(input: { startAt: Date; endAt: Date; employeeAccessWhere: Prisma.EmployeeWhereInput }) {
    const operationalDate = argentinaCalendarDate(argentinaDateKey(input.startAt));
    const [observedShifts, observedPunches, inactivityIncidents] = await Promise.all([
      prisma.workShift.count({
        where: {
          employee: input.employeeAccessWhere,
          startAt: { lt: input.endAt },
          OR: [{ endAt: null }, { endAt: { gte: input.startAt } }],
          status: { in: [WorkShiftStatus.OBSERVADO, WorkShiftStatus.FALTA_SALIDA, WorkShiftStatus.FALTA_INGRESO, WorkShiftStatus.INVALIDO] },
          reviewStatus: "PENDIENTE",
        },
      }),
      prisma.attendancePunch.count({
        where: {
          employee: input.employeeAccessWhere,
          status: "OBSERVADA",
          reviewStatus: "PENDIENTE",
          startWorkShifts: { none: {} },
          endWorkShifts: { none: {} },
          timestamp: { gte: input.startAt, lt: input.endAt },
        },
      }),
      prisma.attendanceInactivityIncident.count({
        where: { employee: input.employeeAccessWhere, operationalDate, status: "PENDIENTE" },
      }),
    ]);

    return observedShifts + observedPunches + inactivityIncidents;
  },

  // Etapa 14C.2: antes, las 5 queries de abajo corrían dentro de un único
  // `prisma.$transaction(async (tx) => {...}, { timeout: 15_000 })`. Al ser
  // read-only (sin ningún create/update/delete), no necesitan atomicidad de
  // escritura — pero una transacción interactiva usa una única conexión, así
  // que el `Promise.all` de `tx.*` no lograba concurrencia real (el driver
  // serializa los round-trips sobre esa conexión). Medido en 6447ms en el
  // journey real (ver docs/decisions/TIME_ENTRIES_PERFORMANCE_14C2.md).
  // Sacar el `$transaction` y usar el cliente `prisma` global (pool de
  // conexiones) para los mismos dos `Promise.all` sí da concurrencia real —
  // mismo patrón ya aplicado en `employees.summary()` (Etapa 14C.1) y en
  // `dashboard.service.ts`. El pequeño riesgo de consistencia entre-queries
  // (aceptado con el mismo criterio que esos dos casos) es irrelevante para
  // una grilla operativa ya cacheada 20s.
  async findPeriodEmployees(query: TimeEntriesPeriodEmployeesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildPeriodEmployeeWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    const { start, end } = periodRange(query.period);

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        select: periodEmployeeSelect,
        orderBy: resolveOrderBy(query, employeeRowOrderBy, employeeRowDefaultOrderBy, { id: "asc" }),
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);

    const employeeIds = employees.map((employee) => employee.id);
    const [entries, breakdowns, novelties] = await Promise.all([
      employeeIds.length
        ? prisma.timeEntry.findMany({
            where: {
              period: query.period,
              employeeId: { in: employeeIds },
            },
            select: {
              ...accountingBaseEntrySelect,
              status: true,
              hourConcept: { select: { systemRole: true } },
              workShift: { select: { status: true } },
              // Etapa 11A: nombre de la/las regla(s) ganadora(s) para el
              // indicador de la grilla — sólo existe para entradas del
              // fichador (timeSegmentId no nulo); una carga manual queda
              // con appliedMultiplier correcto pero sin este detalle (ver
              // docs/decisions/HOURS_GRID_REVIEW_SPECIAL_HOURS_AUDIT_11A.md).
              timeSegment: {
                select: {
                  specialHourRuleApplications: {
                    where: { isWinner: true },
                    select: { wasConflicting: true, doubleHourRule: { select: { name: true } } },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
      // Conceptos (MANUAL o AUTOMATIC, sin RECHAZADO — criterio vigente
      // desde 6M). Si suman o no al total lo decide workTreatment dentro de
      // workedTimeAccounting, no este repositorio.
      employeeIds.length
        ? prisma.hourConceptBreakdown.findMany({
            where: {
              period: query.period,
              employeeId: { in: employeeIds },
              status: countedBreakdownStatusWhere,
            },
            select: accountingBreakdownSelect,
          })
        : Promise.resolve([]),
      employeeIds.length
        ? prisma.novelty.findMany({
            where: {
              employeeId: { in: employeeIds },
              status: { not: "RECHAZADO" },
              fromDate: { lt: end },
              OR: [{ toDate: null }, { toDate: { gte: start } }],
            },
            select: {
              employeeId: true,
              fromDate: true,
              toDate: true,
              // Etapa 15L.2C: allowsDateRange reemplaza allowsDateTo como
              // fuente productiva -- ver noveltyCoversDay.
              noveltyType: { select: { name: true, allowsDateRange: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: Horas base = TimeEntry
    // NORMAL_BASE APROBADO/EN_REVISION (criterio vigente desde 6M; un
    // TimeEntry no-Normal legacy previo a 6L queda fuera). Todo lo demás
    // (residual, total, equivalencia) lo deriva workedTimeAccounting.
    const isCountedBase = (entry: (typeof entries)[number]) =>
      entry.hourConcept.systemRole === "NORMAL_BASE"
      && (entry.status === ApprovalStatus.APROBADO || entry.status === ApprovalStatus.EN_REVISION);
    const countedBaseEntries = entries.filter(isCountedBase);
    const accountingByEmployee = accountEmployeePeriods(countedBaseEntries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown));

    const metaByEmployee = new Map<string, { incidents: number; statuses: string[] }>();
    // Nombre de la/las regla(s) ganadora(s) por día (sólo fichador: una carga
    // manual tiene appliedMultiplier pero no TimeSegment) — sólo para el
    // indicador de la grilla, nunca para calcular.
    const rulesByEmployeeDay = new Map<string, Map<number, { names: string[]; conflict: boolean }>>();
    for (const entry of entries) {
      const meta = metaByEmployee.get(entry.employeeId) || { incidents: 0, statuses: [] };
      if (entry.workShift && ["FALTA_SALIDA", "FALTA_INGRESO", "OBSERVADO", "INVALIDO"].includes(entry.workShift.status)) meta.incidents += 1;
      meta.statuses.push(entry.status);
      metaByEmployee.set(entry.employeeId, meta);
      if (!isCountedBase(entry) || Number(entry.appliedMultiplier ?? 1) <= 1) continue;
      const dayMap = rulesByEmployeeDay.get(entry.employeeId) || new Map<number, { names: string[]; conflict: boolean }>();
      const dayRules = dayMap.get(entry.day) || { names: [], conflict: false };
      for (const application of entry.timeSegment?.specialHourRuleApplications ?? []) {
        if (!dayRules.names.includes(application.doubleHourRule.name)) dayRules.names.push(application.doubleHourRule.name);
        if (application.wasConflicting) dayRules.conflict = true;
      }
      dayMap.set(entry.day, dayRules);
      rulesByEmployeeDay.set(entry.employeeId, dayMap);
    }

    const noveltiesByEmployee = new Map<string, typeof novelties>();
    for (const novelty of novelties) {
      const list = noveltiesByEmployee.get(novelty.employeeId) || [];
      list.push(novelty);
      noveltiesByEmployee.set(novelty.employeeId, list);
    }
    const dayCount = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();

    return {
      items: employees.map((employee) => {
        const accounting = accountingByEmployee.get(employee.id) ?? emptyPeriodAccounting();
        const meta = metaByEmployee.get(employee.id);
        const dayRules = rulesByEmployeeDay.get(employee.id);
        const employeeNovelties = noveltiesByEmployee.get(employee.id) || [];
        // Por día: novedad e indicador de Hora Especial. Las horas del día
        // viven en `accounting.days[day]` (una sola fuente, sin duplicarlas).
        const dailyBreakdown: Array<{
          day: number;
          novelty: { label: string } | null;
          specialHourRuleNames: string[];
          specialHourConflict: boolean;
        }> = [];
        for (let day = 1; day <= dayCount; day++) {
          const dayDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day));
          const coveringNovelties = employeeNovelties.filter((novelty) => noveltyCoversDay(novelty, novelty.noveltyType, dayDate));
          if (!accounting.days[String(day)] && !coveringNovelties.length) continue;
          dailyBreakdown.push({
            day,
            novelty: coveringNovelties.length ? { label: coveringNovelties.map((novelty) => novelty.noveltyType.name).join(", ") } : null,
            specialHourRuleNames: dayRules?.get(day)?.names ?? [],
            specialHourConflict: dayRules?.get(day)?.conflict ?? false,
          });
        }
        return {
          employee,
          summary: {
            incidents: meta?.incidents || 0,
            status: resolvePeriodStatus(meta?.statuses || []),
            accounting,
            dailyBreakdown,
          },
        };
      }),
      total,
    };
  },

  findForExport(query: TimeEntriesExportQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.findMany({
      where: {
        employee: employeeAccessWhere,
        period: query.period,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        status: query.includeInReview ? { in: ["APROBADO", "EN_REVISION"] } : "APROBADO",
      },
      include: {
        employee: { include: exportEmployeeInclude },
        hourConcept: true,
        // Etapa 8F: appliedMultiplier ya viene por default (sin select
        // restrictivo acá), pero el nombre de la regla que lo generó sólo
        // sale de acá — es lo único que permite mostrar "equivalente
        // liquidable" y "regla aplicada" en el export sin volver a inflar
        // hours/totalMinutes (que desde esta etapa son siempre reales).
        // Etapa 11B: se agrega `where: { isWinner: true }` — antes faltaba
        // (a diferencia de findPeriodEmployees, que ya lo filtraba desde
        // 11A) y el export podía listar reglas que NO ganaron el conflicto
        // junto a la ganadora en "Reglas de horas especiales aplicadas".
        // `wasConflicting` se agrega para poder señalarlo en esa misma columna.
        timeSegment: {
          select: {
            specialHourRuleApplications: {
              where: { isWinner: true },
              select: { wasConflicting: true, doubleHourRule: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { date: "asc" }],
      take: 5000,
    });
  },

  // Etapa 15E.2 (docs/decisions/TIME_EXPORT_CLOSURE_GATE_15E2.md): estado de
  // MonthlyTimeClosure de cada empleado que va a aparecer en el export, para
  // exigir APROBADO antes de la exportación definitiva. employeeIds ya llega
  // scopeado (sale de findForExport, que ya aplicó employeeAccessWhere), así
  // que no repite el scope acá.
  findClosuresForExport(employeeIds: string[], period: string) {
    if (!employeeIds.length) return Promise.resolve([]);
    return prisma.monthlyTimeClosure.findMany({
      where: { employeeId: { in: employeeIds }, period },
      select: { employeeId: true, status: true },
    });
  },

  // Conceptos del período para el export (MANUAL o AUTOMATIC, sin
  // RECHAZADO — criterio vigente desde 6M). Se scopea por employeeAccessWhere
  // y no por los empleados de findForExport: una persona con sólo horas
  // adicionales (p. ej. Colectivo sin fichada ese mes) también trabajó y
  // debe exportarse (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
  findBreakdownsForExport(query: TimeEntriesExportQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.hourConceptBreakdown.findMany({
      where: {
        employee: employeeAccessWhere,
        period: query.period,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        status: countedBreakdownStatusWhere,
      },
      select: {
        ...accountingBreakdownSelect,
        status: true,
        hourConcept: { select: { workTreatment: true, name: true, code: true } },
      },
    });
  },

  // Datos de legajo de quienes sólo tienen conceptos en el período (sin
  // ningún TimeEntry exportable) — mismo include que findForExport.
  findEmployeesForExport(employeeIds: string[]) {
    if (!employeeIds.length) return Promise.resolve([]);
    return prisma.employee.findMany({ where: { id: { in: employeeIds } }, include: exportEmployeeInclude });
  },

  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.timeEntry.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: timeEntryInclude,
    });
  },

  // Etapa 14I.4: mismo criterio que `homeCounts`/`attendanceObservedCount`
  // arriba — 2 lecturas independientes sin ninguna escritura, sin necesidad
  // de atomicidad transaccional (ver docs/decisions/
  // ATTENDANCE_SUMMARY_READONLY_TRANSACTION_14I4.md).
  async attendanceSummary(input: { startAt: Date; endAt: Date; employeeAccessWhere: Prisma.EmployeeWhereInput }) {
    const employeeSelect = {
      id: true,
      legajo: true,
      dni: true,
      firstName: true,
      lastName: true,
      status: true,
      sector: { select: { id: true, name: true, code: true } },
      position: { select: { id: true, name: true, code: true } },
    } satisfies Prisma.EmployeeSelect;

    const [workShifts, observedPunches] = await Promise.all([
      prisma.workShift.findMany({
        where: {
          employee: input.employeeAccessWhere,
          startAt: { lt: input.endAt },
          OR: [{ endAt: null }, { endAt: { gte: input.startAt } }],
        },
        select: {
          id: true,
          employeeId: true,
          source: true,
          status: true,
          startAt: true,
          endAt: true,
          totalMinutes: true,
          crossesMidnight: true,
          observation: true,
          reviewStatus: true,
          shiftTemplateId: true,
          shiftTemplate: {
            select: {
              id: true,
              code: true,
              name: true,
              startTime: true,
              endTime: true,
              crossesMidnight: true,
              entryToleranceBeforeMinutes: true,
              entryToleranceAfterMinutes: true,
              exitToleranceBeforeMinutes: true,
              exitToleranceAfterMinutes: true,
              minimumMinutesForCompliance: true,
              maximumInformativeMinutes: true,
              missingOutAlertAfterMinutes: true,
              absoluteOpenShiftLimitMinutes: true,
            },
          },
          employee: { select: employeeSelect },
          startPunch: {
            select: {
              id: true,
              timestamp: true,
              source: true,
              status: true,
              observation: true,
              photoStoragePath: true,
              photoFileId: true,
              thumbnailFileId: true,
              photoUrl: true,
              faceDetected: true,
              faceValidationStatus: true,
              faceDetectionScore: true,
            },
          },
          endPunch: {
            select: {
              id: true,
              timestamp: true,
              source: true,
              status: true,
              observation: true,
              photoStoragePath: true,
              photoFileId: true,
              thumbnailFileId: true,
              photoUrl: true,
              faceDetected: true,
              faceValidationStatus: true,
              faceDetectionScore: true,
            },
          },
          timeSegments: {
            select: attendanceTimeSegmentSelect,
            orderBy: { fromDateTime: "asc" },
          },
          timeEntries: {
            select: attendanceTimeEntrySelect,
            orderBy: { date: "asc" },
          },
        },
        orderBy: [{ status: "asc" }, { startAt: "desc" }],
      }),
      prisma.attendancePunch.findMany({
        where: {
          employee: input.employeeAccessWhere,
          status: "OBSERVADA",
          reviewStatus: "PENDIENTE",
          startWorkShifts: { none: {} },
          endWorkShifts: { none: {} },
          timestamp: { gte: input.startAt, lt: input.endAt },
        },
        select: {
          id: true,
          employeeId: true,
          type: true,
          timestamp: true,
          source: true,
          status: true,
          observation: true,
          photoStoragePath: true,
          photoFileId: true,
          thumbnailFileId: true,
          photoUrl: true,
          faceDetected: true,
          faceValidationStatus: true,
          faceDetectionScore: true,
          employee: { select: employeeSelect },
        },
        orderBy: { timestamp: "desc" },
      }),
    ]);

    return { workShifts, observedPunches };
  },

  async attendanceObservations(input: {
    startAt?: Date;
    endAt?: Date;
    before?: Date;
    search?: string;
    operationalDate?: Date;
    type: "ALL" | "SHIFT" | "PUNCH" | "INACTIVITY";
    reviewStatus: "PENDIENTE" | "RESUELTA" | "DESCARTADA" | "ALL";
    take: number;
    employeeAccessWhere: Prisma.EmployeeWhereInput;
  }) {
    const employeeWhere: Prisma.EmployeeWhereInput = {
      AND: [
        input.employeeAccessWhere,
        ...(input.search ? [{ OR: [
          { firstName: { contains: input.search, mode: "insensitive" as const } },
          { lastName: { contains: input.search, mode: "insensitive" as const } },
          { legajo: { contains: input.search, mode: "insensitive" as const } },
          { dni: { contains: input.search, mode: "insensitive" as const } },
          { sector: { name: { contains: input.search, mode: "insensitive" as const } } },
        ] }] : []),
      ],
    };
    const reviewWhere = input.reviewStatus === "ALL" ? {} : { reviewStatus: input.reviewStatus };
    const employeeSelect = {
      id: true, legajo: true, dni: true, firstName: true, lastName: true, status: true,
      sector: { select: { id: true, name: true, code: true } },
      position: { select: { id: true, name: true, code: true } },
    } satisfies Prisma.EmployeeSelect;
    const shiftTotalWhere: Prisma.WorkShiftWhereInput = {
      employee: employeeWhere,
      status: { in: ["OBSERVADO", "FALTA_SALIDA", "FALTA_INGRESO", "INVALIDO"] },
      ...reviewWhere,
      ...(input.startAt && input.endAt ? { startAt: { gte: input.startAt, lt: input.endAt } } : {}),
    };
    const shiftWhere: Prisma.WorkShiftWhereInput = {
      ...shiftTotalWhere,
      ...(input.before ? { startAt: { ...(input.startAt ? { gte: input.startAt } : {}), lt: input.before } } : {}),
    };
    const punchTotalWhere: Prisma.AttendancePunchWhereInput = {
      employee: employeeWhere,
      status: { in: ["OBSERVADA", "RECHAZADA"] },
      startWorkShifts: { none: {} },
      endWorkShifts: { none: {} },
      ...reviewWhere,
      ...(input.startAt && input.endAt ? { timestamp: { gte: input.startAt, lt: input.endAt } } : {}),
    };
    const punchWhere: Prisma.AttendancePunchWhereInput = {
      ...punchTotalWhere,
      ...(input.before ? { timestamp: { ...(input.startAt ? { gte: input.startAt } : {}), lt: input.before } } : {}),
    };
    const includeShifts = input.type !== "PUNCH";
    const includePunches = input.type !== "SHIFT" && input.type !== "INACTIVITY";
    const includeActualShifts = includeShifts && input.type !== "INACTIVITY";
    const includeInactivity = input.type === "ALL" || input.type === "INACTIVITY";
    const inactivityWhere: Prisma.AttendanceInactivityIncidentWhereInput = {
      employee: employeeWhere,
      ...(input.reviewStatus === "ALL" ? {} : { status: input.reviewStatus }),
      ...(input.operationalDate ? { operationalDate: input.operationalDate } : {}),
      ...(input.before ? { detectedAt: { lt: input.before } } : {}),
    };
    const inactivityTotalWhere = { ...inactivityWhere, ...(input.before ? { detectedAt: undefined } : {}) };
    // Etapa 14G.3: antes, las 6 queries de abajo corrían dentro de un
    // `prisma.$transaction([...])` (forma array) — mismo antipatrón ya
    // corregido en 14C.2/14G.2 (una transacción interactiva serializa cada
    // round-trip sobre una única conexión, sin ninguna ganancia real para 6
    // lecturas independientes). Medido en 4681ms en el journey real (ver
    // docs/decisions/WORKFORCE_MANAGEMENT_ATTENDANCE_OBSERVATIONS_PERFORMANCE_14G3.md).
    //
    // Además, cuando `type` filtra a una sola categoría, antes se seguían
    // disparando las 4 queries "dummy" (`where: { id: "__none__" }`) de las
    // categorías excluidas — sólo para mantener el mismo tipo/forma dentro
    // del array de la transacción. Cada una era un round-trip real a Neon
    // que siempre devolvía vacío/0. Ahora se saltean del todo cuando la
    // categoría no aplica (`Promise.resolve([]/0)` local, sin ir a la
    // base) — el resultado es idéntico (antes: dummy query → []/0; ahora:
    // []/0 sin ida y vuelta), pero con menos round-trips cuando `type` no
    // es "ALL".
    const findShifts = () => prisma.workShift.findMany({
      where: shiftWhere,
      include: {
        employee: { select: employeeSelect },
        startPunch: true,
        endPunch: true,
        timeSegments: { select: attendanceTimeSegmentSelect, orderBy: { fromDateTime: "asc" } },
        timeEntries: { select: attendanceTimeEntrySelect, orderBy: { date: "asc" } },
      },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
      take: input.take + 1,
    });
    const findPunches = () => prisma.attendancePunch.findMany({
      where: punchWhere,
      include: { employee: { select: employeeSelect } },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: input.take + 1,
    });
    const findInactivity = () => prisma.attendanceInactivityIncident.findMany({
      where: inactivityWhere,
      include: { employee: { select: employeeSelect } },
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      take: input.take + 1,
    });

    const [shifts, punches, inactivity, shiftTotal, punchTotal, inactivityTotal] = await Promise.all([
      includeActualShifts ? findShifts() : Promise.resolve([] as Awaited<ReturnType<typeof findShifts>>),
      includePunches ? findPunches() : Promise.resolve([] as Awaited<ReturnType<typeof findPunches>>),
      includeInactivity ? findInactivity() : Promise.resolve([] as Awaited<ReturnType<typeof findInactivity>>),
      includeActualShifts ? prisma.workShift.count({ where: shiftTotalWhere }) : Promise.resolve(0),
      includePunches ? prisma.attendancePunch.count({ where: punchTotalWhere }) : Promise.resolve(0),
      includeInactivity ? prisma.attendanceInactivityIncident.count({ where: inactivityTotalWhere }) : Promise.resolve(0),
    ]);
    const items = [
      ...shifts.map((shift) => ({ kind: "SHIFT" as const, occurredAt: shift.startAt, shift })),
      ...punches.map((punch) => ({ kind: "PUNCH" as const, occurredAt: punch.timestamp, punch })),
      ...inactivity.map((incident) => ({ kind: "INACTIVITY" as const, occurredAt: incident.detectedAt, incident })),
    ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()).slice(0, input.take);
    return {
      items,
      total: shiftTotal + punchTotal + inactivityTotal,
      hasMore: shifts.length + punches.length + inactivity.length > items.length,
      nextBefore: items.length ? items[items.length - 1]!.occurredAt : null,
    };
  },

  resolveAttendanceObservation(kind: "SHIFT" | "PUNCH" | "INACTIVITY", id: string, resolution: "RESUELTA" | "DESCARTADA", reason: string, userId: string) {
    const data = { reviewStatus: resolution, reviewNote: reason, reviewedAt: new Date(), reviewedByUserId: userId };
    if (kind === "SHIFT") return prisma.workShift.update({ where: { id }, data });
    if (kind === "PUNCH") return prisma.attendancePunch.update({ where: { id }, data });
    return prisma.attendanceInactivityIncident.update({ where: { id }, data: { status: resolution, reviewNote: reason, reviewedAt: new Date(), reviewedByUserId: userId } });
  },

  findAttendanceObservation(kind: "SHIFT" | "PUNCH" | "INACTIVITY", id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    if (kind === "SHIFT") return prisma.workShift.findFirst({ where: { id, employee: employeeAccessWhere } });
    if (kind === "PUNCH") return prisma.attendancePunch.findFirst({ where: { id, employee: employeeAccessWhere } });
    return prisma.attendanceInactivityIncident.findFirst({ where: { id, employee: employeeAccessWhere } });
  },

  findWorkShiftForAdmin(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.workShift.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: {
        employee: { select: { id: true, legajo: true, dni: true, firstName: true, lastName: true, status: true } },
        timeEntries: { select: { id: true, status: true } },
      },
    });
  },

  findAttendancePunchEvidence(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.attendancePunch.findFirst({
      where: { id, employee: employeeAccessWhere },
      select: {
        id: true,
        employeeId: true,
        type: true,
        timestamp: true,
        source: true,
        photoUrl: true,
        photoStoragePath: true,
        photoFileId: true,
        thumbnailFileId: true,
        photoFile: {
          select: { id: true, storageProvider: true, storageKey: true, mimeType: true, driveWebViewLink: true, metadata: true },
        },
        employee: { select: { legajo: true, firstName: true, lastName: true } },
      },
    });
  },

  observeWorkShift(id: string, reason: string) {
    return prisma.workShift.update({
      where: { id },
      data: {
        status: "OBSERVADO",
        observation: reason,
      },
      include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } },
    });
  },

  markMissingOut(id: string, reason: string) {
    return prisma.workShift.update({
      where: { id },
      data: {
        status: "FALTA_SALIDA",
        observation: reason,
      },
      include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } },
    });
  },

  findEmployeeForShift(input: { employeeId?: string; dni?: string }, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findFirst({
      where: {
        AND: [
          employeeAccessWhere,
          input.employeeId ? { id: input.employeeId } : { dni: input.dni },
        ],
      },
      select: {
        id: true,
        legajo: true,
        dni: true,
        cuil: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
  },

  searchEmployeesForClock(search: string) {
    const words = search.split(/\s+/).filter(Boolean);
    return prisma.employee.findMany({
      where: {
        status: "ACTIVO",
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          ...(words.length >= 2
            ? [
                {
                  AND: words.map((word) => ({
                    OR: [
                      { firstName: { contains: word, mode: "insensitive" as const } },
                      { lastName: { contains: word, mode: "insensitive" as const } },
                    ],
                  })),
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        legajo: true,
        dni: true,
        firstName: true,
        lastName: true,
        status: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 12,
    });
  },

  findClockValidationContext(employeeId: string) {
    return prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        legajo: true,
        dni: true,
        cuil: true,
        firstName: true,
        lastName: true,
        status: true,
        workShifts: {
          where: { status: WorkShiftStatus.ABIERTO, endAt: null },
          orderBy: { startAt: "desc" },
          take: 1,
          include: { hourConcept: true },
        },
        hourConcepts: {
          // countsAsWorked: legacy del modelo exclusivo anterior (Etapa 6R).
          // Ningún endpoint permite crear/editar un HourConcept con
          // countsAsWorked=false (createHourConceptSchema/updateHourConceptSchema
          // no lo aceptan), así que este filtro es hoy un no-op para todo
          // concepto creado vía API. Se conserva el filtro (en vez de
          // quitarlo) por si existen registros legacy con el valor en false
          // cargados antes de esa restricción; confirmar contra la base
          // antes de eliminarlo.
          where: { hourConcept: { status: "ACTIVO", countsAsWorked: true } },
          include: { hourConcept: true },
        },
      },
    });
  },

  linkClockPunchThumbnail(attendancePunchId: string, thumbnailFileId: string) {
    return prisma.$transaction([
      prisma.attendancePunch.update({ where: { id: attendancePunchId }, data: { thumbnailFileId } }),
      prisma.storageFile.update({ where: { id: thumbnailFileId }, data: { attendancePunchId } }),
    ]);
  },

  async expireOpenWorkShifts(now: Date) {
    const candidates = await prisma.workShift.findMany({
      where: { status: WorkShiftStatus.ABIERTO, endAt: null, startAt: { lt: now } },
      orderBy: { startAt: "asc" },
      take: 100,
      include: { hourConcept: true },
    });
    const overLimit = candidates.filter((shift) => now.getTime() - shift.startAt.getTime() > shift.maxAllowedMinutes * 60_000);

    // Régimen laboral ALERT_ONLY (política de rollover por régimen): una
    // jornada abierta excedida de un empleado en ese régimen nunca se cierra
    // automáticamente acá — se marca para revisión de RRHH con una alerta
    // crítica. Sin régimen vigente o con ROLLOVER, sigue exactamente el
    // comportamiento histórico (cierre automático como FALTA_SALIDA, abajo).
    const regimes = await Promise.all(overLimit.map((shift) => resolveActiveWorkRegime(shift.employeeId, now)));
    const expired: typeof overLimit = [];
    for (const [index, shift] of overLimit.entries()) {
      if (regimes[index]?.openShiftOverflowAction === "ALERT_ONLY") {
        const minutesOpen = Math.round((now.getTime() - shift.startAt.getTime()) / 60_000);
        await flagOpenShiftOverflowForReview(shift.employeeId, shift.id, minutesOpen, now);
      } else {
        expired.push(shift);
      }
    }

    const resolvedConcepts = await Promise.all(
      expired.map((shift) =>
        shift.hourConcept
          ? Promise.resolve(shift.hourConcept)
          : prisma.employeeHourConcept
              .findFirst({
                where: { employeeId: shift.employeeId, hourConcept: { kind: "NORMAL", status: "ACTIVO" } },
                include: { hourConcept: true },
              })
              .then((row) => row?.hourConcept ?? null),
      ),
    );

    const observation = "0 h — Falta registrar la salida. La jornada venció y requiere revisión del encargado.";
    let count = 0;
    const items: Array<{ employeeId: string; workShiftId: string; startAt: Date }> = [];

    await prisma.$transaction(async (tx) => {
      for (const [index, shift] of expired.entries()) {
        const concept = resolvedConcepts[index];
        if (!concept) continue;
        const updated = await tx.workShift.updateMany({
          where: { id: shift.id, status: WorkShiftStatus.ABIERTO, endAt: null },
          data: { status: WorkShiftStatus.FALTA_SALIDA, totalMinutes: 0, hourConceptId: concept.id, hourConceptName: concept.name, observation, closedAt: now },
        });
        if (updated.count !== 1) continue;
        await tx.timeEntry.create({
          data: {
            employeeId: shift.employeeId,
            hourConceptId: concept.id,
            workShiftId: shift.id,
            date: shift.startAt,
            period: periodFromInstant(shift.startAt),
            day: dayOfMonthFromInstant(shift.startAt),
            hours: 0,
            totalMinutes: 0,
            status: "APROBADO",
            source: shift.source,
            segmentStartAt: shift.startAt,
            observation,
          },
        });
        count += 1;
        items.push({ employeeId: shift.employeeId, workShiftId: shift.id, startAt: shift.startAt });
      }
    });

    // Etapa 10B: la jornada que recién se auto-cerró en 0h puede tener una
    // alerta POSIBLE_OLVIDO_SALIDA previa (creada por el chequeo de riesgo
    // periódico, ver openShiftMonitor.service.ts) — se resuelve acá para que
    // no quede "pendiente" indefinidamente en /turnos/alertas (ver 10A §11.2).
    // Best-effort: un fallo puntual no debe impedir que el resto del batch de
    // cierre automático se reporte como exitoso.
    for (const item of items) {
      try {
        await resolveOpenShiftOverflowAlert(item.workShiftId, "Resuelta automáticamente: la jornada venció y se cerró sin salida registrada (revisión disponible en Asistencia).");
      } catch (error) {
        console.error("CLOCK_WORK_SHIFT_ALERT_RESOLVE_FAILED", {
          severity: "warning",
          workShiftId: item.workShiftId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { count, items };
  },

  createOpenWorkShift(input: { employeeId: string; hourConceptId?: string; hourConceptName?: string; source: WorkShiftSource; startAt: Date; punchEvidence?: PunchEvidenceInput }) {
    return prisma.$transaction(async (tx) => {
      const punch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "INGRESO",
          timestamp: input.startAt,
          source: input.source,
          ...punchEvidenceData(input.punchEvidence),
        },
      });

      return tx.workShift.create({
        data: {
          employeeId: input.employeeId,
          hourConceptId: input.hourConceptId,
          hourConceptName: input.hourConceptName,
          startPunchId: punch.id,
          source: input.source,
          status: WorkShiftStatus.ABIERTO,
          startAt: input.startAt,
          maxAllowedMinutes: 20 * 60,
        },
      });
    });
  },

  async rolloverExpiredOpenWorkShift(input: { openWorkShiftId: string; employeeId: string; hourConceptId?: string; hourConceptName?: string; source: WorkShiftSource; startAt: Date; missingOutObservation: string; punchEvidence?: PunchEvidenceInput }) {
    const newShift = await prisma.$transaction(async (tx) => {
      const previous = await tx.workShift.findFirst({
        where: { id: input.openWorkShiftId, employeeId: input.employeeId, status: WorkShiftStatus.ABIERTO, endAt: null },
        include: { hourConcept: true },
      });
      const previousConcept = previous?.hourConcept || (await tx.employeeHourConcept.findFirst({
        where: { employeeId: input.employeeId, hourConcept: { kind: "NORMAL", status: "ACTIVO" } },
        include: { hourConcept: true },
      }))?.hourConcept;
      const claimed = await tx.workShift.updateMany({
        where: { id: input.openWorkShiftId, employeeId: input.employeeId, status: WorkShiftStatus.ABIERTO, endAt: null },
        data: {
          status: WorkShiftStatus.FALTA_SALIDA,
          observation: input.missingOutObservation,
        },
      });
      if (claimed.count !== 1) throw new Error("WORK_SHIFT_ALREADY_CLOSED");
      if (previous && previousConcept) {
        await tx.timeEntry.create({
          data: {
            employeeId: input.employeeId,
            hourConceptId: previousConcept.id,
            workShiftId: previous.id,
            date: previous.startAt,
            period: periodFromInstant(previous.startAt),
            day: dayOfMonthFromInstant(previous.startAt),
            hours: 0,
            totalMinutes: 0,
            status: "APROBADO",
            source: previous.source,
            segmentStartAt: previous.startAt,
            observation: `0 h — ${input.missingOutObservation}`,
          },
        });
      }

      const punch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "INGRESO",
          timestamp: input.startAt,
          source: input.source,
          observation: "Ingreso habilitado luego de marcar automaticamente la jornada anterior como olvido de salida.",
          ...punchEvidenceData(input.punchEvidence),
        },
      });

      return tx.workShift.create({
        data: {
          employeeId: input.employeeId,
          hourConceptId: input.hourConceptId,
          hourConceptName: input.hourConceptName,
          startPunchId: punch.id,
          source: input.source,
          status: WorkShiftStatus.ABIERTO,
          startAt: input.startAt,
          maxAllowedMinutes: 20 * 60,
        },
      });
    });

    // Etapa 10B: mismo fix que expireOpenWorkShifts — este camino también
    // cierra la jornada vieja como FALTA_SALIDA sin pasar por
    // evaluateShiftExit, así que una alerta POSIBLE_OLVIDO_SALIDA previa
    // quedaría huérfana si no se resuelve acá explícitamente.
    try {
      await resolveOpenShiftOverflowAlert(input.openWorkShiftId, "Resuelta automáticamente: la jornada quedó marcada como olvido de salida al registrarse un nuevo ingreso.");
    } catch (error) {
      console.error("CLOCK_WORK_SHIFT_ALERT_RESOLVE_FAILED", {
        severity: "warning",
        workShiftId: input.openWorkShiftId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return newShift;
  },

  countEmployeeInScope(employeeId: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: employeeId }, employeeAccessWhere] } });
  },

  async findDefaultHourConcept(employeeId: string, hourConceptId?: string) {
    if (hourConceptId) {
      return prisma.employeeHourConcept.findUnique({
        where: { employeeId_hourConceptId: { employeeId, hourConceptId } },
        include: { hourConcept: true },
      });
    }
    // Etapa 6K: Hora normal es la base universal, no un concepto adicional
    // habilitado por legajo — se resuelve directo por systemRole (único en
    // toda la tabla), igual que ya hace la grilla aditiva (ver
    // employees.repository.ts findTimeGrid), sin exigir un vínculo
    // EmployeeHourConcept por empleado. kind = "NORMAL" es la etiqueta
    // legacy que este lookup reemplaza; podía desalinearse o no alcanzar
    // para identificar la base de forma única.
    const hourConcept = await prisma.hourConcept.findFirst({
      where: { systemRole: "NORMAL_BASE", status: "ACTIVO" },
    });
    return hourConcept ? { hourConcept } : null;
  },

  findEnabledHourConcept(employeeId: string, hourConceptId: string) {
    return prisma.employeeHourConcept.findUnique({
      where: { employeeId_hourConceptId: { employeeId, hourConceptId } },
      include: { hourConcept: true },
    });
  },

  // Carga manual (grilla): Hora normal (systemRole NORMAL_BASE) es la base
  // universal del sistema y nunca vive en EmployeeHourConcept, así que su
  // habilitación no puede resolverse con findEnabledHourConcept — se
  // necesita el concepto en sí para distinguirla de un adicional.
  findHourConceptById(hourConceptId: string) {
    return prisma.hourConcept.findUnique({ where: { id: hourConceptId } });
  },

  findDuplicate(employeeId: string, hourConceptId: string, date: Date, exceptId?: string) {
    return prisma.timeEntry.findFirst({
      where: {
        employeeId,
        hourConceptId,
        date,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
  },

  findLockedTimeEntry(employeeId: string, hourConceptId: string, date: Date) {
    return prisma.timeEntry.findFirst({
      // Una fichada automática APROBADA puede recibir otro tramo del mismo día.
      // Sólo el cierre mensual impide que el fichador modifique el total.
      where: { employeeId, hourConceptId, date, status: ApprovalStatus.CERRADO },
      select: { id: true, status: true },
    });
  },

  // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
  // antes bloqueaba con cualquier novedad `!= RECHAZADO`, incluida una
  // todavía PENDIENTE de aprobación — una novedad sin aprobar no debe poder
  // impedir la carga horaria operativa. Sólo `APROBADO` bloquea. Esto es
  // sólo bloqueo preventivo de carga NUEVA — Novedades nunca modifica un
  // TimeEntry existente (ver el documento citado).
  // Etapa 15L.2C (docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md):
  // migrado a leer únicamente timeEntryBehavior -- antes comparaba un OR
  // entre blocksTimeEntry/setsWorkedHoursToZero/timeImpact=BLOQUEA_CARGA_DIA
  // (los 3 campos legacy, siempre sincronizados en conjunto por
  // noveltyTypes.sync.ts desde la Etapa 15L.2A). timeEntryBehavior es ahora
  // la única fuente de verdad productiva de este bloqueo.
  findBlockingNovelty(employeeId: string, date: Date) {
    return prisma.novelty.findFirst({
      where: {
        employeeId,
        status: "APROBADO",
        fromDate: { lte: date },
        OR: [{ toDate: null }, { toDate: { gte: date } }],
        noveltyType: { timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" },
      },
      include: { noveltyType: { select: { code: true, name: true } } },
    });
  },

  findOverlappingWorkShift(employeeId: string, startAt: Date, endAt: Date) {
    return prisma.workShift.findFirst({
      where: {
        employeeId,
        status: { not: "ANULADO" },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true, startAt: true, endAt: true },
    });
  },

  // autoApprovedByUserId != null => quien carga (RRHH, Etapa 6L.3) aplica la
  // hora directo en APROBADO, sin pasar por BORRADOR/EN_REVISION.
  async create(input: CreateTimeEntryInput, createdByUserId?: string | null, autoApprovedByUserId?: string | null) {
    // Etapa 11A: antes de esta etapa, la carga manual nunca consultaba
    // DoubleHourRule — un feriado/domingo x2 configurado no tenía ningún
    // efecto si la hora se cargaba a mano en vez de por fichador. hours/
    // totalMinutes siguen siendo siempre minutos reales (nunca se inflan);
    // sólo appliedMultiplier queda correcto para que el equivalente
    // liquidable se derive bien en grilla/export, igual que ya pasaba con el
    // fichador desde la Etapa 8F.
    const appliedMultiplier = await resolveDoubleHourMultiplierForManualEntry(input.employeeId, input.date);
    return prisma.timeEntry.create({
      data: {
        employeeId: input.employeeId,
        hourConceptId: input.hourConceptId,
        date: input.date,
        period: periodFromCalendarDate(input.date),
        day: dayOfMonthFromCalendarDate(input.date),
        hours: input.hours,
        totalMinutes: minutesFromHours(input.hours),
        appliedMultiplier,
        status: autoApprovedByUserId ? "APROBADO" : "BORRADOR",
        observation: input.observation || null,
        createdByUserId: createdByUserId || null,
        ...(autoApprovedByUserId ? { approvedByUserId: autoApprovedByUserId, approvedAt: new Date() } : {}),
      },
      include: timeEntryInclude,
    });
  },

  createFromWorkShift(input: {
    employeeId: string;
    // Etapa 6L: ya no es "el concepto elegido para la jornada" — es la Hora
    // normal canónica (systemRole NORMAL_BASE), resuelta por el servicio
    // (resolveShiftConcept sin id). El clasificador legacy sigue partiendo
    // `segments` por HourConceptRule/priority para TimeSegment (evidencia
    // técnica), pero el TimeEntry que representa el trabajo real siempre usa
    // este valor, nunca segment.hourConceptId.
    normalHourConceptId: string;
    normalHourConceptName: string;
    source: WorkShiftSource;
    startAt: Date;
    endAt: Date;
    totalMinutes: number;
    observation?: string | null;
    segments: Array<ClassifiedSegmentForPersistence>;
    createdByUserId?: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const startPunch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "INGRESO",
          timestamp: input.startAt,
          source: input.source,
          observation: input.observation || "Fichada manual registrada por administración.",
        },
      });

      const endPunch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "SALIDA",
          timestamp: input.endAt,
          source: input.source,
          observation: input.observation || "Fichada manual registrada por administración.",
        },
      });

      const workShift = await tx.workShift.create({
        data: {
          employeeId: input.employeeId,
          startPunchId: startPunch.id,
          endPunchId: endPunch.id,
          source: input.source,
          status: "PROCESADO",
          startAt: input.startAt,
          endAt: input.endAt,
          totalMinutes: input.totalMinutes,
          crossesMidnight: new Set(input.segments.map((segment) => segment.date.getTime())).size > 1,
          maxAllowedMinutes: 20 * 60,
          observation: input.observation || null,
          createdByUserId: input.createdByUserId || null,
          closedAt: input.endAt,
        },
      });

      const entries = [];
      const timeSegments = [];
      // Motor único de Hora Especial (alcance + FERIADO/convocatoria), por fecha de tramo.
      const specialHours = await resolveSpecialHourRulesByDate(input.employeeId, input.segments.map((segment) => segment.date), tx);
      const nightHourConcepts = await tx.hourConcept.findMany({
        where: { id: { in: [...new Set(input.segments.map((segment) => segment.hourConceptId))] } },
        select: { id: true, kind: true },
      });
      const nightHourConceptIds = new Set(nightHourConcepts.filter((concept) => NIGHT_HOUR_CONCEPT_KINDS.has(concept.kind)).map((concept) => concept.id));
      for (const segment of input.segments) {
        const { matchedRules, winners, multiplier, conflicting } = specialHours.get(calendarDateKey(segment.date))!;
        const timeSegment = await tx.timeSegment.create({
          data: {
            workShiftId: workShift.id,
            employeeId: input.employeeId,
            date: segment.date,
            fromDateTime: segment.startAt,
            toDateTime: segment.endAt,
            minutes: segment.minutes,
            hourConceptId: segment.hourConceptId,
            hourConceptName: segment.hourConceptName,
            hourConceptRuleId: segment.hourConceptRuleId || null,
            ...(segment.conceptStatus ? { conceptStatus: segment.conceptStatus } : {}),
            isSpecial: matchedRules.length > 0,
            isNight: nightHourConceptIds.has(segment.hourConceptId),
            observation: input.observation || null,
          },
        });
        timeSegments.push(timeSegment);

        for (const data of specialHourApplicationRows(timeSegment.id, { matchedRules, winners, conflicting })) {
          await tx.specialHourRuleApplication.create({ data });
        }

        const existing = await tx.timeEntry.findFirst({
          where: {
            employeeId: input.employeeId,
            hourConceptId: input.normalHourConceptId,
            date: segment.date,
          },
          include: timeEntryInclude,
        });

        if (existing && !editableStatuses.includes(existing.status)) {
          throw new Error(`TIME_ENTRY_LOCKED:${existing.id}`);
        }

        if (existing) {
          // Etapa 8F: hours/totalMinutes/actualMinutes son siempre minutos
          // reales trabajados, nunca el valor multiplicado por una Hora
          // Especial (eso se deriva aparte con appliedMultiplier, nunca se
          // persiste inflado acá). Se recalcula desde actualMinutes, no desde
          // totalMinutes, para que un TimeEntry legado que haya quedado
          // inflado antes de esta etapa se autocorrija apenas se le agregue
          // un nuevo tramo.
          const nextRealMinutes = (existing.actualMinutes ?? existing.totalMinutes) + segment.minutes;
          const currentObservation = existing.observation ? `${existing.observation}\n` : "";
          entries.push(await tx.timeEntry.update({
            where: { id: existing.id },
            data: {
              workShiftId: workShift.id,
              timeSegmentId: timeSegment.id,
              hours: nextRealMinutes / 60,
              totalMinutes: nextRealMinutes,
              actualMinutes: nextRealMinutes,
              appliedMultiplier: multiplier,
              source: input.source,
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              // Texto de negocio, nunca el id de la jornada (antes
              // "Marcación <workShift.id>: ..."): el vínculo técnico ya queda
              // en workShiftId/timeSegmentId.
              observation: `${currentObservation}${input.observation || FICHADA_ORIGIN_NOTE}`,
            },
            include: timeEntryInclude,
          }));
        } else {
          entries.push(await tx.timeEntry.create({
            data: {
              employeeId: input.employeeId,
              hourConceptId: input.normalHourConceptId,
              workShiftId: workShift.id,
              timeSegmentId: timeSegment.id,
              date: segment.date,
              period: periodFromCalendarDate(segment.date),
              day: dayOfMonthFromCalendarDate(segment.date),
              hours: segment.minutes / 60,
              totalMinutes: segment.minutes,
              actualMinutes: segment.minutes,
              appliedMultiplier: multiplier,
              status: "BORRADOR",
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              source: input.source,
              observation: input.observation || "Generado por marcación de entrada/salida.",
              createdByUserId: input.createdByUserId || null,
            },
            include: timeEntryInclude,
          }));
        }
      }

      return { workShift, entries, timeSegments };
    }, { timeout: 20_000, maxWait: 5_000 });
  },

  // Etapa 13F (docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md):
  // causa raíz del 503 "Transaction already closed" en la salida del
  // fichador con foto — esta transacción hacía TODA la resolución de Horas
  // Especiales (scope del empleado, reglas activas, conceptos nocturnos) con
  // `tx`, sumando 3 queries de sólo lectura al presupuesto de 5000ms del
  // timeout por defecto de Prisma, más una `tx.timeEntry.findFirst` por
  // segmento dentro del loop (1 round-trip evitable por tramo). Ninguna de
  // esas 3 lecturas necesita el lock/aislamiento de esta transacción: son
  // exactamente las mismas queries que ya corren fuera de cualquier tx en
  // `resolveDoubleHourMultiplierForManualEntry` (carga manual, más arriba en
  // este archivo) — mismo criterio de scope, mismo riesgo ya aceptado de que
  // el scope del empleado pueda cambiar en el margen de milisegundos entre
  // la lectura y el commit. Se resuelven acá con `prisma` (no `tx`) antes de
  // abrir la transacción; el `tx.timeEntry.findFirst` por segmento se
  // reemplaza por un único `tx.timeEntry.findMany` (cada segmento tiene una
  // fecha calendario distinta por diseño de `buildShiftSegments`, así que
  // agruparlos en una sola consulta no cambia ningún resultado, sólo el
  // número de round-trips). Dentro de la transacción sólo queda lo
  // indispensable para que la salida quede confirmada de forma atómica:
  // reclamar el WorkShift, crear el AttendancePunch de salida, y crear/
  // actualizar TimeEntry+TimeSegment+SpecialHourRuleApplication (el registro
  // real de horas trabajadas, no un efecto secundario diferible).
  async closeOpenWorkShift(input: {
    workShiftId: string;
    employeeId: string;
    // Etapa 6L: igual que en createFromWorkShift — Hora normal canónica,
    // usada tanto para la etiqueta del WorkShift como para cada TimeEntry
    // generado. El clasificador legacy sigue pudiendo partir `segments` por
    // HourConceptRule/priority para TimeSegment; eso ya no llega a TimeEntry.
    normalHourConceptId: string;
    normalHourConceptName: string;
    source: WorkShiftSource;
    endAt: Date;
    totalMinutes: number;
    segments: Array<ClassifiedSegmentForPersistence>;
    observation?: string | null;
    punchEvidence?: PunchEvidenceInput;
  }) {
    // Fuera de la transacción: sólo lecturas de configuración de sistema
    // (Horas Especiales activas + su alcance, conceptos nocturnos) que no
    // dependen de nada que esta transacción vaya a escribir.
    // Motor único de Hora Especial (alcance + FERIADO/convocatoria), por fecha de tramo.
    const [specialHours, nightHourConcepts] = await Promise.all([
      resolveSpecialHourRulesByDate(input.employeeId, input.segments.map((segment) => segment.date)),
      prisma.hourConcept.findMany({
        where: { id: { in: [...new Set(input.segments.map((segment) => segment.hourConceptId))] } },
        select: { id: true, kind: true },
      }),
    ]);
    const nightHourConceptIds = new Set(nightHourConcepts.filter((concept) => NIGHT_HOUR_CONCEPT_KINDS.has(concept.kind)).map((concept) => concept.id));
    // Cada segmento tiene una fecha calendario distinta (buildShiftSegments
    // parte por medianoche, nunca dos tramos con la misma fecha) — el Map
    // sólo deduplica por las dudas, no cambia el conjunto real de fechas.
    const uniqueDates = [...new Map(input.segments.map((segment) => [segment.date.getTime(), segment.date])).values()];

    return prisma.$transaction(async (tx) => {
      const claimed = await tx.workShift.updateMany({
        where: {
          id: input.workShiftId,
          employeeId: input.employeeId,
          status: "ABIERTO",
          endAt: null,
        },
        data: {
          status: "PROCESADO",
          hourConceptId: input.normalHourConceptId,
          hourConceptName: input.normalHourConceptName,
          endAt: input.endAt,
          totalMinutes: input.totalMinutes,
          crossesMidnight: new Set(input.segments.map((segment) => segment.date.getTime())).size > 1,
          closedAt: input.endAt,
          observation: input.observation || undefined,
        },
      });
      if (claimed.count !== 1) {
        throw new Error("WORK_SHIFT_ALREADY_CLOSED");
      }

      const endPunch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "SALIDA",
          timestamp: input.endAt,
          source: input.source,
          observation: input.observation || null,
          ...punchEvidenceData(input.punchEvidence),
        },
      });

      const workShift = await tx.workShift.update({
        where: { id: input.workShiftId },
        data: {
          endPunchId: endPunch.id,
        },
      });

      // Una sola consulta agrupando todas las fechas de la jornada en vez de
      // un findFirst por segmento -- mismo resultado (cada fecha es de un
      // único segmento), menos round-trips dentro del tx crítico.
      // Etapa 15M.3: `orderBy: createdAt asc` + construir el Map en ese orden
      // hace que, ante un duplicado histórico real (mismo employeeId+date+
      // hourConceptId, posible por el bug corregido en esta etapa — no hay
      // constraint único, sólo índice), la fila más RECIENTE quede como
      // "existing" de forma determinística (la última en pisar el Map),
      // en vez de depender del orden no garantizado que devuelve Postgres
      // sin ORDER BY. No fusiona ni borra el duplicado — sólo hace
      // predecible cuál de las filas sigue acumulando hacia adelante.
      const existingEntries = uniqueDates.length
        ? await tx.timeEntry.findMany({
            where: { employeeId: input.employeeId, hourConceptId: input.normalHourConceptId, date: { in: uniqueDates } },
            include: timeEntryInclude,
            orderBy: { createdAt: "asc" },
          })
        : [];
      const existingByDate = new Map(existingEntries.map((entry) => [entry.date.getTime(), entry]));

      const timeSegments = [];
      const pendingRuleApplications: Prisma.SpecialHourRuleApplicationCreateManyInput[] = [];
      // Etapa 15M.3 (docs/decisions/ATTENDANCE_TIME_GRID_REAL_DATA_FIX_15M3.md):
      // Hora normal representa el total físico completo de la jornada, sin
      // importar en cuántos TimeSegment se haya partido por concepto —
      // Motor A (el clasificador legacy) puede dividir un mismo WorkShift en
      // varios tramos de la MISMA fecha calendario cuando hay un concepto
      // adicional AUTOMATIC/BOTH con una regla horaria que sólo cubre parte
      // del turno (ej. "Prueba" 09:00-11:00 dentro de un turno 07:50-11:59).
      // Antes de esta etapa, cada tramo escribía su propio TimeEntry.update
      // leyendo `existingByDate` (fijado UNA sola vez antes de este loop,
      // Etapa 13F) sin refrescarlo entre tramos: el segundo/tercer tramo de
      // la misma fecha recalculaba `existing.actualMinutes` desde el mismo
      // valor stale de antes del loop, sobreescribiendo por completo lo que
      // el tramo anterior acababa de guardar — la última iteración ganaba y
      // los minutos de los tramos intermedios se perdían en silencio. Acá se
      // acumulan los minutos de TODOS los tramos de esta jornada agrupados
      // por fecha, y recién después de crear los TimeSegment se escribe
      // exactamente un TimeEntry por fecha calendario (nunca uno por tramo).
      const dailyNormalMinutes = new Map<number, number>();
      const lastSegmentByDate = new Map<number, { id: string; startAt: Date; endAt: Date }>();
      const dailyMultiplier = new Map<number, { multiplier: number; rulesNote: string }>();

      for (const segment of input.segments) {
        const { matchedRules, winners, multiplier, conflicting } = specialHours.get(calendarDateKey(segment.date))!;
        const timeSegment = await tx.timeSegment.create({
          data: {
            workShiftId: workShift.id,
            employeeId: input.employeeId,
            date: segment.date,
            fromDateTime: segment.startAt,
            toDateTime: segment.endAt,
            minutes: segment.minutes,
            hourConceptId: segment.hourConceptId,
            hourConceptName: segment.hourConceptName,
            hourConceptRuleId: segment.hourConceptRuleId || null,
            ...(segment.conceptStatus ? { conceptStatus: segment.conceptStatus } : {}),
            isSpecial: matchedRules.length > 0,
            isNight: nightHourConceptIds.has(segment.hourConceptId),
          },
        });
        timeSegments.push(timeSegment);

        // Acumulado, no escrito acá -- un solo createMany después del loop
        // (ver más abajo) en vez de 1 round-trip por regla por segmento.
        pendingRuleApplications.push(...specialHourApplicationRows(timeSegment.id, { matchedRules, winners, conflicting }));

        // DoubleHourRule matchea por fecha calendario completa, nunca por
        // franja horaria (ver docs/decisions/HOURS_GRID_SPECIAL_HOURS_LIQUIDABLE_11A1.md
        // §3.9) — todos los tramos de una misma fecha comparten exactamente
        // el mismo `multiplier`/`matchedRules`, así que sobreescribir acá es
        // seguro y equivalente a calcularlo una sola vez por fecha.
        const workedHours = Math.floor(segment.minutes / 60);
        const remainingMinutes = segment.minutes % 60;
        const workedDuration = workedHours > 0
          ? `${workedHours} h${remainingMinutes > 0 ? ` ${remainingMinutes} min` : ""}`
          : `${remainingMinutes} min`;
        const rulesNote = matchedRules.length > 0
          ? ` Reglas aplicadas: ${matchedRules.map((rule) => rule.name).join(", ")}. Multiplicador x${multiplier} · ${workedDuration} trabajadas.`
          : "";
        const dateKey = segment.date.getTime();
        dailyNormalMinutes.set(dateKey, (dailyNormalMinutes.get(dateKey) ?? 0) + segment.minutes);
        lastSegmentByDate.set(dateKey, { id: timeSegment.id, startAt: segment.startAt, endAt: segment.endAt });
        dailyMultiplier.set(dateKey, { multiplier, rulesNote });
      }

      const entries = [];
      for (const [dateKey, minutes] of dailyNormalMinutes) {
        const existing = existingByDate.get(dateKey) ?? null;

        if (existing && existing.status !== "APROBADO" && !editableStatuses.includes(existing.status)) {
          throw new Error(`TIME_ENTRY_LOCKED:${existing.id}`);
        }

        const lastSegment = lastSegmentByDate.get(dateKey)!;
        const { multiplier, rulesNote } = dailyMultiplier.get(dateKey)!;

        if (existing) {
          // Etapa 8F: ver misma nota en createFromWorkShift — hours/
          // totalMinutes/actualMinutes son siempre minutos reales, nunca el
          // valor multiplicado por una Hora Especial, y se recalculan desde
          // actualMinutes para autocorregir cualquier TimeEntry legado.
          const nextRealMinutes = (existing.actualMinutes ?? existing.totalMinutes) + minutes;
          const currentObservation = existing.observation ? `${existing.observation}\n` : "";
          entries.push(await tx.timeEntry.update({
            where: { id: existing.id },
            data: {
              workShiftId: workShift.id,
              timeSegmentId: lastSegment.id,
              hours: nextRealMinutes / 60,
              totalMinutes: nextRealMinutes,
              actualMinutes: nextRealMinutes,
              appliedMultiplier: multiplier,
              source: input.source,
              segmentStartAt: lastSegment.startAt,
              segmentEndAt: lastSegment.endAt,
              observation: `${currentObservation}${FICHADA_ORIGIN_NOTE}${rulesNote}`,
              status: "APROBADO",
            },
            include: timeEntryInclude,
          }));
        } else {
          entries.push(await tx.timeEntry.create({
            data: {
              employeeId: input.employeeId,
              hourConceptId: input.normalHourConceptId,
              workShiftId: workShift.id,
              timeSegmentId: lastSegment.id,
              date: new Date(dateKey),
              period: periodFromCalendarDate(new Date(dateKey)),
              day: dayOfMonthFromCalendarDate(new Date(dateKey)),
              hours: minutes / 60,
              totalMinutes: minutes,
              actualMinutes: minutes,
              appliedMultiplier: multiplier,
              status: "APROBADO",
              segmentStartAt: lastSegment.startAt,
              segmentEndAt: lastSegment.endAt,
              source: input.source,
              observation: `${FICHADA_ORIGIN_NOTE}${rulesNote}`,
            },
            include: timeEntryInclude,
          }));
        }
      }

      if (pendingRuleApplications.length) {
        await tx.specialHourRuleApplication.createMany({ data: pendingRuleApplications });
      }

      return { workShift, entries, timeSegments };
      // maxWait: cuánto puede esperar para conseguir una conexión del pool
      // (default 2000ms, mismo valor -- no era el problema real). timeout:
      // presupuesto de ejecución una vez iniciada, subido de 5000ms (default
      // de Prisma, nunca configurado explícitamente en este proyecto) a
      // 10000ms como defensa en profundidad -- secundaria a la reducción de
      // trabajo de arriba, no la solución principal (ver
      // docs/decisions/CLOCK_PHOTO_PUNCH_EXIT_TRANSACTION_13F.md §6/§10).
    }, { timeout: 10_000 });
  },

  // autoApprovedByUserId != null => la edición la hizo RRHH (Etapa 6L.3):
  // aplica/aprueba directo sin importar el status anterior (BORRADOR,
  // EN_REVISION, DEVUELTO o ya APROBADO). Nivel 2/3 no mandan este
  // parámetro, así que el status queda intacto, igual que antes de 6L.3.
  async update(id: string, before: { employeeId: string; hourConceptId: string; date: Date }, input: UpdateTimeEntryInput, autoApprovedByUserId?: string | null) {
    const date = input.date || before.date;
    const hours = input.hours;
    // Etapa 11A: se re-resuelve el multiplicador contra la fecha efectiva en
    // cada edición manual (mismo criterio "se corrige al tocar la fila" ya
    // usado por el fichador desde 8F, no un recálculo retroactivo masivo) —
    // así una corrección de una carga manual ya existente también queda
    // alineada con las reglas de Horas Especiales vigentes hoy.
    const appliedMultiplier = await resolveDoubleHourMultiplierForManualEntry(before.employeeId, date);
    return prisma.timeEntry.update({
      where: { id },
      data: {
        ...(input.hourConceptId !== undefined ? { hourConceptId: input.hourConceptId } : {}),
        ...(input.date !== undefined ? { date, period: periodFromCalendarDate(date), day: dayOfMonthFromCalendarDate(date) } : {}),
        ...(hours !== undefined ? { hours, totalMinutes: minutesFromHours(hours) } : {}),
        appliedMultiplier,
        ...(input.observation !== undefined ? { observation: input.observation || null } : {}),
        ...(autoApprovedByUserId ? { status: "APROBADO", approvedByUserId: autoApprovedByUserId, approvedAt: new Date(), rejectedAt: null } : {}),
      },
      include: timeEntryInclude,
    });
  },

  submit(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "EN_REVISION" },
      include: timeEntryInclude,
    });
  },

  approve(id: string, approvedByUserId: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "APROBADO", approvedByUserId, approvedAt: new Date(), rejectedAt: null },
      include: timeEntryInclude,
    });
  },

  reject(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "RECHAZADO", approvedByUserId: null, approvedAt: null, rejectedAt: new Date() },
      include: timeEntryInclude,
    });
  },

  returnForCorrection(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "DEVUELTO", approvedByUserId: null, approvedAt: null, rejectedAt: null },
      include: timeEntryInclude,
    });
  },
};
