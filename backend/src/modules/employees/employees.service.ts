import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { storageService } from "../../shared/storage/storage.service";
import { storagePathBuilder } from "../../shared/storage/storagePathBuilder";
import { redactPiiForRole } from "../../shared/security/piiRedaction";
import { canAccessDocumentCategory } from "../../shared/security/documentCategoryAccess";
import { isMonthlyClosureLocked } from "../../shared/monthlyClosure/closureLock";
import { calendarDateKey, formatArgentinaDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";
import { roles } from "../../shared/security/roles";
import { employeeAccessWhere } from "./employeeAccess";
import { employeesRepository } from "./employees.repository";
import { resolveDoubleHourMultipliersByDate } from "../time-entries/timeEntries.repository";
import { laborHistoryService, mapLaborHistoryPersistenceError, type EmployeeLaborChanges, type RecordedHistoryChange } from "../labor-history/laborHistory.service";
import { sameIdSet } from "../labor-history/laborHistory.periods";
import { accountEmployeePeriod, toAccountingBaseEntry, toAccountingBreakdown, withinBaseCoverageMinutes, type WorkTreatment } from "../time-entries/workedTimeAccounting";
import type {
  CreateEmployeeDocumentInput,
  CreateEmployeeBlockHistoryInput,
  CreateEmployeeFieldHistoryInput,
  CreateEmployeeInput,
  CreateLaborMovementInput,
  EmployeeTimeGridQuery,
  ListEmployeeHistoryQuery,
  ListEmployeeOrgChartQuery,
  ListEmployeeOptionsQuery,
  ListEmployeesQuery,
  ReplaceEmployeeAssignmentsInput,
  ReplaceEmployeeHourConceptsInput,
  ResolveManualHourConceptBreakdownInput,
  UpdateEmployeeContactInput,
  UpdateEmployeeInput,
  UpsertEmployeeAddressInput,
  UpsertManualHourConceptBreakdownInput,
  UpsertEmployeeTransportInput,
} from "./employees.schemas";

const salaryOrder = [
  "Directorio",
  "Director",
  "Gerente General",
  "Gerente",
  "Jefe",
  "Encargado",
  "Coordinador",
  "Supervisor",
  "Administrativo A",
  "Administrativo B",
  "Administrativo C",
  "Administrativo D",
  "Operario A",
  "Operario B",
  "Operario C",
  "Operario D",
  "Especial A",
  "Especial B",
  "Especial C",
  "Especial D",
  "Especial E",
  "Especial F",
  "Especial G",
  "Especial H",
  "Especial I",
  "Especialista",
];

type PositionSalaryCategoryLink = { salaryCategory: { name: string; order: number } };

function categoryRangeFromPosition(position: { salaryCategories: PositionSalaryCategoryLink[] } | null | undefined): string[] {
  if (!position) return [];
  return [...position.salaryCategories]
    .map((link) => link.salaryCategory)
    .sort((a, b) => a.order - b.order)
    .map((category) => category.name);
}

function compareCategory(range: string[], category?: string | null) {
  if (!category) return { status: "UNKNOWN_CATEGORY", range };
  if (!range.length) return { status: "NO_RANGE", range };
  const firstCategory = range[0];
  const lastCategory = range[range.length - 1];
  if (!firstCategory || !lastCategory) return { status: "NO_RANGE", range };
  const first = salaryOrder.indexOf(firstCategory);
  const last = salaryOrder.indexOf(lastCategory);
  const current = salaryOrder.indexOf(category);
  if (current === -1) return { status: "UNKNOWN_CATEGORY", range };
  if (first === -1 || last === -1) {
    return range.includes(category) ? { status: "IN_RANGE", range } : { status: "UNKNOWN_CATEGORY", range };
  }
  const min = Math.min(first, last);
  const max = Math.max(first, last);
  if (current < min) return { status: "BELOW_RANGE", range };
  if (current > max) return { status: "ABOVE_RANGE", range };
  return { status: "IN_RANGE", range };
}

type TimeGridConcept = {
  id: string;
  code: string;
  name: string;
  kind: string;
  loadMode: string | null;
  status: string;
  systemRole: string | null;
  workTreatment: WorkTreatment | null;
};

type TimeGridEntry = {
  employeeId: string;
  day: number;
  hours: Prisma.Decimal;
  status: string;
  hourConcept: TimeGridConcept;
  // appliedMultiplier siempre es un escalar real de TimeEntry (1 por
  // default); timeSegment sólo existe para entradas del fichador.
  appliedMultiplier?: Prisma.Decimal | number | null;
  timeSegment?: {
    specialHourRuleApplications: Array<{ wasConflicting: boolean; doubleHourRule: { name: string } }>;
  } | null;
};

type TimeGridBreakdown = Parameters<typeof toAccountingBreakdown>[0] & { hourConcept: TimeGridConcept };

// Indicador de Hora Especial de un día del legajo (sólo presentación: punto y
// nombre de regla). Las horas reales/para liquidación del día viven en
// `accounting.days[day]` — una sola fuente.
export type TimeGridSpecialHourDay = {
  multiplier: number;
  ruleNames: string[];
  conflict: boolean;
};

const treatmentOrder = (concept: TimeGridConcept) => (concept.workTreatment === "WITHIN_BASE" ? 0 : 1);

/**
 * Grilla mensual por legajo (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
 * Filas: Horas base (NORMAL_BASE, editable) + un concepto por fila, primero
 * los de "Dentro de la jornada" y después las "Horas adicionales". Toda cifra
 * derivada (Horas normales residuales, total trabajado, equivalencia para
 * liquidación) sale de workedTimeAccounting, nunca de sumar filas.
 */
export function buildEmployeeTimeGrid(
  normalConcept: TimeGridConcept | null,
  enabledConcepts: TimeGridConcept[],
  entries: TimeGridEntry[],
  breakdowns: TimeGridBreakdown[],
) {
  if (!normalConcept) {
    throw new AppError("Canonical normal hour concept not found", 500, "NORMAL_HOUR_CONCEPT_NOT_FOUND");
  }

  // Horas base = TimeEntry NORMAL_BASE APROBADO/EN_REVISION (criterio vigente).
  const baseEntries = entries.filter((entry) => entry.hourConcept.systemRole === "NORMAL_BASE" && ["APROBADO", "EN_REVISION"].includes(entry.status));
  const accounting = accountEmployeePeriod(baseEntries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown));

  const ruleInfoByDay = new Map<string, { ruleNames: string[]; conflict: boolean }>();
  for (const entry of baseEntries) {
    if (Number(entry.appliedMultiplier ?? 1) <= 1) continue;
    const key = String(entry.day);
    const current = ruleInfoByDay.get(key) ?? { ruleNames: [], conflict: false };
    for (const application of entry.timeSegment?.specialHourRuleApplications ?? []) {
      if (!current.ruleNames.includes(application.doubleHourRule.name)) current.ruleNames.push(application.doubleHourRule.name);
      if (application.wasConflicting) current.conflict = true;
    }
    ruleInfoByDay.set(key, current);
  }
  const specialHoursByDay: Record<string, TimeGridSpecialHourDay> = {};
  for (const [day, dayAccounting] of Object.entries(accounting.days)) {
    if (dayAccounting.multiplier <= 1) continue;
    specialHoursByDay[day] = { multiplier: dayAccounting.multiplier, ruleNames: ruleInfoByDay.get(day)?.ruleNames ?? [], conflict: ruleInfoByDay.get(day)?.conflict ?? false };
  }

  const minutesByConcept = new Map<string, Record<string, number>>();
  const conceptsWithHours = new Map<string, TimeGridConcept>();
  for (const breakdown of breakdowns) {
    const byDay = minutesByConcept.get(breakdown.hourConceptId) ?? {};
    const key = String(breakdown.day);
    byDay[key] = (byDay[key] ?? 0) + breakdown.minutes;
    minutesByConcept.set(breakdown.hourConceptId, byDay);
    conceptsWithHours.set(breakdown.hourConceptId, breakdown.hourConcept);
  }
  const normalMinutesByDay: Record<string, number> = {};
  for (const [day, dayAccounting] of Object.entries(accounting.days)) {
    if (dayAccounting.baseMinutes) normalMinutesByDay[day] = dayAccounting.baseMinutes;
  }

  const toRow = (concept: TimeGridConcept, role: "NORMAL_BASE" | "ADDITIONAL", minutesByDay: Record<string, number>, enabled: boolean) => ({
    concept,
    role,
    // Un concepto con horas en el período que hoy ya no está habilitado se
    // sigue mostrando (sólo lectura) para que la grilla explique el total.
    enabled,
    minutesByDay,
    totalMinutes: Object.values(minutesByDay).reduce((sum, minutes) => sum + minutes, 0),
  });
  const enabledIds = new Set<string>();
  const additionalConcepts: TimeGridConcept[] = [];
  for (const concept of enabledConcepts) {
    if (concept.systemRole !== null || concept.loadMode === null || enabledIds.has(concept.id)) continue;
    enabledIds.add(concept.id);
    additionalConcepts.push(concept);
  }
  for (const concept of conceptsWithHours.values()) {
    if (!enabledIds.has(concept.id)) additionalConcepts.push(concept);
  }
  const additionalRows = additionalConcepts
    .map((concept, index) => ({ concept, index }))
    .sort((a, b) => treatmentOrder(a.concept) - treatmentOrder(b.concept) || a.index - b.index)
    .map(({ concept }) => toRow(concept, "ADDITIONAL", minutesByConcept.get(concept.id) ?? {}, enabledIds.has(concept.id)));

  return {
    rows: [toRow(normalConcept, "NORMAL_BASE", normalMinutesByDay, true), ...additionalRows],
    accounting,
    totalWorkedMinutes: accounting.totalWorkedMinutes,
    specialHoursByDay,
  };
}

