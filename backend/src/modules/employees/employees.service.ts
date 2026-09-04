import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { storageService } from "../../shared/storage/storage.service";
import { storagePathBuilder } from "../../shared/storage/storagePathBuilder";
import { redactPiiForRole } from "../../shared/security/piiRedaction";
import { roles } from "../../shared/security/roles";
import { employeeAccessWhere } from "./employeeAccess";
import { employeesRepository } from "./employees.repository";
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
};

type TimeGridEntry = {
  day: number;
  hours: Prisma.Decimal;
  status: string;
  hourConcept: TimeGridConcept;
  // Etapa 11B: Horas Especiales — mismos campos ya usados en findPeriodEmployees
  // (11A/11A.1). appliedMultiplier siempre es un escalar real de TimeEntry (1
  // por default); timeSegment sólo existe para entradas del fichador.
  appliedMultiplier?: Prisma.Decimal | number | null;
  timeSegment?: {
    specialHourRuleApplications: Array<{ wasConflicting: boolean; doubleHourRule: { name: string } }>;
  } | null;
};

type TimeGridBreakdown = { day: number; hourConceptId: string; minutes: number };

// Etapa 11B: multiplicador/adicional/regla(s)/conflicto de Hora Especial para
// un día del legajo — sólo se incluye la clave del día cuando hay un
// multiplicador > 1 (mismo criterio que specialHourAdditionalHours en
// findPeriodEmployees: nunca se infla nada, sólo se deriva en lectura).
export type TimeGridSpecialHourDay = {
  multiplier: number;
  additionalMinutes: number;
  liquidableTotalMinutes: number;
  ruleNames: string[];
  conflict: boolean;
};

export function buildAdditiveTimeGrid(
  normalConcept: TimeGridConcept | null,
  enabledConcepts: TimeGridConcept[],
  entries: TimeGridEntry[],
  breakdowns: TimeGridBreakdown[],
) {
  if (!normalConcept) {
    throw new AppError("Canonical normal hour concept not found", 500, "NORMAL_HOUR_CONCEPT_NOT_FOUND");
  }

  const normalMinutesByDay: Record<string, number> = {};
  // Etapa 11B: multiplicador/regla(s)/conflicto resueltos desde la Hora
  // normal de cada día (misma fuente que appliedMultiplier ya persiste desde
  // 11A, tanto para fichador como para carga manual) — no se re-consulta
  // DoubleHourRule acá, sólo se lee lo que ya quedó escrito.
  const multiplierByDay: Record<string, { multiplier: number; ruleNames: string[]; conflict: boolean }> = {};
  for (const entry of entries) {
    if (entry.hourConcept.systemRole !== "NORMAL_BASE" || !["APROBADO", "EN_REVISION"].includes(entry.status)) continue;
    const key = String(entry.day);
    normalMinutesByDay[key] = (normalMinutesByDay[key] ?? 0) + Math.round(Number(entry.hours) * 60);

    const multiplier = Number(entry.appliedMultiplier ?? 1);
    if (multiplier > 1) {
      const current = multiplierByDay[key] ?? { multiplier: 1, ruleNames: [], conflict: false };
      current.multiplier = Math.max(current.multiplier, multiplier);
      for (const application of entry.timeSegment?.specialHourRuleApplications ?? []) {
        if (!current.ruleNames.includes(application.doubleHourRule.name)) current.ruleNames.push(application.doubleHourRule.name);
        if (application.wasConflicting) current.conflict = true;
      }
      multiplierByDay[key] = current;
    }
  }

  const additionalMinutes = new Map<string, Record<string, number>>();
  // Etapa 11B: minutos de TODOS los conceptos adicionales, sumados por día
  // (sin distinguir concepto) — es lo que necesita el multiplicador del día
  // para derivar el liquidable total, igual criterio que findPeriodEmployees.
  const conceptMinutesByDay: Record<string, number> = {};
  for (const breakdown of breakdowns) {
    const byDay = additionalMinutes.get(breakdown.hourConceptId) ?? {};
    const key = String(breakdown.day);
    byDay[key] = (byDay[key] ?? 0) + breakdown.minutes;
    additionalMinutes.set(breakdown.hourConceptId, byDay);
    conceptMinutesByDay[key] = (conceptMinutesByDay[key] ?? 0) + breakdown.minutes;
  }

  const specialHoursByDay: Record<string, TimeGridSpecialHourDay> = {};
  let specialHourAdditionalMinutes = 0;
  for (const [day, info] of Object.entries(multiplierByDay)) {
    const normalMinutes = normalMinutesByDay[day] ?? 0;
    const conceptMinutes = conceptMinutesByDay[day] ?? 0;
    const additionalMinutesForDay = Math.round((normalMinutes + conceptMinutes) * (info.multiplier - 1));
    specialHourAdditionalMinutes += additionalMinutesForDay;
    specialHoursByDay[day] = {
      multiplier: info.multiplier,
      additionalMinutes: additionalMinutesForDay,
      liquidableTotalMinutes: normalMinutes + conceptMinutes + additionalMinutesForDay,
      ruleNames: info.ruleNames,
      conflict: info.conflict,
    };
  }

  const toRow = (concept: TimeGridConcept, role: "NORMAL_BASE" | "ADDITIONAL", minutesByDay: Record<string, number>) => ({
    concept,
    role,
    minutesByDay,
    totalMinutes: Object.values(minutesByDay).reduce((sum, minutes) => sum + minutes, 0),
  });
  const normalRow = toRow(normalConcept, "NORMAL_BASE", normalMinutesByDay);
  const additionalRows = enabledConcepts
    .filter((concept) => concept.systemRole === null && concept.loadMode !== null)
    .map((concept) => toRow(concept, "ADDITIONAL", additionalMinutes.get(concept.id) ?? {}));

  const totalConceptMinutes = Object.values(conceptMinutesByDay).reduce((sum, minutes) => sum + minutes, 0);

  return {
    rows: [normalRow, ...additionalRows],
    totalWorkedMinutes: normalRow.totalMinutes,
    specialHoursByDay,
    specialHourAdditionalMinutes,
    // Etapa 11B: total liquidable del período = reales (Normal + conceptos,
    // nunca inflados) + adicional derivado. Sin ninguna Hora Especial en el
    // período, coincide con normal+conceptos (mismo criterio ya documentado
    // en 11A.1 para "sin regla, los conceptos igual liquidan como adicionales").
    specialHourLiquidableTotalMinutes: normalRow.totalMinutes + totalConceptMinutes + specialHourAdditionalMinutes,
  };
}

