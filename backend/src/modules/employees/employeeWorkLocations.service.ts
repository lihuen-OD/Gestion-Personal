import { Prisma, type AuditAction } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { calendarDateKey, formatArgentinaDate, previousCalendarDateKey, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";
import { employeeAccessWhere } from "./employeeAccess";
import { employeeWorkLocationsRepository as repository, type WorkLocationRow } from "./employeeWorkLocations.repository";
import {
  assertNoOverlap,
  assertUnitSelection,
  assertValidInterval,
  assertZoneAndEstablishments,
  describePeriod,
  establishmentLabel,
  selectionKey,
  workLocationState,
  type EstablishmentSelection,
  type WorkLocationPeriod,
} from "./employeeWorkLocations.rules";
import type {
  ChangeEmployeeWorkLocationInput,
  CorrectEmployeeWorkLocationInput,
  CreateEmployeeWorkLocationInput,
  EndEmployeeWorkLocationInput,
} from "./employees.schemas";

const NEW_ROW_ID = "__new__";

type Target = { zoneId: string; establishments: EstablishmentSelection[]; effectiveFrom: string; effectiveTo: string | null; reason: string; notes: string | null };
type Resolved = { zoneName: string; establishmentNames: string[] };
type WriteOutcome = {
  action: AuditAction;
  description: string;
  before?: unknown;
  after: unknown;
  history: { oldValue: string | null; newValue: string; effectiveFrom: string; reason: string };
};

const periodOf = (row: WorkLocationRow): WorkLocationPeriod => ({
  id: row.id,
  zoneId: row.zoneId,
  effectiveFrom: calendarDateKey(row.effectiveFrom),
  effectiveTo: row.effectiveTo ? calendarDateKey(row.effectiveTo) : null,
});

const selectionsOf = (row: WorkLocationRow): EstablishmentSelection[] => row.establishments.map((link) => ({
  establishmentId: link.establishment.id,
  coverage: link.coverage,
  unitIds: link.units.map((item) => item.unit.id),
}));

// Toda selección se normaliza: con cobertura completa nunca viajan unidades.
const normalized = (selections: Array<{ establishmentId: string; coverage: EstablishmentSelection["coverage"]; unitIds?: string[] }>): EstablishmentSelection[] =>
  selections.map((item) => ({ establishmentId: item.establishmentId, coverage: item.coverage, unitIds: item.unitIds ?? [] }));

function toDto(row: WorkLocationRow, todayKey: string) {
  const period = periodOf(row);
  return {
    id: row.id,
    zone: row.zone,
    establishments: row.establishments.map((link) => ({ ...link.establishment, coverage: link.coverage, units: link.units.map((item) => item.unit) })),
    effectiveFrom: period.effectiveFrom,
    effectiveTo: period.effectiveTo,
    state: workLocationState(period, todayKey),
    reason: row.reason,
    notes: row.notes,
    createdAt: row.createdAt,
    createdByName: row.createdBy?.name ?? null,
  };
}

// Texto de negocio para historial visible y auditoría: nombres y fechas
// DD/MM/AAAA, nunca ids técnicos.
const summarize = (resolved: Resolved, period: Pick<WorkLocationPeriod, "effectiveFrom" | "effectiveTo">) =>
  `${resolved.zoneName}: ${resolved.establishmentNames.join(", ")} · ${describePeriod(period)}`;
const resolvedOf = (row: WorkLocationRow): Resolved => ({
  zoneName: row.zone.name,
  establishmentNames: row.establishments.map((link) => establishmentLabel(link.establishment.name, link.coverage, link.units.map((item) => item.unit.name))),
});
const snapshotOf = (row: WorkLocationRow) => ({ ...periodOf(row), zone: row.zone.name, establishments: resolvedOf(row).establishmentNames, reason: row.reason, notes: row.notes });

function isExclusionViolation(error: unknown) {
  return error instanceof Error && /EmployeeWorkLocation_no_overlap|23P01/.test(error.message);
}

function mapPersistenceError(error: unknown): never {
  if (isExclusionViolation(error)) {
    throw new AppError("La ubicación se superpone con otra de la misma zona para esta persona.", 409, "WORK_LOCATION_OVERLAP");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") throw new AppError("Otra operación modificó las ubicaciones de esta persona al mismo tiempo. Actualizá la pantalla e intentá nuevamente.", 409, "WORK_LOCATION_CONCURRENT_CHANGE");
    if (error.code === "P2003") throw new AppError("La zona o un establecimiento seleccionado ya no está disponible.", 400, "WORK_LOCATION_RELATION_CONSTRAINT");
  }
  throw error;
}

async function resolveTarget(tx: PrismaTransactionClient, target: Pick<Target, "zoneId" | "establishments">, keep?: WorkLocationRow): Promise<Resolved> {
  const establishmentIds = target.establishments.map((item) => item.establishmentId);
  const unitIds = target.establishments.flatMap((item) => item.unitIds);
  const [zone, establishments, units] = await Promise.all([
    repository.findZone(tx, target.zoneId),
    repository.findEstablishments(tx, establishmentIds),
    repository.findUnits(tx, unitIds),
  ]);
  assertZoneAndEstablishments({
    zoneId: target.zoneId,
    establishmentIds,
    zone,
    establishments,
    keepZoneId: keep?.zoneId,
    keepEstablishmentIds: keep ? new Set(keep.establishments.map((link) => link.establishment.id)) : undefined,
  });
  assertUnitSelection({
    selections: target.establishments,
    establishments,
    units,
    keepUnitIds: keep ? new Set(keep.establishments.flatMap((link) => link.units.map((item) => item.unit.id))) : undefined,
  });
  const establishmentNameById = new Map(establishments.map((item) => [item.id, item.name]));
  const unitNameById = new Map(units.map((item) => [item.id, item.name]));
  return {
    zoneName: zone!.name,
    establishmentNames: target.establishments
      .map((item) => establishmentLabel(establishmentNameById.get(item.establishmentId)!, item.coverage, item.unitIds.map((id) => unitNameById.get(id)!)))
      .sort((a, b) => a.localeCompare(b, "es")),
  };
}

function findOwnRow(rows: WorkLocationRow[], locationId: string) {
  const row = rows.find((item) => item.id === locationId);
  if (!row) throw new AppError("Ubicación de trabajo no encontrada", 404, "WORK_LOCATION_NOT_FOUND");
  return row;
}

/**
 * Escritura común: filas, historial visible del legajo y auditoría en una
 * única transacción Serializable (§3.3/§3.5). Los cachés se limpian sólo
 * después del commit.
 */
async function write(
  employeeId: string,
  audit: AuditContext | undefined,
  operation: (tx: PrismaTransactionClient, rows: WorkLocationRow[], employeeReference: string) => Promise<WriteOutcome>,
) {
  try {
    await repository.transaction(async (tx) => {
      const employee = await repository.findEmployeeReference(employeeId, {}, tx);
      if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
      const rows = await repository.findByEmployee(employeeId, tx);
      const outcome = await operation(tx, rows, formatEmployeeReference(employee));
      await repository.createBlockHistoryWithin(tx, employeeId, outcome.history, audit?.userId);
      await auditService.registerWithin(tx, {
        ...audit,
        action: outcome.action,
        entity: "EmployeeWorkLocation",
        entityId: employeeId,
        description: outcome.description,
        ...(outcome.before !== undefined ? { before: outcome.before as Prisma.InputJsonValue } : {}),
        after: outcome.after as Prisma.InputJsonValue,
      });
    });
  } catch (error) {
    mapPersistenceError(error);
  }
  clearAuditDerivedCaches();
  return employeeWorkLocationsService.listUnscoped(employeeId);
}

export const employeeWorkLocationsService = {
  async list(employeeId: string, user: Express.AuthUser) {
    const employee = await repository.findEmployeeReference(employeeId, employeeAccessWhere(user));
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return employeeWorkLocationsService.listUnscoped(employeeId);
  },

  async listUnscoped(employeeId: string) {
    const todayKey = todayArgentinaDateKey();
    const rows = await repository.findByEmployee(employeeId);
    return rows.map((row) => toDto(row, todayKey));
  },

  create(employeeId: string, input: CreateEmployeeWorkLocationInput, audit?: AuditContext) {
    return write(employeeId, audit, async (tx, rows, employeeReference) => {
      const target: Target = { ...input, establishments: normalized(input.establishments), effectiveTo: input.effectiveTo ?? null, notes: input.notes || null };
      const resolved = await resolveTarget(tx, target);
      const period = { id: NEW_ROW_ID, zoneId: target.zoneId, effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo };
      assertValidInterval(period);
      assertNoOverlap(period, rows.map(periodOf), resolved.zoneName);
      const created = await repository.createWithin(tx, employeeId, target, audit?.userId);
      return {
        action: "CREATE",
        description: `Se asignó la ubicación de trabajo ${summarize(resolved, period)} a ${employeeReference}.`,
        after: { ...period, id: created.id, zone: resolved.zoneName, establishments: resolved.establishmentNames, reason: target.reason, notes: target.notes },
        history: { oldValue: null, newValue: `Alta · ${summarize(resolved, period)}`, effectiveFrom: period.effectiveFrom, reason: target.reason },
      };
    });
  },

  // Cambio con nueva vigencia desde D: la ubicación actual se cierra en D − 1
  // y la nueva empieza en D. Conserva el registro anterior como historial.
  change(employeeId: string, locationId: string, input: ChangeEmployeeWorkLocationInput, audit?: AuditContext) {
    return write(employeeId, audit, async (tx, rows, employeeReference) => {
      const current = findOwnRow(rows, locationId);
      const currentPeriod = periodOf(current);
      const changeDate = input.effectiveFrom;
      if (changeDate <= currentPeriod.effectiveFrom) {
        throw new AppError(
          `El cambio tiene que empezar después del inicio de la ubicación actual (${formatArgentinaDate(currentPeriod.effectiveFrom)}). Para arreglar el registro desde su inicio usá “Corregir”.`,
          409,
          "WORK_LOCATION_CHANGE_DATE_INVALID",
        );
      }
      if (currentPeriod.effectiveTo !== null && currentPeriod.effectiveTo < changeDate) {
        throw new AppError(
          `Esa ubicación terminó el ${formatArgentinaDate(currentPeriod.effectiveTo)}: no hay vigencia que cambiar desde esa fecha. Cargá una ubicación nueva.`,
          409,
          "WORK_LOCATION_CHANGE_OUTSIDE_PERIOD",
        );
      }
      const target: Target = { ...input, establishments: normalized(input.establishments), effectiveTo: input.effectiveTo ?? null, notes: input.notes || null };
      const resolved = await resolveTarget(tx, target);
      if (target.zoneId === current.zoneId && selectionKey(target.establishments) === selectionKey(selectionsOf(current))) {
        throw new AppError("La zona, los establecimientos y las unidades son los mismos que los actuales: no hay cambio para registrar.", 409, "WORK_LOCATION_CHANGE_EMPTY");
      }
      const closed = { ...currentPeriod, effectiveTo: previousCalendarDateKey(changeDate) };
      const next = { id: NEW_ROW_ID, zoneId: target.zoneId, effectiveFrom: changeDate, effectiveTo: target.effectiveTo };
      assertValidInterval(next);
      assertNoOverlap(next, rows.map((row) => (row.id === current.id ? closed : periodOf(row))), resolved.zoneName);
      // Primero se cierra la vigente: la exclusión de M1 no es diferida.
      await repository.closeWithin(tx, current.id, closed.effectiveTo);
      const created = await repository.createWithin(tx, employeeId, target, audit?.userId);
      return {
        action: "UPDATE",
        description: `Se cambió la ubicación de trabajo de ${employeeReference} desde el ${formatArgentinaDate(changeDate)}: ${summarize(resolvedOf(current), currentPeriod)} → ${summarize(resolved, next)}.`,
        before: snapshotOf(current),
        after: {
          closed: { ...snapshotOf(current), effectiveTo: closed.effectiveTo },
          created: { ...next, id: created.id, zone: resolved.zoneName, establishments: resolved.establishmentNames, reason: target.reason, notes: target.notes },
        },
        history: { oldValue: summarize(resolvedOf(current), currentPeriod), newValue: `Cambio · ${summarize(resolved, next)}`, effectiveFrom: changeDate, reason: target.reason },
      };
    });
  },

  // Fin de vigencia sin reemplazo. Si ya tiene fecha de fin, modificarla es
  // una corrección, no una finalización.
  end(employeeId: string, locationId: string, input: EndEmployeeWorkLocationInput, audit?: AuditContext) {
    return write(employeeId, audit, async (tx, rows, employeeReference) => {
      const current = findOwnRow(rows, locationId);
      const currentPeriod = periodOf(current);
      if (currentPeriod.effectiveTo !== null) {
        throw new AppError(
          `Esta ubicación ya termina el ${formatArgentinaDate(currentPeriod.effectiveTo)}. Para cambiar esa fecha usá “Corregir”.`,
          409,
          "WORK_LOCATION_ALREADY_ENDED",
        );
      }
      const ended = { ...currentPeriod, effectiveTo: input.effectiveTo };
      assertValidInterval(ended);
      await repository.closeWithin(tx, current.id, input.effectiveTo);
      return {
        action: "UPDATE",
        description: `Se finalizó la ubicación de trabajo de ${employeeReference}: ${summarize(resolvedOf(current), ended)}.`,
        before: snapshotOf(current),
        after: { ...snapshotOf(current), effectiveTo: input.effectiveTo, endReason: input.reason },
        history: { oldValue: summarize(resolvedOf(current), currentPeriod), newValue: `Finalización · ${summarize(resolvedOf(current), ended)}`, effectiveFrom: input.effectiveTo, reason: input.reason },
      };
    });
  },

  // Corrección de un dato mal cargado: modifica el registro existente sin
  // abrir una vigencia nueva y deja el antes/después en la auditoría.
  correct(employeeId: string, locationId: string, input: CorrectEmployeeWorkLocationInput, audit?: AuditContext) {
    return write(employeeId, audit, async (tx, rows, employeeReference) => {
      const current = findOwnRow(rows, locationId);
      const currentPeriod = periodOf(current);
      const currentSelections = selectionsOf(current);
      const target: Target = {
        zoneId: input.zoneId ?? current.zoneId,
        establishments: input.establishments ? normalized(input.establishments) : currentSelections,
        effectiveFrom: input.effectiveFrom ?? currentPeriod.effectiveFrom,
        effectiveTo: input.effectiveTo !== undefined ? input.effectiveTo : currentPeriod.effectiveTo,
        reason: input.reason ?? current.reason,
        notes: input.notes !== undefined ? input.notes || null : current.notes,
      };
      const establishmentsChanged = selectionKey(target.establishments) !== selectionKey(currentSelections);
      const changed = establishmentsChanged
        || target.zoneId !== current.zoneId
        || target.effectiveFrom !== currentPeriod.effectiveFrom
        || target.effectiveTo !== currentPeriod.effectiveTo
        || target.reason !== current.reason
        || target.notes !== current.notes;
      if (!changed) throw new AppError("No hay datos distintos para corregir.", 400, "WORK_LOCATION_CORRECTION_EMPTY");
      const resolved = await resolveTarget(tx, target, current);
      const corrected = { id: current.id, zoneId: target.zoneId, effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo };
      assertValidInterval(corrected);
      assertNoOverlap(corrected, rows.map(periodOf), resolved.zoneName);
      await repository.correctWithin(tx, current.id, target, establishmentsChanged);
      return {
        action: "UPDATE",
        description: `Se corrigió la ubicación de trabajo de ${employeeReference}: ${summarize(resolvedOf(current), currentPeriod)} → ${summarize(resolved, corrected)}. Motivo: ${input.correctionReason}`,
        before: snapshotOf(current),
        after: { ...corrected, zone: resolved.zoneName, establishments: resolved.establishmentNames, reason: target.reason, notes: target.notes, correctionReason: input.correctionReason },
        history: { oldValue: summarize(resolvedOf(current), currentPeriod), newValue: `Corrección · ${summarize(resolved, corrected)}`, effectiveFrom: corrected.effectiveFrom, reason: input.correctionReason },
      };
    });
  },
};
