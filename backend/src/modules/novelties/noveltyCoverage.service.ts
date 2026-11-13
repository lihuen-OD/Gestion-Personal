/**
 * Cobertura diaria de novedades (docs/decisions/NOVELTY_COVERAGE_ENGINE.md
 * §5–§6, etapa 3): carga el contexto en lote, ejecuta el motor puro y
 * persiste `NoveltyDayCoverage` de forma idempotente. La vista previa usa
 * exactamente `computeNoveltyCoverage`, la misma función que la persistencia.
 *
 * Todavía no participa de ningún total (etapa 4): estas filas no tocan
 * TimeEntry, la contabilidad, la grilla ni Finnegans.
 *
 * Consultas fijas por llamada, nunca por día: contexto de jornada esperada
 * (etapa 2, por ventana de hasta 366 días), movimientos de alta/baja (1),
 * motor de Horas Especiales para todos los legajos (consultas fijas,
 * `evaluateSpecialHourRulesForEmployees`) y filas previas resueltas (1).
 */
import type { NoveltyCoverageOutcome, NoveltyCoverageScheduleReviewReason, Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate, argentinaCalendarDate, calendarDateKey, nextCalendarDateKey, periodFromCalendarDate } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { employeePeriodKey, findProtectedClosurePeriods, ProtectedClosurePeriodError, uniqueEmployeePeriods, type EmployeePeriod } from "../../shared/monthlyClosure/closurePeriodGuard";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";
import { laborRelationOnDate, loadLaborMovementsByEmployee } from "../employees/laborRelation";
import { evaluateEmployeeWorkday, loadEmployeeWorkdayContext, type EmployeeWorkdayContext, type ExpectedWorkday } from "../shifts/expectedWorkday";
import { evaluateSpecialHourRulesForEmployees, SpecialHourScopeHistoryMissingError, type SpecialHourEvaluation } from "../time-entries/timeEntries.repository";
import {
  accountEmployeePeriod,
  accountingBaseEntrySelect,
  accountingBreakdownSelect,
  countedBreakdownStatusWhere,
  toAccountingBaseEntry,
  toAccountingBreakdown,
} from "../time-entries/workedTimeAccounting";
import { loadDayOffAccounting } from "../employee-day-offs/employeeDayOffAccounting";
import {
  CoverageScopeHistoryMissingError,
  evaluateNoveltyCoverageDay,
  type CoverageDayResult,
  type CoverageEmployment,
  type CoverageTypeConfig,
  type PreviousCoverageResolution,
} from "./noveltyCoverage.engine";

type Db = PrismaTransactionClient;

/** Una novedad de un tipo que registra tiempo cubre como máximo un año. */
export const MAX_COVERAGE_RANGE_DAYS = 366;
/** Tope de días-legajo por operación: acota la transacción (lock de cierres y escritura en lote). */
export const MAX_COVERAGE_ROWS_PER_OPERATION = 20_000;
/** Una novedad sin tiempo (NONE) igual genera una fila por día; más allá de esto es un error de carga. */
export const MAX_NONE_RANGE_DAYS = 3660;
const CREATE_CHUNK_SIZE = 5000;
const DAY_MS = 86_400_000;

export const coverageTypeSelect = {
  coverageMode: true,
  coverageFixedMinutes: true,
  coverageDayRule: true,
  coverageWeekdays: true,
  coverageOnDayOff: true,
  coverageOnHoliday: true,
  coverageAppliesSpecialHours: true,
  coverageCountsTowardTotal: true,
  realWorkCompatibility: true,
} as const satisfies Prisma.NoveltyTypeSelect;

export type NoveltyCoverageSpec = {
  /** noveltyId en la persistencia; una clave cualquiera en la vista previa. */
  key: string;
  employeeId: string;
  type: CoverageTypeConfig;
  fromDate: Date;
  /** Fin inclusive (ya resuelto: una novedad de un día tiene toDate = fromDate). */
  toDate: Date;
  quantityMinutes: number | null;
  previous?: ReadonlyMap<string, PreviousCoverageResolution>;
};

export function coverageDateKeys(fromDate: Date, toDate: Date): string[] {
  const keys: string[] = [];
  for (let key = calendarDateKey(fromDate), last = calendarDateKey(toDate); key <= last; key = nextCalendarDateKey(key)) keys.push(key);
  return keys;
}

export function coverageRangeDays(fromDate: Date, toDate: Date) {
  return Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
}