async function validateManualBreakdownContext(
  employeeId: string,
  hourConceptId: string,
  period: string,
  user: Express.AuthUser,
  correctionReason?: string | null,
) {
  const employee = await employeesRepository.findEmployeeForManualBreakdown(employeeId, employeeAccessWhere(user));
  if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");

  const concept = await employeesRepository.findHourConceptForManualBreakdown(hourConceptId);
  if (!concept) throw new AppError("Hour concept not found", 404, "HOUR_CONCEPT_NOT_FOUND");
  if (concept.systemRole === "NORMAL_BASE") throw new AppError("Normal cannot be loaded as a breakdown", 409, "NORMAL_BREAKDOWN_NOT_ALLOWED");
  if (concept.status !== "ACTIVO") throw new AppError("Hour concept is inactive", 409, "HOUR_CONCEPT_INACTIVE");
  if (!concept.loadMode) throw new AppError("Hour concept has no load mode", 409, "HOUR_CONCEPT_LOAD_MODE_REQUIRED");
  if (concept.loadMode === "AUTOMATIC") throw new AppError("Automatic concepts are read-only", 409, "MANUAL_BREAKDOWN_NOT_ALLOWED");
  if (!await employeesRepository.isHourConceptEnabled(employeeId, hourConceptId)) {
    throw new AppError("Hour concept is not enabled for this employee", 409, "HOUR_CONCEPT_NOT_ENABLED");
  }

  // Etapa 15E (docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md): alineado con
  // TimeEntry.update() — un período cerrado seguía bloqueando la carga
  // manual para TODOS los roles, RRHH incluido, sin ninguna vía de
  // corrección (inconsistencia directa: TimeEntry ya permitía a RRHH
  // corregir con motivo, el desglose no). RRHH ahora puede corregir directo
  // con motivo obligatorio (reutiliza el campo `observation` ya existente,
  // sin agregar ningún campo nuevo al schema); Nivel 2/3 siguen bloqueados
  // sin excepción, igual que antes.
  const closure = await employeesRepository.findMonthlyClosure(employeeId, period);
  if (isMonthlyClosureLocked(closure)) {
    if (user.role !== roles.rrhh) {
      throw new AppError("The period is closed for direct editing", 409, "PERIOD_CLOSED");
    }
    if (!correctionReason || !correctionReason.trim()) {
      throw new AppError(
        "Indicá el motivo de la corrección del desglose manual.",
        400,
        "HOUR_CONCEPT_BREAKDOWN_CORRECTION_REASON_REQUIRED",
      );
    }
  }
  return { employee, concept };
}

