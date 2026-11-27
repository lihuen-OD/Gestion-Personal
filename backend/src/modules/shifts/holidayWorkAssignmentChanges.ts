import type { HolidayWorkAssignmentStatus } from "@prisma/client";
import type { HolidayWorkAssignmentItemInput } from "./holidayWorkAssignment.schemas";

/**
 * Campos editables de una convocatoria, normalizados exactamente como los
 * escribe el guardado: un campo omitido se guarda como `null` (cancelar sin
 * detalle limpia turno, horario y notas, igual que antes del procesamiento en
 * lote).
 */
export type HolidayWorkAssignmentFields = {
  status: HolidayWorkAssignmentStatus;
  shiftTemplateId: string | null;
  expectedStartTime: string | null;
  expectedEndTime: string | null;
  notes: string | null;
};

export type ExistingHolidayWorkAssignment = HolidayWorkAssignmentFields & { id: string; employeeId: string };

export type HolidayWorkAssignmentChange<Existing extends ExistingHolidayWorkAssignment = ExistingHolidayWorkAssignment> =
  | { kind: "CREATE"; employeeId: string; fields: HolidayWorkAssignmentFields }
  | { kind: "UPDATE"; employeeId: string; fields: HolidayWorkAssignmentFields; existing: Existing }
  | { kind: "UNCHANGED"; employeeId: string; existing: Existing }
  // CANCELADA para una convocatoria que nunca existió: no crea una fila vacía.
  | { kind: "SKIP"; employeeId: string };

export function requestedHolidayWorkAssignmentFields(item: HolidayWorkAssignmentItemInput): HolidayWorkAssignmentFields {
  return {
    status: item.status,
    shiftTemplateId: item.shiftTemplateId ?? null,
    expectedStartTime: item.expectedStartTime ?? null,
    expectedEndTime: item.expectedEndTime ?? null,
    notes: item.notes ?? null,
  };
}

/** Firma estable de los campos editables (comparación y agrupación de updates). */
export function holidayWorkAssignmentFieldsKey(fields: HolidayWorkAssignmentFields) {
  return JSON.stringify([fields.status, fields.shiftTemplateId, fields.expectedStartTime, fields.expectedEndTime, fields.notes]);
}

/**
 * Compara lo persistido con lo pedido, en el orden del pedido. Una fila sólo
 * se escribe (y se audita) si cambia algún campo editable.
 */
export function planHolidayWorkAssignmentChanges<Existing extends ExistingHolidayWorkAssignment>(
  items: HolidayWorkAssignmentItemInput[],
  existingRows: Existing[],
): HolidayWorkAssignmentChange<Existing>[] {
  const existingByEmployee = new Map(existingRows.map((row) => [row.employeeId, row]));
  return items.map((item): HolidayWorkAssignmentChange<Existing> => {
    const fields = requestedHolidayWorkAssignmentFields(item);
    const existing = existingByEmployee.get(item.employeeId);
    if (!existing) return fields.status === "CANCELADA" ? { kind: "SKIP", employeeId: item.employeeId } : { kind: "CREATE", employeeId: item.employeeId, fields };
    if (holidayWorkAssignmentFieldsKey(existing) === holidayWorkAssignmentFieldsKey(fields)) return { kind: "UNCHANGED", employeeId: item.employeeId, existing };
    return { kind: "UPDATE", employeeId: item.employeeId, fields, existing };
  });
}

/** Updates con los mismos campos finales: un updateMany por grupo (p. ej. todas las cancelaciones). */
export function groupHolidayWorkAssignmentUpdates(changes: HolidayWorkAssignmentChange[]) {
  const groups = new Map<string, { fields: HolidayWorkAssignmentFields; ids: string[] }>();
  for (const change of changes) {
    if (change.kind !== "UPDATE") continue;
    const key = holidayWorkAssignmentFieldsKey(change.fields);
    const group = groups.get(key) ?? { fields: change.fields, ids: [] };
    group.ids.push(change.existing.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Convocatorias que quedan ACTIVAS con un cambio efectivo (alta, reactivación
 * o edición): las únicas cuyo horario se valida al guardar (§20, D9). Una
 * convocatoria sin cambios no se revalida: editar a otro no la bloquea.
 */
export function activatedHolidayWorkAssignmentChanges<Existing extends ExistingHolidayWorkAssignment>(changes: HolidayWorkAssignmentChange<Existing>[]) {
  return changes.flatMap((change) => ((change.kind === "CREATE" || change.kind === "UPDATE") && change.fields.status === "ACTIVA" ? [{ employeeId: change.employeeId, shiftTemplateId: change.fields.shiftTemplateId }] : []));
}