/** Ventanas de hasta MAX_COVERAGE_RANGE_DAYS para el contexto de jornada (el cargador admite 400). */
function groupIntoWindows(specs: NoveltyCoverageSpec[]) {
  const sorted = [...specs].sort((left, right) => left.fromDate.getTime() - right.fromDate.getTime());
  const windows: Array<{ from: Date; to: Date; specs: NoveltyCoverageSpec[] }> = [];
  for (const spec of sorted) {
    const current = windows[windows.length - 1];
    const to = current && spec.toDate > current.to ? spec.toDate : current?.to;
    if (current && to && coverageRangeDays(current.from, to) <= MAX_COVERAGE_RANGE_DAYS) {
      current.to = to;
      current.specs.push(spec);
    } else {
      windows.push({ from: spec.fromDate, to: spec.toDate, specs: [spec] });
    }
  }
  return windows;
}

function employmentOf(relation: ReturnType<typeof laborRelationOnDate>): CoverageEmployment {
  return relation.kind === "EMPLOYED" ? "EMPLOYED" : relation.kind === "NOT_EMPLOYED" ? "NOT_EMPLOYED" : "UNKNOWN";
}

/**
 * Cobertura día por día de cada especificación. Misma función para la vista
 * previa y la persistencia. Lanza `CoverageScopeHistoryMissingError` si una
 * regla con alcance necesita historia laboral que no está registrada.
 */
export async function computeNoveltyCoverage(db: Db, specs: NoveltyCoverageSpec[]): Promise<Map<string, CoverageDayResult[]>> {
  const result = new Map<string, CoverageDayResult[]>();
  const timed = specs.filter((spec) => spec.type.coverageMode !== "NONE");

  const contexts = new Map<NoveltyCoverageSpec, EmployeeWorkdayContext>();
  for (const window of groupIntoWindows(timed)) {
    const loaded = await loadEmployeeWorkdayContext(window.specs.map((spec) => spec.employeeId), window.from, window.to, db);
    for (const spec of window.specs) contexts.set(spec, loaded.get(spec.employeeId)!);
  }

  const movements = await loadLaborMovementsByEmployee(db, timed.map((spec) => spec.employeeId));

  const datesByEmployee = new Map<string, Date[]>();
  for (const spec of timed.filter((item) => item.type.coverageAppliesSpecialHours)) {
    const dates = datesByEmployee.get(spec.employeeId) ?? [];
    dates.push(...coverageDateKeys(spec.fromDate, spec.toDate).map(argentinaCalendarDate));
    datesByEmployee.set(spec.employeeId, dates);
  }
  const specialHours = datesByEmployee.size
    ? await evaluateSpecialHourRulesForEmployees(datesByEmployee, db)
    : new Map<string, Map<string, SpecialHourEvaluation>>();

  for (const spec of specs) {
    const keys = coverageDateKeys(spec.fromDate, spec.toDate);
    const context = contexts.get(spec);
    const employeeMovements = movements.get(spec.employeeId) ?? [];
    try {
      result.set(
        spec.key,
        keys.map((dateKey) =>
          evaluateNoveltyCoverageDay({
            dateKey,
            type: spec.type,
            quantityMinutes: spec.quantityMinutes,
            employment: context ? employmentOf(laborRelationOnDate(employeeMovements, dateKey)) : "UNKNOWN",
            workday: context ? evaluateEmployeeWorkday(context, dateKey) : NO_CONTEXT_WORKDAY(dateKey),
            dayOff: context?.dayOffDates.has(dateKey) ?? false,
            holiday: context?.holidays.get(dateKey) ?? null,
            convoked: context?.convocations.has(dateKey) ?? false,
            specialHours: specialHours.get(spec.employeeId)?.get(dateKey) ?? null,
            previous: spec.previous?.get(dateKey) ?? null,
          }),
        ),
      );
    } catch (error) {
      // Quien llama traduce el error con la identidad de este legajo.
      if (error instanceof CoverageScopeHistoryMissingError) error.employeeId = spec.employeeId;
      throw error;
    }
  }
  return result;
}

// Un tipo NONE no consulta jornada: el motor lo resuelve antes de mirarla.
function NO_CONTEXT_WORKDAY(dateKey: string): ExpectedWorkday {
  return { dateKey, obligation: "UNRESOLVED", unresolvedReason: "SCHEDULE_MISSING", expectedMinutes: null, shiftTemplateIds: [], isHoliday: false, convoked: false, source: "NONE", minutesSource: null };
}