async function validateManualBreakdownContext(
  employeeId: string,
  hourConceptId: string,
  period: string,
  user: Express.AuthUser,
) {
  const employee = await employeesRepository.findEmployeeForManualBreakdown(employeeId, employeeAccessWhere(user));
  if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");

  const concept = await employeesRepository.findHourConceptForManualBreakdown(hourConceptId);
  if (!concept) throw new AppError("Hour concept not found", 404, "HOUR_CONCEPT_NOT_FOUND");
  if (concept.systemRole === "NORMAL_BASE") throw new AppError("Normal cannot be loaded as a breakdown", 409, "NORMAL_BREAKDOWN_NOT_ALLOWED");
  if (concept.status !== "ACTIVO") throw new AppError("Hour concept is inactive", 409, "HOUR_CONCEPT_INACTIVE");
  if (concept.deletedAt) throw new AppError("Hour concept is deleted", 409, "HOUR_CONCEPT_DELETED");
  if (!concept.loadMode) throw new AppError("Hour concept has no load mode", 409, "HOUR_CONCEPT_LOAD_MODE_REQUIRED");
  if (concept.loadMode === "AUTOMATIC") throw new AppError("Automatic concepts are read-only", 409, "MANUAL_BREAKDOWN_NOT_ALLOWED");
  if (!await employeesRepository.isHourConceptEnabled(employeeId, hourConceptId)) {
    throw new AppError("Hour concept is not enabled for this employee", 409, "HOUR_CONCEPT_NOT_ENABLED");
  }

  const closure = await employeesRepository.findMonthlyClosure(employeeId, period);
  if (closure && ["ENVIADO", "APROBADO", "CORRECCION_PENDIENTE"].includes(closure.status)) {
    throw new AppError("The period is closed for direct editing", 409, "PERIOD_CLOSED");
  }
  return concept;
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
    const [items, total] = await employeesRepository.findOrgChart(query, employeeAccessWhere(user));
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
    const additiveGrid = buildAdditiveTimeGrid(
      grid.normalConcept,
      grid.employee.hourConcepts.map((link) => link.hourConcept),
      grid.entries,
      grid.breakdowns,
    );
    return redactPiiForRole({ ...grid, ...additiveGrid }, user);
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
    const concept = await validateManualBreakdownContext(employeeId, input.hourConceptId, period, user);
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
      observation: input.observation,
      createdByUserId: user.id,
      approvedByUserId: autoApprovedByUserId,
    });
    await auditService.register({
      ...audit,
      action: result.operation,
      entity: "HourConceptBreakdown",
      entityId: result.item?.id || null,
      description: result.operation === "DELETE"
        ? `Se eliminó el desglose manual ${concept.name} de ${input.date} para el legajo ${employeeId}.`
        : autoApprovedByUserId
          ? `Se guardó y aplicó (RRHH) el desglose manual ${concept.name} de ${input.date} para el legajo ${employeeId}.`
          : `Se guardó el desglose manual ${concept.name} de ${input.date} para el legajo ${employeeId}.`,
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
      description: `Se aprobó el desglose manual ${item.hourConcept.name} del legajo ${item.employee.legajo}.`,
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
      description: `Se rechazó el desglose manual ${item.hourConcept.name} del legajo ${item.employee.legajo}. Motivo: ${input.reason}`,
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
      description: `Se devolvió el desglose manual ${item.hourConcept.name} del legajo ${item.employee.legajo}. Motivo: ${input.reason}`,
      before: before as Prisma.InputJsonValue,
      after: { item, reason: input.reason } as Prisma.InputJsonValue,
    });
    return item;
  },

  async getPositionValidation(id: string, user: Express.AuthUser) {
    const employee = await employeesService.getById(id, user);
    const position = employee.position;
    const businessUnit = employee.sector?.area?.establishment?.businessUnit?.name || "";
    const establishment = employee.sector?.area?.establishment?.name || "";
    const sector = employee.sector?.name || "";
    // Fuente de verdad desde el saneamiento de Puestos (2026-08-18):
    // sectorId es el unico origen oficial de ubicacion del puesto. Area,
    // establecimiento y unidad de negocio se derivan de esa cadena real
    // (position.sector.area.establishment.businessUnit) en vez de los
    // strings/JSON legado (areaDepartment, sectorName, businessUnitNames...).
    const positionHasSector = Boolean(position?.sector);
    const positionBusinessUnit = position?.sector?.area?.establishment?.businessUnit?.name || "";
    const positionEstablishment = position?.sector?.area?.establishment?.name || "";
    const positionSector = position?.sector?.name || "";
    const range = categoryRangeFromPosition(position);
    const categoryResult = position ? compareCategory(range, employee.internalCategory) : { status: "NO_POSITION", range: [] };
    const checks = [
      structureCheck("Unidad de negocio", businessUnit, positionBusinessUnit ? [positionBusinessUnit] : [], Boolean(position)),
      structureCheck("Establecimiento", establishment, positionEstablishment ? [positionEstablishment] : [], Boolean(position)),
      structureCheck("Sector", sector, positionSector ? [positionSector] : [], Boolean(position)),
    ];
    const structuralMismatch = checks.some((row) => position && row.allowed.length && !row.ok && !row.missing);
    const categoryMismatch = ["BELOW_RANGE", "ABOVE_RANGE", "UNKNOWN_CATEGORY"].includes(categoryResult.status);
    const categoryPending = ["NO_POSITION", "NO_RANGE"].includes(categoryResult.status) || !employee.internalCategory;
    const positionPendingSector = Boolean(position) && !positionHasSector;
    const tone = !position
      ? "neutral"
      : structuralMismatch || categoryMismatch
        ? "danger"
        : categoryPending || positionPendingSector || checks.some((row) => row.missing)
          ? "warning"
          : "success";
    const title = !position
      ? "Puesto sin seleccionar"
      : tone === "success"
        ? "Datos laborales dentro del puesto"
        : tone === "danger"
          ? "Hay datos fuera del puesto"
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
    await ensureUniqueEmployee(input);
    const hourConceptIds = await assertAssignableHourConceptIds(input.hourConceptIds ?? []);
    const employee = await execute(() => employeesRepository.create({ ...input, hourConceptIds }, audit?.userId));
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "Employee",
      entityId: employee.id,
      description: `Se creo el legajo ${employee.legajo} - ${employee.lastName}, ${employee.firstName}.`,
      after: employee as Prisma.InputJsonValue,
    });
    return employee;
  },

  async update(id: string, input: UpdateEmployeeInput, audit?: AuditContext) {
    const [, before] = await Promise.all([
      ensureNoEmployeeConflict(id, input),
      employeesRepository.findUpdateAuditSnapshot(id),
    ]);
    if (!before) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    const effectiveInput = omitUnchangedEmployeeRelations(input, before);
    const employee = await execute(() => employeesRepository.update(id, effectiveInput));
    const after = {
      ...before,
      ...employee,
      address: input.address ? { ...(before.address || {}), ...input.address } : before.address,
      companies:
        input.companyIds !== undefined || input.primaryCompanyId !== undefined
          ? desiredCompanies(input)
          : before.companies,
    };
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "Employee",
      entityId: employee.id,
      description: `Se actualizo el legajo ${employee.legajo} - ${employee.lastName}, ${employee.firstName}.`,
      before: before as Prisma.InputJsonValue,
      after: after as Prisma.InputJsonValue,
    });
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

  async createDocument(id: string, input: CreateEmployeeDocumentInput, audit?: AuditContext) {
    const before = await employeesService.getById(id);
    const category = await employeesRepository.findDocumentCategory(input.categoryId);
    const documentType = category?.code || category?.name || input.categoryId;
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