function formatMinutesEs(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: un concepto "dentro de la
// jornada" clasifica minutos que ya están en las Horas base de ese día — sin
// base no se convierte en horas adicionales, y su cobertura (unión con los
// demás conceptos dentro de la jornada) nunca puede superar la base.
// Independiente de loadMode: aplica igual a un concepto BOTH corregido a mano.
async function assertWithinBaseFits(employeeId: string, date: Date, concept: { id: string; name: string }, minutes: number, dateKey: string) {
  const context = await employeesRepository.findWithinBaseDayContext(employeeId, date, concept.id);
  if (context.baseMinutes <= 0) {
    throw new AppError(
      `No se puede cargar ${concept.name} dentro de la jornada porque no hay horas base registradas para ese día.`,
      409,
      "WITHIN_BASE_REQUIRES_BASE_HOURS",
    );
  }
  const coverage = withinBaseCoverageMinutes([
    ...context.withinBaseBreakdowns.map((breakdown) => ({ ...breakdown, treatment: "WITHIN_BASE" as const })),
    { treatment: "WITHIN_BASE", minutes },
  ]);
  if (coverage > context.baseMinutes) {
    throw new AppError(
      `Las horas dentro de la jornada del ${formatArgentinaDate(dateKey)} (${formatMinutesEs(coverage)}) superan las horas base registradas (${formatMinutesEs(context.baseMinutes)}).`,
      409,
      "WITHIN_BASE_EXCEEDS_BASE_HOURS",
    );
  }
}

// Etapa 6L.3 (ajuste): igual que TimeEntry, la aprobación final de un
// desglose manual es exclusiva de RRHH — Nivel 2/3 pueden cargarlo pero no
// resolverlo (aprobar/rechazar/devolver), ni propio ni ajeno.
function assertCanResolveManualBreakdown(user: Express.AuthUser) {
  if (user.role !== roles.rrhh) {
    throw new AppError("Sólo RRHH puede aprobar, rechazar o devolver desgloses manuales.", 403, "FORBIDDEN");
  }
}

async function findResolvableManualBreakdown(employeeId: string, breakdownId: string, user: Express.AuthUser) {
  const before = await employeesRepository.findManualBreakdownById(breakdownId, employeeAccessWhere(user));
  if (!before || before.employeeId !== employeeId) {
    throw new AppError("Desglose manual no encontrado", 404, "HOUR_CONCEPT_BREAKDOWN_NOT_FOUND");
  }
  if (before.status !== "EN_REVISION") {
    throw new AppError("Sólo se pueden resolver desgloses manuales en revisión.", 400, "HOUR_CONCEPT_BREAKDOWN_STATUS_NOT_RESOLVABLE");
  }
  return before;
}

function isManualBreakdownConcurrencyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
}

async function saveManualBreakdownWithRetry(input: Parameters<typeof employeesRepository.saveManualHourConceptBreakdown>[0]) {
  try {
    return await employeesRepository.saveManualHourConceptBreakdown(input);
  } catch (error) {
    if (!isManualBreakdownConcurrencyError(error)) throw error;
    try {
      return await employeesRepository.saveManualHourConceptBreakdown(input);
    } catch (retryError) {
      if (isManualBreakdownConcurrencyError(retryError)) {
        throw new AppError("Concurrent manual breakdown update; retry the operation", 409, "MANUAL_BREAKDOWN_CONCURRENT_CONFLICT");
      }
      throw retryError;
    }
  }
}

function structureCheck(label: string, value: string, allowed: string[], hasPosition: boolean) {
  return {
    label,
    value: value || "Sin cargar",
    allowed,
    ok: !hasPosition || !allowed.length || allowed.includes(value),
    missing: !value,
  };
}

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Employee unique field already exists", 409, "EMPLOYEE_UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    }
    if (error.code === "P2003") {
      throw new AppError("Related record not found or cannot be used", 400, "RELATION_CONSTRAINT");
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

function bufferFromBase64(value?: string | null) {
  if (!value) return undefined;
  const base64 = value.includes(",") ? value.split(",").pop() : value;
  if (!base64) return undefined;
  return Buffer.from(base64, "base64");
}

async function ensureUniqueEmployee(input: CreateEmployeeInput) {
  const existing = await employeesRepository.findByUniqueFields(input);
  if (!existing) return;
  throw new AppError("Employee with same legajo, Legajo Finnegans, CUIL or DNI already exists", 409, "EMPLOYEE_ALREADY_EXISTS", existing);
}

async function ensureNoEmployeeConflict(id: string, input: UpdateEmployeeInput) {
  const existing = await employeesRepository.findConflictingUniqueFields(id, input);
  if (!existing) return;
  throw new AppError("Employee with same legajo, Legajo Finnegans, CUIL or DNI already exists", 409, "EMPLOYEE_ALREADY_EXISTS", existing);
}

// A6 (ORG_LOCATION_REORGANIZATION.md §3.3): el alcance organizacional se lee
// del puesto. Para ASIGNAR un puesto nuevo, éste tiene que estar activo y
// tener alcance; un legajo que conserva su puesto anterior (pendiente de
// recarga) sigue pudiendo editar el resto de sus datos.
//
// Con `tx`, la comprobación es la AUTORITATIVA: corre dentro de la transacción
// del guardado, contra el puesto vigente del legajo leído en ella y con la
// fila del puesto bloqueada (FOR SHARE). Sin `tx` es sólo el rechazo temprano
// previo a abrir la transacción.
async function assertAssignablePosition(positionId: string | null | undefined, currentPositionId: string | null, tx?: PrismaTransactionClient) {
  if (!positionId || positionId === currentPositionId) return;
  const position = tx
    ? await employeesRepository.findPositionForAssignmentWithin(tx, positionId)
    : await employeesRepository.findPositionForAssignment(positionId);
  if (!position) throw new AppError("El puesto seleccionado no existe.", 400, "EMPLOYEE_POSITION_INVALID");
  // A8 §12.4: un puesto archivado no puede ser destino de una asignación.
  if (position.archivedAt) {
    throw new AppError(`El puesto “${position.name}” está archivado y no puede asignarse.`, 400, "EMPLOYEE_POSITION_ARCHIVED");
  }
  if (position.status !== "ACTIVO") {
    throw new AppError(`El puesto “${position.name}” está inactivo y no puede asignarse.`, 409, "EMPLOYEE_POSITION_INACTIVE");
  }
  if (!position._count.orgScopes) {
    throw new AppError(
      `El puesto “${position.name}” está pendiente de recarga: todavía no tiene alcance organizacional. Cargá su alcance en Puestos antes de asignarlo.`,
      409,
      "EMPLOYEE_POSITION_PENDING_SCOPE",
    );
  }
}

// A8 §12.4: un vínculo NUEVO de empresa empleadora no puede apuntar a un
// registro archivado. Sólo se validan las empresas que el legajo no tenía
// (`currentCompanyIds`): conservar sin cambios un vínculo preexistente no
// exige requisitos nuevos. Con `tx` la comprobación es la AUTORITATIVA: corre
// en la transacción del guardado, contra los vínculos leídos en ella y con las
// empresas bloqueadas (FOR SHARE); sin `tx` es el rechazo temprano.
async function assertAssignableCompanies(companyIds?: Array<string | null>, currentCompanyIds: string[] = [], tx?: PrismaTransactionClient) {
  const ids = Array.from(new Set((companyIds || []).filter((id): id is string => Boolean(id)))).filter((id) => !currentCompanyIds.includes(id));
  if (!ids.length) return;
  const archived = tx ? await employeesRepository.findArchivedCompanyNamesWithin(tx, ids) : await employeesRepository.findArchivedCompanyNames(ids);
  if (archived.length) {
    throw new AppError(`No se puede vincular el legajo a un registro archivado: ${archived.join(", ")}.`, 400, "EMPLOYEE_COMPANY_ARCHIVED");
  }
}

// A6: `Employee.sectorId` pertenece al modelo anterior. Se conserva para
// consulta, pero no se asigna ni se cambia: el alcance sale del puesto y no se
// copia al legajo. Reenviar el mismo valor (o no enviarlo) es válido.
function assertLegacySectorUnchanged(sectorId: string | null | undefined, currentSectorId: string | null) {
  if (sectorId === undefined || (sectorId || null) === currentSectorId) return;
  throw new AppError(
    "El sector del legajo pertenece a la estructura anterior y es de solo lectura. El alcance organizacional se obtiene del puesto asignado.",
    409,
    "EMPLOYEE_LEGACY_SECTOR_READ_ONLY",
  );
}

async function assertAssignableHourConceptIds(hourConceptIds: string[]) {
  const uniqueIds = Array.from(new Set(hourConceptIds.filter(Boolean)));
  if (!uniqueIds.length) return uniqueIds;
  const assignable = await employeesRepository.findAssignableHourConceptIds(uniqueIds);
  if (assignable.length !== uniqueIds.length) {
    throw new AppError(
      "Sólo se pueden asignar conceptos horarios adicionales activos",
      409,
      "HOUR_CONCEPT_NOT_ASSIGNABLE",
    );
  }
  return uniqueIds;
}

function comparableValue(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "toString" in value) return String(value);
  return value;
}