// ── Errores en lenguaje de negocio ──────────────────────────────────────────

/**
 * Traduce la falta de historia laboral a `409 SPECIAL_HOUR_SCOPE_HISTORY_MISSING`
 * (mismo código y criterio que el motor de Horas Especiales). Nunca una
 * revisión manual ni 0 h provisional.
 */
export function toCoverageAppError(error: unknown, employee?: { legajo?: string | null; firstName?: string | null; lastName?: string | null }) {
  if (!(error instanceof CoverageScopeHistoryMissingError)) return error;
  if (error.detail.kind === "SPECIAL_HOUR") return new SpecialHourScopeHistoryMissingError(error.detail.missing);
  return new AppError(
    `No hay historia laboral registrada para el ${formatArgentinaDate(error.detail.dateKey)} de ${formatEmployeeReference(employee)}, que necesita una regla de feriado con alcance para saber si ese día era feriado. Primero hay que registrar la historia desde esa fecha.`,
    409,
    "SPECIAL_HOUR_SCOPE_HISTORY_MISSING",
    { date: error.detail.dateKey },
  );
}

// ── Etiquetas legibles (vista previa y consulta) ────────────────────────────

const outcomeLabels: Record<NoveltyCoverageOutcome, string> = {
  COVERED: "Cubre",
  NO_COVERAGE: "No registra tiempo",
  WEEKDAY_NOT_INCLUDED: "Día no incluido",
  NO_WORK_OBLIGATION: "No tenía que trabajar",
  HOLIDAY_NOT_CONVOKED: "Feriado sin convocatoria",
  HOLIDAY_EXCLUDED: "Feriado: no cuenta",
  DAY_OFF: "Franco",
  SCHEDULE_UNRESOLVED: "Revisar",
  OUTSIDE_EMPLOYMENT: "Fuera de la relación laboral",
};

const reviewReasonLabels: Record<NoveltyCoverageScheduleReviewReason, string> = {
  SCHEDULE_MISSING: "Revisar: el legajo no tiene turno configurado para esta fecha",
  FLEXIBLE_REGIME_NO_ASSIGNMENT: "Revisar: régimen flexible sin turno asignado ese día",
  REGIME_WITHOUT_SCHEDULE: "Revisar: régimen sin turno",
  EXPECTED_MINUTES_UNKNOWN: "Revisar: no se pudo determinar la jornada",
  SHIFT_ASSIGNMENTS_OVERLAP: "Revisar: el legajo tiene turnos superpuestos ese día",
  EMPLOYMENT_HISTORY_UNRESOLVED: "Revisar: falta registrar la fecha de alta del legajo",
};

export function coverageDayLabel(day: { outcome: NoveltyCoverageOutcome; scheduleReviewReason: NoveltyCoverageScheduleReviewReason | null; reviewStatus: string }) {
  if (day.outcome === "SCHEDULE_UNRESOLVED" && day.scheduleReviewReason) {
    return day.reviewStatus === "RESOLVED" ? "Resuelto por el encargado de carga" : reviewReasonLabels[day.scheduleReviewReason];
  }
  return outcomeLabels[day.outcome];
}

// ── Persistencia ────────────────────────────────────────────────────────────

const GLOBAL_COVERAGE_LOCK = "novelty-coverage:global";

/**
 * Orden de locks de cobertura (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13.6),
 * siempre dentro de la transacción y antes de los locks de cierre:
 *   día del legajo (employeeDayLock) → cobertura global → cobertura por legajo → cierres.
 * Todo escritor de cobertura toma el global COMPARTIDO; un cambio que alcanza a
 * cualquier legajo (regla, turno, régimen, tipo, convocatoria) lo toma
 * EXCLUSIVO al empezar, así nunca se intercala con un alta o recálculo.
 */
export async function lockNoveltyCoverageGlobally(db: Pick<Db, "$executeRaw">) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${GLOBAL_COVERAGE_LOCK}::text, 0))`;
}

/** Serializa los recálculos de cobertura de un mismo legajo dentro de la transacción. */
export async function lockEmployeeCoverage(db: Pick<Db, "$executeRaw">, employeeIds: string[]) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${GLOBAL_COVERAGE_LOCK}::text, 0))`;
  const keys = [...new Set(employeeIds.map((id) => `novelty-coverage:${id}`))].sort();
  if (!keys.length) return;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(k, 0)) FROM unnest(${keys}::text[]) AS k`;
}

/**
 * Qué hacer con los días de un período protegido (ENVIADO, APROBADO,
 * CORRECCION_PENDIENTE):
 *   REJECT: 409 PERIOD_CLOSED (mutación de un usuario sin corrección).
 *   ALLOW_CORRECTION: corrección explícita de RRHH con motivo; se escribe.
 *   SKIP: recálculo automático; esos días no se calculan ni se tocan y se informan.
 */
export type ProtectedPeriodPolicy = "REJECT" | "ALLOW_CORRECTION" | "SKIP";

const PROTECTED_MESSAGE = "El período ya fue enviado a cierre. Pedile a RRHH que corrija la novedad si hace falta.";

/** Una resolución manual que el recálculo descartó porque la evidencia ya responde la pregunta. */
export type DroppedCoverageResolution = {
  noveltyId: string;
  employeeId: string;
  date: string;
  previousOutcome: NoveltyCoverageOutcome;
  previousReason: NoveltyCoverageScheduleReviewReason | null;
  resolution: PreviousCoverageResolution["resolution"];
  resolvedBaseMinutes: number;
  resolvedByUserId: string | null;
  resolvedAt: string;
  resolutionNote: string | null;
  newOutcome: NoveltyCoverageOutcome;
  newReason: NoveltyCoverageScheduleReviewReason | null;
};

export type CoveragePersistSummary = {
  novelties: number;
  /** Días calculados (fuera de períodos protegidos en modo SKIP). */
  days: number;
  pendingReviewDays: number;
  droppedResolutions: number;
  protectedPeriods: EmployeePeriod[];
  /** Días cuya fila se creó, cambió o desapareció (los idénticos no se reescriben). */
  changedDays: number;
  changedNoveltyIds: string[];
  /** Legajo + período con algún día cambiado: los snapshots abiertos a reconstruir. */
  changedPairs: EmployeePeriod[];
  droppedResolutionDetails: DroppedCoverageResolution[];
};

/** Ventana de fechas calendario (inclusive) a recalcular; `null` = sin límite de ese lado. */
export type CoverageWindow = { from: Date | null; to: Date | null };

const persistNoveltySelect = {
  id: true,
  employeeId: true,
  status: true,
  fromDate: true,
  toDate: true,
  quantityMinutes: true,
  employee: { select: { legajo: true, firstName: true, lastName: true } },
  noveltyType: { select: { id: true, allowsDateRange: true, ...coverageTypeSelect } },
} as const satisfies Prisma.NoveltySelect;

type PersistNovelty = Prisma.NoveltyGetPayload<{ select: typeof persistNoveltySelect }>;

const existingRowSelect = {
  id: true,
  noveltyId: true,
  employeeId: true,
  noveltyTypeId: true,
  date: true,
  period: true,
  outcome: true,
  scheduleReviewReason: true,
  expectedMinutes: true,
  baseMinutes: true,
  appliedMultiplier: true,
  countsTowardTotal: true,
  realWorkCompatibility: true,
  shiftTemplateId: true,
  reviewStatus: true,
  resolution: true,
  resolvedBaseMinutes: true,
  resolvedAgainstWorkedMinutes: true,
  resolvedByUserId: true,
  resolvedAt: true,
  resolutionNote: true,
} as const satisfies Prisma.NoveltyDayCoverageSelect;

type ExistingRow = Prisma.NoveltyDayCoverageGetPayload<{ select: typeof existingRowSelect }>;

/**
 * Fin inclusive de la novedad. `toDate` nulo es SIEMPRE un único día
 * (`fromDate`), para cualquier tipo: `allowsDateRange` dice que el tipo PUEDE
 * abarcar varias fechas, nunca que un `toDate` vacío sea un rango abierto.
 */
export function noveltyCoverageEnd(novelty: { fromDate: Date; toDate: Date | null }): Date {
  return novelty.toDate ?? novelty.fromDate;
}

function periodPairs(employeeId: string, fromDate: Date, toDate: Date): EmployeePeriod[] {
  const periods = new Set<string>();
  for (const key of coverageDateKeys(fromDate, toDate)) periods.add(key.slice(0, 7));
  return [...periods].map((period) => ({ employeeId, period }));
}

function protectedList(map: Map<string, unknown>): EmployeePeriod[] {
  return [...map.keys()].map((key) => {
    const [employeeId, period] = key.split(":");
    return { employeeId: employeeId!, period: period! };
  });
}

/** Intersección del rango de la novedad con la ventana; null si no se tocan. */
function clipToWindow(from: Date, to: Date, window: CoverageWindow | undefined): { from: Date; to: Date } | null {
  const start = window?.from && window.from > from ? window.from : from;
  const end = window?.to && window.to < to ? window.to : to;
  return start <= end ? { from: start, to: end } : null;
}

/** Tramos contiguos del rango que no caen en un período excluido (meses protegidos). */
function rangesOutsidePeriods(from: Date, to: Date, excluded: (period: string) => boolean): Array<{ from: Date; to: Date }> {
  const ranges: Array<{ from: Date; to: Date }> = [];
  let current: { from: string; to: string } | null = null;
  for (const key of coverageDateKeys(from, to)) {
    if (excluded(key.slice(0, 7))) {
      if (current) ranges.push({ from: argentinaCalendarDate(current.from), to: argentinaCalendarDate(current.to) });
      current = null;
      continue;
    }
    current = current ? { from: current.from, to: key } : { from: key, to: key };
  }
  if (current) ranges.push({ from: argentinaCalendarDate(current.from), to: argentinaCalendarDate(current.to) });
  return ranges;
}

/** Firma de una fila: dos filas con la misma firma no se reescriben. */
function rowSignature(row: {
  noveltyTypeId: string;
  outcome: NoveltyCoverageOutcome;
  scheduleReviewReason: NoveltyCoverageScheduleReviewReason | null;
  expectedMinutes: number | null;
  baseMinutes: number;
  appliedMultiplier: Prisma.Decimal | number | string;
  countsTowardTotal: boolean;
  realWorkCompatibility: string;
  shiftTemplateId: string | null;
  reviewStatus: string;
  resolution: string | null;
  resolvedBaseMinutes: number | null;
  resolvedAgainstWorkedMinutes: number | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | string | null;
  resolutionNote: string | null;
}) {
  return JSON.stringify([
    row.noveltyTypeId,
    row.outcome,
    row.scheduleReviewReason,
    row.expectedMinutes,
    row.baseMinutes,
    Number(row.appliedMultiplier).toFixed(2),
    row.countsTowardTotal,
    row.realWorkCompatibility,
    row.shiftTemplateId,
    row.reviewStatus,
    row.resolution,
    row.resolvedBaseMinutes,
    row.resolvedAgainstWorkedMinutes,
    row.resolvedByUserId,
    row.resolvedAt ? new Date(row.resolvedAt).getTime() : null,
    row.resolutionNote,
  ]);
}

const rowKey = (noveltyId: string, dateKey: string) => `${noveltyId}|${dateKey}`;

/**
 * Recalcula y persiste la cobertura de las novedades indicadas dentro de la
 * transacción del llamador (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §6.3 y
 * §13). Idempotente y por diferencia: calcula con el motor, conserva las
 * resoluciones manuales que siguen valiendo y sólo borra/crea las filas que
 * cambiaron (las idénticas no se reescriben). Una novedad RECHAZADA queda sin
 * filas; cualquier otra, de cualquier modo (también NONE), tiene una fila por
 * día: `toDate` nulo es exactamente un día, `fromDate`.
 *
 * `window` acota el recálculo a esas fechas: las filas de afuera no se leen ni
 * se tocan. En modo SKIP los días de períodos protegidos no se calculan (no
 * pueden bloquear el cambio por falta de historia) ni se tocan, y se informan.
 */
export async function persistNoveltyCoverageWithin(
  db: Db,
  noveltyIds: string[],
  options: { protectedPeriods: ProtectedPeriodPolicy; protectedMessage?: string; window?: CoverageWindow },
): Promise<CoveragePersistSummary> {
  const summary: CoveragePersistSummary = {
    novelties: 0,
    days: 0,
    pendingReviewDays: 0,
    droppedResolutions: 0,
    protectedPeriods: [],
    changedDays: 0,
    changedNoveltyIds: [],
    changedPairs: [],
    droppedResolutionDetails: [],
  };
  const ids = [...new Set(noveltyIds)];
  if (!ids.length) return summary;

  // Lock global compartido ANTES de leer la configuración del tipo: un cambio
  // global (exclusivo) nunca queda a medio leer.
  await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${GLOBAL_COVERAGE_LOCK}::text, 0))`;
  const novelties: PersistNovelty[] = await db.novelty.findMany({ where: { id: { in: ids } }, select: persistNoveltySelect });
  await lockEmployeeCoverage(db, novelties.map((novelty) => novelty.employeeId));

  const window = options.window;
  const active = novelties.filter((novelty) => novelty.status !== "RECHAZADO");
  const isTimed = (novelty: PersistNovelty) => novelty.noveltyType.coverageMode !== "NONE";
  const ranges = new Map<string, { from: Date; to: Date }>();
  for (const novelty of active) {
    const range = clipToWindow(novelty.fromDate, noveltyCoverageEnd(novelty), window);
    if (range) ranges.set(novelty.id, range);
  }
  for (const novelty of active) {
    const days = coverageRangeDays(novelty.fromDate, noveltyCoverageEnd(novelty));
    const limit = isTimed(novelty) ? MAX_COVERAGE_RANGE_DAYS : MAX_NONE_RANGE_DAYS;
    if (days > limit) throw new AppError(`Una novedad no puede abarcar más de ${limit} días.`, 400, "NOVELTY_RANGE_TOO_LONG");
  }

  // En una mutación explícita sólo los tipos que registran tiempo afectan un
  // cierre. En un recálculo automático (SKIP), en cambio, ninguna fila del
  // período protegido puede reinterpretarse, aunque el tipo hoy sea NONE o
  // justo haya cambiado de/hacia NONE (NOVELTY_COVERAGE_ENGINE.md §13.5).
  const protectedNovelties = options.protectedPeriods === "SKIP" ? active : active.filter(isTimed);
  const protectedPairs = protectedNovelties.flatMap((novelty) => {
    const range = ranges.get(novelty.id);
    return range ? periodPairs(novelty.employeeId, range.from, range.to) : [];
  });
  const protectedMap = await findProtectedClosurePeriods(db, protectedPairs);
  if (protectedMap.size && options.protectedPeriods === "REJECT") {
    throw new ProtectedClosurePeriodError(
      [...protectedMap.entries()].map(([key, status]) => ({ ...protectedList(new Map([[key, status]]))[0]!, status })),
      options.protectedMessage ?? PROTECTED_MESSAGE,
    );
  }
  const skipProtected = options.protectedPeriods === "SKIP" && protectedMap.size > 0;
  summary.protectedPeriods = protectedList(protectedMap);
  const protectedNoveltyIds = new Set(protectedNovelties.map((novelty) => novelty.id));
  const isSkipped = (noveltyId: string, employeeId: string, period: string) =>
    skipProtected && protectedNoveltyIds.has(noveltyId) && protectedMap.has(employeePeriodKey({ employeeId, period }));

  // Filas actuales de la ventana: base de la diferencia y de las resoluciones previas.
  const dateFilter = window && (window.from || window.to) ? { date: { ...(window.from ? { gte: window.from } : {}), ...(window.to ? { lte: window.to } : {}) } } : {};
  const existingRows: ExistingRow[] = await db.noveltyDayCoverage.findMany({ where: { noveltyId: { in: ids }, ...dateFilter }, select: existingRowSelect });
  const existingByKey = new Map(existingRows.map((row) => [rowKey(row.noveltyId, calendarDateKey(row.date)), row]));
  const previousByNovelty = new Map<string, Map<string, PreviousCoverageResolution>>();
  for (const row of existingRows) {
    if (row.reviewStatus !== "RESOLVED" || !row.resolution || row.resolvedBaseMinutes === null || row.resolvedAgainstWorkedMinutes === null || !row.resolvedAt) continue;
    const map = previousByNovelty.get(row.noveltyId) ?? new Map<string, PreviousCoverageResolution>();
    map.set(calendarDateKey(row.date), {
      outcome: row.outcome,
      scheduleReviewReason: row.scheduleReviewReason,
      expectedMinutes: row.expectedMinutes,
      resolution: row.resolution,
      resolvedBaseMinutes: row.resolvedBaseMinutes,
      resolvedAgainstWorkedMinutes: row.resolvedAgainstWorkedMinutes,
      resolvedByUserId: row.resolvedByUserId,
      resolvedAt: row.resolvedAt,
      resolutionNote: row.resolutionNote,
    });
    previousByNovelty.set(row.noveltyId, map);
  }

  // Una especificación por tramo calculable (sin meses protegidos en SKIP).
  const specs: NoveltyCoverageSpec[] = [];
  const noveltyOfSpec = new Map<string, PersistNovelty>();
  for (const novelty of active) {
    const range = ranges.get(novelty.id);
    if (!range) continue;
    const pieces = skipProtected && protectedNoveltyIds.has(novelty.id)
      ? rangesOutsidePeriods(range.from, range.to, (period) => protectedMap.has(employeePeriodKey({ employeeId: novelty.employeeId, period })))
      : [range];
    pieces.forEach((piece, index) => {
      const key = `${novelty.id}#${index}`;
      noveltyOfSpec.set(key, novelty);
      specs.push({
        key,
        employeeId: novelty.employeeId,
        type: novelty.noveltyType,
        fromDate: piece.from,
        toDate: piece.to,
        quantityMinutes: novelty.quantityMinutes,
        previous: previousByNovelty.get(novelty.id),
      });
    });
  }

  let computed: Map<string, CoverageDayResult[]>;
  try {
    computed = await computeNoveltyCoverage(db, specs);
  } catch (error) {
    const novelty = error instanceof CoverageScopeHistoryMissingError ? novelties.find((item) => item.employeeId === error.employeeId) : undefined;
    throw toCoverageAppError(error, novelty?.employee);
  }

  const rows: Prisma.NoveltyDayCoverageCreateManyInput[] = [];
  const calculatedAt = new Date();
  for (const spec of specs) {
    const novelty = noveltyOfSpec.get(spec.key)!;
    for (const day of computed.get(spec.key) ?? []) {
      const date = argentinaCalendarDate(day.dateKey);
      if (day.reviewStatus === "PENDING") summary.pendingReviewDays += 1;
      if (day.resolutionDropped) {
        summary.droppedResolutions += 1;
        const previous = spec.previous?.get(day.dateKey);
        if (previous) {
          summary.droppedResolutionDetails.push({
            noveltyId: novelty.id,
            employeeId: novelty.employeeId,
            date: day.dateKey,
            previousOutcome: previous.outcome,
            previousReason: previous.scheduleReviewReason,
            resolution: previous.resolution,
            resolvedBaseMinutes: previous.resolvedBaseMinutes,
            resolvedByUserId: previous.resolvedByUserId,
            resolvedAt: previous.resolvedAt.toISOString(),
            resolutionNote: previous.resolutionNote,
            newOutcome: day.outcome,
            newReason: day.scheduleReviewReason,
          });
        }
      }
      rows.push({
        noveltyId: novelty.id,
        employeeId: novelty.employeeId,
        noveltyTypeId: novelty.noveltyType.id,
        date,
        period: periodFromCalendarDate(date),
        day: date.getUTCDate(),
        outcome: day.outcome,
        scheduleReviewReason: day.scheduleReviewReason,
        expectedMinutes: day.expectedMinutes,
        baseMinutes: day.baseMinutes,
        appliedMultiplier: day.multiplier,
        countsTowardTotal: day.countsTowardTotal,
        realWorkCompatibility: day.realWorkCompatibility,
        shiftTemplateId: day.shiftTemplateId,
        reviewStatus: day.reviewStatus,
        resolution: day.resolution,
        resolvedBaseMinutes: day.resolvedBaseMinutes,
        resolvedAgainstWorkedMinutes: day.resolvedAgainstWorkedMinutes,
        resolvedByUserId: day.resolvedByUserId,
        resolvedAt: day.resolvedAt,
        resolutionNote: day.resolutionNote,
        calculatedAt,
      });
    }
  }
  if (rows.length > MAX_COVERAGE_ROWS_PER_OPERATION) {
    throw new AppError(`La operación generaría ${rows.length} días de cobertura (máximo ${MAX_COVERAGE_ROWS_PER_OPERATION}). Cargala en partes más chicas.`, 400, "NOVELTY_COVERAGE_TOO_LARGE");
  }

  // Diferencia: se crean las filas nuevas o distintas; se borran las que
  // cambiaron o ya no corresponden. Los días de períodos protegidos (SKIP) no
  // se tocan.
  const toCreate: Prisma.NoveltyDayCoverageCreateManyInput[] = [];
  const toDelete: string[] = [];
  const changed = new Map<string, { noveltyId: string; employeeId: string; period: string }>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = rowKey(row.noveltyId, calendarDateKey(row.date as Date));
    seen.add(key);
    const existing = existingByKey.get(key);
    if (existing && rowSignature(existing) === rowSignature(row as Parameters<typeof rowSignature>[0])) continue;
    if (existing) toDelete.push(existing.id);
    toCreate.push(row);
    changed.set(key, { noveltyId: row.noveltyId, employeeId: row.employeeId, period: row.period });
  }
  for (const [key, row] of existingByKey) {
    if (seen.has(key) || isSkipped(row.noveltyId, row.employeeId, row.period)) continue;
    toDelete.push(row.id);
    changed.set(key, { noveltyId: row.noveltyId, employeeId: row.employeeId, period: row.period });
  }
  for (let index = 0; index < toDelete.length; index += CREATE_CHUNK_SIZE) {
    await db.noveltyDayCoverage.deleteMany({ where: { id: { in: toDelete.slice(index, index + CREATE_CHUNK_SIZE) } } });
  }
  for (let index = 0; index < toCreate.length; index += CREATE_CHUNK_SIZE) {
    await db.noveltyDayCoverage.createMany({ data: toCreate.slice(index, index + CREATE_CHUNK_SIZE) });
  }

  summary.novelties = active.length;
  summary.days = rows.length;
  summary.changedDays = changed.size;
  summary.changedNoveltyIds = [...new Set([...changed.values()].map((item) => item.noveltyId))];
  summary.changedPairs = uniqueEmployeePeriods(changed.values());
  return summary;
}