function sameAddress(
  input: NonNullable<UpdateEmployeeInput["address"]>,
  current: Record<string, unknown> | null,
) {
  if (!current) return false;
  return Object.entries(input).every(([key, value]) => {
    const currentValue = current[key];
    if (key === "latitude" || key === "longitude") {
      const desiredCoordinate = value === undefined ? undefined : value === null ? null : Number(value);
      const currentCoordinate = currentValue === undefined ? undefined : currentValue === null ? null : Number(currentValue);
      return desiredCoordinate === currentCoordinate;
    }
    return comparableValue(value) === comparableValue(currentValue);
  });
}

function sameCompanies(
  input: UpdateEmployeeInput,
  current: Array<{ companyId: string; isPrimary: boolean }>,
) {
  if (input.companyIds === undefined && input.primaryCompanyId === undefined) return false;
  const desired = desiredCompanies(input);
  const existing = [...current].sort((a, b) => a.companyId.localeCompare(b.companyId));
  return desired.length === existing.length
    && desired.every((item, index) => item.companyId === existing[index]?.companyId && item.isPrimary === existing[index]?.isPrimary);
}

function desiredCompanies(input: UpdateEmployeeInput) {
  const uniqueIds = Array.from(new Set((input.companyIds || []).filter(Boolean)));
  return uniqueIds
    .map((companyId, index) => ({
      companyId,
      isPrimary: input.primaryCompanyId ? companyId === input.primaryCompanyId : index === 0,
    }))
    .sort((a, b) => a.companyId.localeCompare(b.companyId));
}

type LaborSnapshot = { positionId: string | null; costCenterId: string | null; companies: Array<{ companyId: string }> };

/**
 * D-5: dimensiones del motor que cambian con este guardado, comparadas contra
 * la columna vigente. La empresa principal no es una entrada del motor: sólo
 * cuenta el conjunto de empresas empleadoras.
 */
function laborChangesOf(input: UpdateEmployeeInput, current: LaborSnapshot): EmployeeLaborChanges {
  const changes: EmployeeLaborChanges = {};
  if (input.positionId !== undefined && (input.positionId || null) !== current.positionId) changes.positionId = input.positionId || null;
  if (input.costCenterId !== undefined && (input.costCenterId || null) !== current.costCenterId) changes.costCenterId = input.costCenterId || null;
  if (input.companyIds !== undefined || input.primaryCompanyId !== undefined) {
    const companyIds = Array.from(new Set((input.companyIds || []).filter(Boolean))).sort();
    if (!sameIdSet(companyIds, current.companies.map((link) => link.companyId))) changes.companyIds = companyIds;
  }
  return changes;
}

const hasLaborChanges = (changes: EmployeeLaborChanges) => Object.keys(changes).length > 0;

function assertLaborChangeProvided(changes: EmployeeLaborChanges, laborChange: UpdateEmployeeInput["laborChange"]) {
  if (!hasLaborChanges(changes) || laborChange) return;
  throw new AppError(
    "Para cambiar el puesto, el centro de costo o las empresas empleadoras indicá la fecha desde la que rige y el motivo del cambio.",
    400,
    "EMPLOYEE_LABOR_CHANGE_DATE_REQUIRED",
  );
}

// Historial visible de Datos Laborales: los mismos campos y textos que antes
// escribía el cliente en una segunda llamada, ahora en la transacción del cambio.
async function recordLaborFieldHistoryWithin(
  tx: Parameters<Parameters<typeof employeesRepository.transaction>[0]>[0],
  employeeId: string,
  current: LaborSnapshot,
  changes: EmployeeLaborChanges,
  laborChange: NonNullable<UpdateEmployeeInput["laborChange"]>,
  createdByUserId: string | null,
) {
  const names = await employeesRepository.findLaborNamesWithin(tx, {
    positionIds: [current.positionId, changes.positionId].filter((id): id is string => Boolean(id)),
    costCenterIds: [current.costCenterId, changes.costCenterId].filter((id): id is string => Boolean(id)),
    companyIds: [...current.companies.map((link) => link.companyId), ...(changes.companyIds ?? [])],
  });
  const companyNames = (ids: string[]) => ids.map((id) => names.companies.get(id) ?? "Empresa sin nombre").sort((a, b) => a.localeCompare(b, "es")).join(", ");
  const entries: Array<{ field: string; fieldLabel: string; oldValue: string | null; newValue: string }> = [];
  if (changes.positionId !== undefined) {
    entries.push({
      field: "positionId",
      fieldLabel: "Puesto",
      oldValue: current.positionId ? names.positions.get(current.positionId) ?? null : null,
      newValue: changes.positionId ? names.positions.get(changes.positionId) ?? "Puesto sin nombre" : "Sin puesto vinculado",
    });
  }
  if (changes.costCenterId !== undefined) {
    entries.push({
      field: "costCenter",
      fieldLabel: "Centro de costo",
      oldValue: current.costCenterId ? names.costCenters.get(current.costCenterId) ?? null : null,
      newValue: changes.costCenterId ? names.costCenters.get(changes.costCenterId) ?? "Centro de costo sin nombre" : "Sin centro de costo",
    });
  }
  if (changes.companyIds !== undefined) {
    entries.push({
      field: "companies",
      fieldLabel: "Empresa",
      oldValue: companyNames(current.companies.map((link) => link.companyId)) || null,
      newValue: companyNames(changes.companyIds) || "Sin empresa empleadora",
    });
  }
  for (const entry of entries) {
    await employeesRepository.createFieldHistoryWithin(tx, employeeId, { ...entry, effectiveFrom: laborChange.effectiveFrom, reason: laborChange.reason }, createdByUserId);
  }
  return entries;
}

// Fecha desde la que rige la historia de un legajo nuevo: el ingreso declarado
// (movimiento inicial ALTA) o, sin él, el día del alta en el sistema.
function initialHistoryDate(input: CreateEmployeeInput) {
  return input.initialLaborMovement?.type === "ALTA" ? calendarDateKey(input.initialLaborMovement.effectiveFrom) : todayArgentinaDateKey();
}

async function inLaborTransaction<T>(operation: Parameters<typeof employeesRepository.transaction<T>>[0]) {
  try {
    return await employeesRepository.transaction(operation);
  } catch (error) {
    mapLaborHistoryPersistenceError(error);
    throw error;
  }
}

function omitUnchangedEmployeeRelations(
  input: UpdateEmployeeInput,
  before: { address: Record<string, unknown> | null; companies: Array<{ companyId: string; isPrimary: boolean }> },
) {
  const effectiveInput = { ...input };
  if (input.address && sameAddress(input.address, before.address)) delete effectiveInput.address;
  if (sameCompanies(input, before.companies)) {
    delete effectiveInput.companyIds;
    delete effectiveInput.primaryCompanyId;
  }
  return effectiveInput;
}

export const employeesService = {
  async list(query: ListEmployeesQuery, user: Express.AuthUser) {
    const [items, total] = await employeesRepository.findMany(query, employeeAccessWhere(user));
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

  summary(user: Express.AuthUser) {
    return employeesRepository.summary(employeeAccessWhere(user));
  },

  async listOrgChart(query: ListEmployeeOrgChartQuery, user: Express.AuthUser) {
    const accessWhere = employeeAccessWhere(user);
    const [items, total] = await employeesRepository.findOrgChart(query, accessWhere);
    const contextItems = await employeesRepository.findOrgChartManagerContext(items, accessWhere);
    return {
      items,
      contextItems,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async listOptions(query: ListEmployeeOptionsQuery, user: Express.AuthUser) {
    const [items, total] = await employeesRepository.findOptions(query, employeeAccessWhere(user));
    return {
      items: redactPiiForRole(items, user),
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async getById(id: string, user?: Express.AuthUser) {
    const employee = await employeesRepository.findById(id, user ? employeeAccessWhere(user) : {});
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return employee;
  },

  // Etapa 14C.3: variante liviana de `getById` para llamadores que sólo
  // necesitan confirmar existencia + alcance (404/permiso), sin cargar el
  // detalle completo del legajo. Ver `employeesRepository.existsWithAccess`.
  async assertAccessible(id: string, user?: Express.AuthUser) {
    const exists = await employeesRepository.existsWithAccess(id, user ? employeeAccessWhere(user) : {});
    if (!exists) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
  },

  async getOverviewById(id: string, user: Express.AuthUser) {
    const employee = await employeesRepository.findOverviewById(id, employeeAccessWhere(user));
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return employee;
  },

  async getOverviewDetailsById(id: string, user: Express.AuthUser) {
    const employee = await employeesRepository.findOverviewDetailsById(id, employeeAccessWhere(user));
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return employee;
  },

  async getTimeGrid(id: string, query: EmployeeTimeGridQuery, user: Express.AuthUser) {
    const grid = await employeesRepository.findTimeGrid(id, query, employeeAccessWhere(user));
    if (!grid) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    const timeGrid = buildEmployeeTimeGrid(
      grid.normalConcept,
      grid.employee.hourConcepts.map((link) => link.hourConcept),
      grid.entries,
      grid.breakdowns,
    );
    return redactPiiForRole({ ...grid, ...timeGrid }, user);
  },

  async upsertManualHourConceptBreakdown(
    employeeId: string,
    input: UpsertManualHourConceptBreakdownInput,
    user: Express.AuthUser,
    audit?: AuditContext,
  ) {
    const period = input.date.slice(0, 7);
    const date = new Date(`${input.date}T00:00:00.000Z`);
    const day = Number(input.date.slice(8, 10));
    const { employee, concept } = await validateManualBreakdownContext(employeeId, input.hourConceptId, period, user, input.observation);
    if (input.minutes > 0 && concept.workTreatment === "WITHIN_BASE") {
      await assertWithinBaseFits(employeeId, date, concept, input.minutes, input.date);
    }
    // Snapshot del multiplicador de Hora Especial de la fecha (mismo motor y
    // misma filosofía que TimeEntry.appliedMultiplier): un Colectivo de
    // domingo conserva x2 aunque ese día no haya Horas base.
    const appliedMultiplier = input.minutes > 0
      ? (await resolveDoubleHourMultipliersByDate(employeeId, [date])).get(input.date) ?? 1
      : 1;
    // Etapa 6L.3: mismo criterio que TimeEntry — RRHH aplica el desglose
    // directo (APROBADO); Nivel 2/3 lo dejan pendiente de revisión.
    const autoApprovedByUserId = user.role === roles.rrhh ? user.id : null;
    const result = await saveManualBreakdownWithRetry({
      employeeId,
      hourConceptId: input.hourConceptId,
      date,
      period,
      day,
      minutes: input.minutes,
      appliedMultiplier,
      observation: input.observation,
      createdByUserId: user.id,
      approvedByUserId: autoApprovedByUserId,
    });
    await auditService.register({
      ...audit,
      action: result.operation,
      entity: "HourConceptBreakdown",
      entityId: result.item?.id || null,
      description: `${result.operation === "DELETE" ? "Se eliminó" : autoApprovedByUserId ? "Se guardó y aplicó (RRHH)" : "Se guardó"} ` +
        `el desglose manual ${concept.name} del ${formatArgentinaDate(input.date)} para ${formatEmployeeReference(employee)}.`,
      after: result.item as Prisma.InputJsonValue | undefined,
    });
    return result.item;
  },

  // Etapa 6L.3 (ajuste): approve/reject/return para HourConceptBreakdown
  // manual EN_REVISION — mismo patrón que timeEntriesService.approve/reject/
  // returnForCorrection, exclusivo de RRHH.
  async approveManualHourConceptBreakdown(employeeId: string, breakdownId: string, user: Express.AuthUser, audit?: AuditContext) {
    assertCanResolveManualBreakdown(user);
    const before = await findResolvableManualBreakdown(employeeId, breakdownId, user);
    const item = await employeesRepository.approveManualHourConceptBreakdown(breakdownId, user.id);
    await auditService.register({
      ...audit,
      action: "APPROVE",
      entity: "HourConceptBreakdown",
      entityId: item.id,
      description: `Se aprobó el desglose manual ${item.hourConcept.name} de ${formatEmployeeReference(item.employee)}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async rejectManualHourConceptBreakdown(employeeId: string, breakdownId: string, input: ResolveManualHourConceptBreakdownInput, user: Express.AuthUser, audit?: AuditContext) {
    assertCanResolveManualBreakdown(user);
    const before = await findResolvableManualBreakdown(employeeId, breakdownId, user);
    const item = await employeesRepository.rejectManualHourConceptBreakdown(breakdownId);
    await auditService.register({
      ...audit,
      action: "REJECT",
      entity: "HourConceptBreakdown",
      entityId: item.id,
      description: `Se rechazó el desglose manual ${item.hourConcept.name} de ${formatEmployeeReference(item.employee)}. Motivo: ${input.reason}`,
      before: before as Prisma.InputJsonValue,
      after: { item, reason: input.reason } as Prisma.InputJsonValue,
    });
    return item;
  },

  async returnManualHourConceptBreakdown(employeeId: string, breakdownId: string, input: ResolveManualHourConceptBreakdownInput, user: Express.AuthUser, audit?: AuditContext) {
    assertCanResolveManualBreakdown(user);
    const before = await findResolvableManualBreakdown(employeeId, breakdownId, user);
    const item = await employeesRepository.returnManualHourConceptBreakdown(breakdownId);
    await auditService.register({
      ...audit,
      action: "RETURN",
      entity: "HourConceptBreakdown",
      entityId: item.id,
      description: `Se devolvió el desglose manual ${item.hourConcept.name} de ${formatEmployeeReference(item.employee)}. Motivo: ${input.reason}`,
      before: before as Prisma.InputJsonValue,
      after: { item, reason: input.reason } as Prisma.InputJsonValue,
    });
    return item;
  },

  // Etapa 14D.2: `getById` (detalle completo — núcleo con cadena
  // sector/position de 4 niveles + 6 `findMany` batch) → select dedicado
  // (`findPositionValidationById`, sólo `internalCategory`/`sector`/
  // `position`, sin ninguna de las 6 relaciones batch) — mismo mecanismo ya
  // usado en `assertAccessible` (14C.3). Causa real de los 12825ms
  // máx/9978ms promedio medidos en 14D.1: el resto del legajo (documentos,
  // movimientos laborales, asignaciones, conceptos horarios, novedades,
  // empresas) nunca se lee acá — ver diagnóstico completo en
  // docs/decisions/EMPLOYEE_LABOR_DATA_PERFORMANCE_14D2.md.
  //
  // Etapa 14D.2.1: `positionId` opcional (el frontend ya lo conoce, viene de
  // `overview-details`) — cuando se pasa, `findPositionValidationById`
  // resuelve la cadena del empleado y la del puesto en paralelo en vez de
  // en un único `findFirst` con las 2 cadenas anidadas (6112ms máx medido en
  // 14D.2 → ver docs/decisions/POSITION_VALIDATION_PERFORMANCE_14D2_1.md
  // para el número real después de este cambio). Sin el parámetro, se
  // preserva el comportamiento exacto de 14D.2 (compatibilidad hacia atrás).
  async getPositionValidation(id: string, user: Express.AuthUser, positionId?: string) {
    const employee = await employeesRepository.findPositionValidationById(id, employeeAccessWhere(user), positionId);
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    const position = employee.position;
    const businessUnit = employee.sector?.area?.establishment?.businessUnit?.name || "";
    const establishment = employee.sector?.area?.establishment?.name || "";
    const sector = employee.sector?.name || "";
    // Fuente de verdad desde el saneamiento de Puestos (2026-08-18):
    // sectorId es el unico origen oficial de ubicacion del puesto. Area,
    // establecimiento y unidad de negocio se derivan de esa cadena real
    // (position.sector.area.establishment.businessUnit) en vez de los
    // strings/JSON legado (areaDepartment, sectorName, businessUnitNames...).
    // A6: con alcance A5, la estructura sale del puesto y no se compara contra
    // datos propios del legajo (no hay sector único que exigir). Un puesto
    // sin alcance (anterior) conserva su comparación de consulta y queda
    // pendiente de recarga.
    const positionPendingScope = Boolean(position) && !position?._count.orgScopes;
    const positionBusinessUnit = position?.sector?.area?.establishment?.businessUnit?.name || "";
    const positionEstablishment = position?.sector?.area?.establishment?.name || "";
    const positionSector = position?.sector?.name || "";
    const range = categoryRangeFromPosition(position);
    const categoryResult = position ? compareCategory(range, employee.internalCategory) : { status: "NO_POSITION", range: [] };
    const checks = positionPendingScope
      ? [
          structureCheck("Unidad de negocio", businessUnit, positionBusinessUnit ? [positionBusinessUnit] : [], true),
          structureCheck("Establecimiento", establishment, positionEstablishment ? [positionEstablishment] : [], true),
          structureCheck("Sector", sector, positionSector ? [positionSector] : [], true),
        ]
      : [];
    const structuralMismatch = checks.some((row) => row.allowed.length && !row.ok && !row.missing);
    const categoryMismatch = ["BELOW_RANGE", "ABOVE_RANGE", "UNKNOWN_CATEGORY"].includes(categoryResult.status);
    const categoryPending = ["NO_POSITION", "NO_RANGE"].includes(categoryResult.status) || !employee.internalCategory;
    const tone = !position
      ? "neutral"
      : structuralMismatch || categoryMismatch
        ? "danger"
        : categoryPending || positionPendingScope || checks.some((row) => row.missing)
          ? "warning"
          : "success";
    const title = !position
      ? "Puesto sin seleccionar"
      : tone === "success"
        ? "Datos laborales dentro del puesto"
        : tone === "danger"
          ? "Hay datos fuera del puesto"
          : positionPendingScope
            ? "Puesto pendiente de recarga"
            : "Validacion pendiente";
    const categoryTextByStatus: Record<string, string> = {
      IN_RANGE: `${employee.internalCategory || "La categoria interna"} esta dentro del rango salarial.`,
      BELOW_RANGE: `${employee.internalCategory || "La categoria interna"} esta por debajo del rango salarial.`,
      ABOVE_RANGE: `${employee.internalCategory || "La categoria interna"} esta por encima del rango salarial.`,
      NO_POSITION: "No hay puesto seleccionado. Se puede guardar igual; la validacion queda pendiente.",
      NO_RANGE: "El puesto no tiene rango salarial configurado.",
      UNKNOWN_CATEGORY: "La categoria interna no se encuentra en el catalogo salarial.",
    };

    return {
      tone,
      title,
      categoryText: categoryTextByStatus[categoryResult.status],
      checks,
      category: {
        status: categoryResult.status,
        value: employee.internalCategory || "Sin cargar",
        range: categoryResult.range,
      },
    };
  },

  async create(input: CreateEmployeeInput, audit?: AuditContext) {
    assertLegacySectorUnchanged(input.sectorId, null);
    await ensureUniqueEmployee(input);
    await assertAssignablePosition(input.positionId, null);
    await assertAssignableCompanies(input.companyIds);
    const hourConceptIds = await assertAssignableHourConceptIds(input.hourConceptIds ?? []);
    const historyFrom = initialHistoryDate(input);
    // D-5: legajo, historia temporal inicial y auditoría en una transacción.
    const employee = await execute(() => inLaborTransaction(async (tx) => {
      await assertAssignablePosition(input.positionId, null, tx);
      await assertAssignableCompanies(input.companyIds, [], tx);
      const created = await employeesRepository.create({ ...input, hourConceptIds }, audit?.userId, tx);
      await laborHistoryService.openEmployeeHistoryWithin(tx, {
        employeeId: created.id,
        effectiveFrom: historyFrom,
        positionId: input.positionId || null,
        costCenterId: input.costCenterId || null,
        companyIds: input.companyIds,
        reason: "Alta del legajo",
        createdByUserId: audit?.userId || null,
      });
      await auditService.registerWithin(tx, {
        ...audit,
        action: "CREATE",
        entity: "Employee",
        entityId: created.id,
        description: `Se creo el legajo ${created.legajo} - ${created.lastName}, ${created.firstName}. Historia laboral desde el ${formatArgentinaDate(historyFrom)}.`,
        after: { ...created, laborHistoryFrom: historyFrom } as Prisma.InputJsonValue,
      });
      return created;
    }));
    clearAuditDerivedCaches();
    return employee;
  },

  async update(id: string, input: UpdateEmployeeInput, audit?: AuditContext) {
    const { laborChange, ...fields } = input;
    const [, snapshot] = await Promise.all([
      ensureNoEmployeeConflict(id, fields),
      employeesRepository.findUpdateAuditSnapshot(id),
    ]);
    if (!snapshot) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    assertLegacySectorUnchanged(fields.sectorId, snapshot.sectorId);
    await assertAssignablePosition(fields.positionId, snapshot.positionId);
    const effectiveInput = omitUnchangedEmployeeRelations(fields, snapshot);
    await assertAssignableCompanies(effectiveInput.companyIds, snapshot.companies.map((company) => company.companyId));
    assertLaborChangeProvided(laborChangesOf(effectiveInput, snapshot), laborChange);
    // D-5: columna vigente, historia temporal desde la fecha indicada,
    // historial visible y auditoría en una sola transacción. El estado previo
    // se relee dentro de ella para comparar contra lo que realmente se reemplaza.
    const employee = await execute(() => inLaborTransaction(async (tx) => {
      const before = await employeesRepository.findUpdateAuditSnapshot(id, tx);
      if (!before) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
      // Revalidación autoritativa contra el puesto y las empresas vigentes
      // leídos en esta transacción, ANTES de cualquier escritura: conservar lo
      // que el legajo ya tiene no exige los requisitos de una asignación nueva.
      await assertAssignablePosition(fields.positionId, before.positionId, tx);
      if (effectiveInput.companyIds !== undefined) await assertAssignableCompanies(effectiveInput.companyIds, before.companies.map((company) => company.companyId), tx);
      const changes = laborChangesOf(effectiveInput, before);
      assertLaborChangeProvided(changes, laborChange);
      const updated = await employeesRepository.update(id, effectiveInput, tx);
      let laborHistory: RecordedHistoryChange[] = [];
      let laborFields: Array<{ fieldLabel: string; oldValue: string | null; newValue: string }> = [];
      if (laborChange && hasLaborChanges(changes)) {
        laborHistory = await laborHistoryService.recordEmployeeChangesWithin(tx, {
          employeeId: id,
          effectiveFrom: laborChange.effectiveFrom,
          reason: laborChange.reason,
          createdByUserId: audit?.userId || null,
          changes,
        });
        laborFields = await recordLaborFieldHistoryWithin(tx, id, before, changes, laborChange, audit?.userId || null);
      }
      const after = {
        ...before,
        ...updated,
        address: fields.address ? { ...(before.address || {}), ...fields.address } : before.address,
        companies:
          fields.companyIds !== undefined || fields.primaryCompanyId !== undefined
            ? desiredCompanies(fields)
            : before.companies,
        ...(laborFields.length ? { laborChange, laborHistory } : {}),
      };
      const laborSummary = laborFields.length
        ? ` Datos laborales desde el ${formatArgentinaDate(laborChange!.effectiveFrom)}: ${laborFields.map((entry) => `${entry.fieldLabel} ${entry.oldValue || "sin dato"} → ${entry.newValue}`).join("; ")}. Motivo: ${laborChange!.reason}`
        : "";
      await auditService.registerWithin(tx, {
        ...audit,
        action: "UPDATE",
        entity: "Employee",
        entityId: updated.id,
        description: `Se actualizo el legajo ${updated.legajo} - ${updated.lastName}, ${updated.firstName}.${laborSummary}`,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      });
      return updated;
    }));
    clearAuditDerivedCaches();
    return employee;
  },

  async replaceAssignments(id: string, input: ReplaceEmployeeAssignmentsInput, audit?: AuditContext) {
    const before = await execute(() => employeesRepository.findAssignmentsAuditSnapshot(id));
    const employee = await execute(() => employeesRepository.replaceAssignments(id, input.assignments));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeAssignment",
      entityId: employee.id,
      description: `Se actualizaron responsables/asignaciones del legajo ${employee.legajo}.`,
      before: before.assignments as Prisma.InputJsonValue,
      after: employee.assignments as Prisma.InputJsonValue,
    });
    return employee;
  },

  async updateContact(id: string, input: UpdateEmployeeContactInput, audit?: AuditContext) {
    const before = await execute(() => employeesRepository.findContactAuditSnapshot(id));
    const employee = await execute(() => employeesRepository.updateContact(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeContact",
      entityId: employee.id,
      description: `Se actualizo contacto del legajo ${employee.legajo}.`,
      before: {
        email: before.email,
        phone: before.phone,
        mobile: before.mobile,
        emergencyContact: before.emergencyContact,
        emergencyRelation: before.emergencyRelation,
        emergencyPhone: before.emergencyPhone,
      } as Prisma.InputJsonValue,
      after: {
        email: employee.email,
        phone: employee.phone,
        mobile: employee.mobile,
        emergencyContact: employee.emergencyContact,
        emergencyRelation: employee.emergencyRelation,
        emergencyPhone: employee.emergencyPhone,
      } as Prisma.InputJsonValue,
    });
    return employee;
  },

  async upsertAddress(id: string, input: UpsertEmployeeAddressInput, audit?: AuditContext) {
    const before = await execute(() => employeesRepository.findAddressAuditSnapshot(id));
    const employee = await execute(() => employeesRepository.upsertAddress(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeAddress",
      entityId: employee.id,
      description: `Se actualizo domicilio del legajo ${employee.legajo}.`,
      before: before.address as Prisma.InputJsonValue,
      after: employee.address as Prisma.InputJsonValue,
    });
    return employee;
  },

  async upsertTransport(id: string, input: UpsertEmployeeTransportInput, audit?: AuditContext) {
    const before = await execute(() => employeesRepository.findTransportAuditSnapshot(id));
    const employee = await execute(() => employeesRepository.upsertTransport(id, input));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeTransport",
      entityId: employee.id,
      description: `Se actualizo transporte del legajo ${employee.legajo}.`,
      before: before.transport as Prisma.InputJsonValue,
      after: employee.transport as Prisma.InputJsonValue,
    });
    return employee;
  },

  async replaceHourConcepts(id: string, input: ReplaceEmployeeHourConceptsInput, audit?: AuditContext) {
    const uniqueIds = await assertAssignableHourConceptIds(input.hourConceptIds);
    const before = await execute(() => employeesRepository.findHourConceptsAuditSnapshot(id));
    const employee = await execute(() => employeesRepository.replaceHourConcepts(id, uniqueIds));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeHourConcept",
      entityId: employee.id,
      description: `Se actualizaron horas habilitadas del legajo ${employee.legajo}.`,
      before: before.hourConcepts as Prisma.InputJsonValue,
      after: employee.hourConcepts as Prisma.InputJsonValue,
    });
    return employee;
  },

  async createLaborMovement(id: string, input: CreateLaborMovementInput, audit?: AuditContext) {
    const before = await employeesRepository.findLaborAuditSnapshot(id);
    const { employee, movement } = await execute(() => employeesRepository.createLaborMovement(id, input, audit?.userId));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "LaborMovement",
      entityId: employee.id,
      description: `Se registro movimiento ${input.type} para el legajo ${employee.legajo}.`,
      before: { status: before.status, laborMovements: before.laborMovements } as Prisma.InputJsonValue,
      after: { status: employee.status, movement } as Prisma.InputJsonValue,
    });
    return employee;
  },

  async createDocument(id: string, input: CreateEmployeeDocumentInput, user: Express.AuthUser, audit?: AuditContext) {
    // Etapa 15D.4 (docs/decisions/DOCUMENT_CATEGORY_AUTHORIZATION_15D4.md):
    // orden seguro — categoría, permiso de categoría y alcance del empleado
    // se validan ANTES de tocar storage, así una categoría inexistente o no
    // autorizada nunca deja un archivo huérfano subido.
    const category = await employeesRepository.findDocumentCategory(input.categoryId);
    if (!category) {
      throw new AppError("Categoría documental no encontrada", 404, "DOCUMENT_CATEGORY_NOT_FOUND");
    }
    if (!canAccessDocumentCategory({ userRole: user.role, category, action: "upload" })) {
      throw new AppError("No tenés permiso para subir documentos de esta categoría.", 403, "DOCUMENT_UPLOAD_FORBIDDEN");
    }

    const before = await employeesService.getById(id, user);
    const documentType = category.code || category.name;
    const storageFile = await storageService.uploadManaged({
      buffer: bufferFromBase64(input.fileBase64),
      fileName: input.fileName,
      mimeType: input.fileMimeType,
      folderSegments: storagePathBuilder.employeeDocument(before.legajo, documentType),
      module: "LEGAJOS",
      entityType: "EMPLOYEE_DOCUMENT",
      entityId: id,
      employeeId: id,
      documentType,
      visibility: "RRHH_ONLY",
      uploadedByUserId: audit?.userId || null,
      purpose: "general",
    });
    const { storageKey: _clientStorageKey, ...documentInput } = input;
    const employee = await execute(() =>
      employeesRepository.createDocument(
        id,
        { ...documentInput, storageKey: storageFile.storageKey, storageFileId: storageFile.id },
        audit?.userId,
      ),
    );
    const document = employee.documents[0];
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "EmployeeDocument",
      entityId: employee.id,
      description: `Se agrego documentacion al legajo ${employee.legajo}.`,
      before: before.documents as Prisma.InputJsonValue,
      after: employee.documents as Prisma.InputJsonValue,
    });
    return employee;
  },

  async syncLaborStatuses(audit?: AuditContext) {
    const result = await employeesRepository.syncLaborStatuses();
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "Employee",
      entityId: null,
      description: `Se sincronizaron estados laborales. Revisados: ${result.scanned}. Actualizados: ${result.updated}.`,
      after: result as Prisma.InputJsonValue,
    });
    return result;
  },

  async listFieldHistory(id: string, query: ListEmployeeHistoryQuery, user: Express.AuthUser) {
    await employeesService.assertAccessible(id, user);
    return employeesRepository.findFieldHistory(id, query);
  },

  async createFieldHistory(id: string, input: CreateEmployeeFieldHistoryInput, audit?: AuditContext, user?: Express.AuthUser) {
    if (user) await employeesService.assertAccessible(id, user);
    const record = await execute(() => employeesRepository.createFieldHistory(id, input, audit?.userId));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeFieldHistory",
      entityId: record.id,
      description: `Se registro historial del campo ${input.fieldLabel}.`,
      after: record as Prisma.InputJsonValue,
    });
    return record;
  },

  async listBlockHistory(id: string, query: ListEmployeeHistoryQuery, user: Express.AuthUser) {
    await employeesService.assertAccessible(id, user);
    return employeesRepository.findBlockHistory(id, query);
  },

  async createBlockHistory(id: string, input: CreateEmployeeBlockHistoryInput, audit?: AuditContext, user?: Express.AuthUser) {
    if (user) await employeesService.assertAccessible(id, user);
    const record = await execute(() => employeesRepository.createBlockHistory(id, input, audit?.userId));
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeBlockHistory",
      entityId: record.id,
      description: `Se registro historial del bloque ${input.blockLabel}.`,
      after: record as Prisma.InputJsonValue,
    });
    return record;
  },
};