/**
 * Guard de una mutación que cambia lo que una novedad aporta (aprobar,
 * rechazar, eliminar, resolver un día) sobre períodos protegidos. Toma el lock
 * de cobertura del legajo y el compartido de cierre dentro de la transacción.
 * Los tipos que no registran tiempo no tienen nada que proteger.
 */
export async function assertNoveltyCoverageWritableWithin(
  db: Db,
  novelty: { employeeId: string; fromDate: Date; toDate: Date | null; noveltyType: { allowsDateRange: boolean; coverageMode: CoverageTypeConfig["coverageMode"] } },
  options: { allowCorrection: boolean; dateKey?: string; message?: string },
): Promise<EmployeePeriod[]> {
  await lockEmployeeCoverage(db, [novelty.employeeId]);
  if (novelty.noveltyType.coverageMode === "NONE") return [];
  const end = options.dateKey ? argentinaCalendarDate(options.dateKey) : noveltyCoverageEnd(novelty);
  const start = options.dateKey ? argentinaCalendarDate(options.dateKey) : novelty.fromDate;
  const protectedMap = await findProtectedClosurePeriods(db, periodPairs(novelty.employeeId, start, end));
  if (protectedMap.size && !options.allowCorrection) {
    throw new ProtectedClosurePeriodError(
      [...protectedMap.entries()].map(([key, status]) => ({ ...protectedList(new Map([[key, status]]))[0]!, status })),
      options.message ?? PROTECTED_MESSAGE,
    );
  }
  return protectedList(protectedMap);
}

// ── Trabajo real del día ────────────────────────────────────────────────────

/**
 * Minutos realmente trabajados por el legajo en una fecha, con el mismo
 * criterio que la grilla por legajo (WORKED_TIME_ACCOUNTING_MODEL.md §8):
 * Horas base NORMAL_BASE APROBADO/EN_REVISION + adicionales no rechazados,
 * descontando lo que no computa por franco (§18). Una resolución manual guarda
 * este valor: si después cambia, el día vuelve a revisión (etapa 4).
 */
export async function loadRealWorkedMinutesOnDate(db: Db, employeeId: string, dateKey: string): Promise<number> {
  const date = argentinaCalendarDate(dateKey);
  const [entries, breakdowns, dayOffs] = await Promise.all([
    db.timeEntry.findMany({
      where: { employeeId, date, status: { in: ["APROBADO", "EN_REVISION"] }, hourConcept: { systemRole: "NORMAL_BASE" } },
      select: accountingBaseEntrySelect,
    }),
    db.hourConceptBreakdown.findMany({ where: { employeeId, date, status: countedBreakdownStatusWhere }, select: accountingBreakdownSelect }),
    loadDayOffAccounting({ employeeIds: [employeeId], from: date, to: new Date(date.getTime() + DAY_MS) }, db),
  ]);
  const accounting = accountEmployeePeriod(entries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown), dayOffs);
  return accounting.totalWorkedMinutes;
}
