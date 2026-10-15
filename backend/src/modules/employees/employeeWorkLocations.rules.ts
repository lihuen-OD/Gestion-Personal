import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";

/**
 * Reglas puras de ubicaciones de trabajo (ORG_LOCATION_REORGANIZATION.md
 * §3.3). Las fechas son claves de calendario "YYYY-MM-DD": se comparan como
 * texto y nunca pasan por un huso horario. Vigencia = intervalo cerrado
 * [effectiveFrom, effectiveTo]; effectiveTo null = abierta.
 */
export type WorkLocationPeriod = { id: string; zoneId: string; effectiveFrom: string; effectiveTo: string | null };
export type WorkLocationState = "CURRENT" | "FUTURE" | "ENDED";

type NamedNode = { id: string; name: string; status: string };
export type ResolvedZone = NamedNode & { archivedAt?: Date | null };
// A8 §12.1: `archivedAt` alimenta el rechazo de asignación a un establecimiento archivado.
export type ResolvedEstablishment = NamedNode & { zoneId: string | null; archivedAt?: Date | null };
export type ResolvedUnit = NamedNode & { establishmentId: string; archivedAt?: Date | null };

export type WorkLocationCoverage = "ESTABLISHMENT" | "UNITS";
/** Un establecimiento de la ubicación: completo o una selección explícita de sus unidades. */
export type EstablishmentSelection = { establishmentId: string; coverage: WorkLocationCoverage; unitIds: string[] };

export function workLocationState(period: Pick<WorkLocationPeriod, "effectiveFrom" | "effectiveTo">, todayKey: string): WorkLocationState {
  if (period.effectiveFrom > todayKey) return "FUTURE";
  if (period.effectiveTo !== null && period.effectiveTo < todayKey) return "ENDED";
  return "CURRENT";
}

export function periodsOverlap(a: Pick<WorkLocationPeriod, "effectiveFrom" | "effectiveTo">, b: Pick<WorkLocationPeriod, "effectiveFrom" | "effectiveTo">) {
  const aEndsBeforeB = a.effectiveTo !== null && a.effectiveTo < b.effectiveFrom;
  const bEndsBeforeA = b.effectiveTo !== null && b.effectiveTo < a.effectiveFrom;
  return !aEndsBeforeB && !bEndsBeforeA;
}

export function describePeriod(period: Pick<WorkLocationPeriod, "effectiveFrom" | "effectiveTo">) {
  return period.effectiveTo
    ? `del ${formatArgentinaDate(period.effectiveFrom)} al ${formatArgentinaDate(period.effectiveTo)}`
    : `desde el ${formatArgentinaDate(period.effectiveFrom)}, sin fecha de fin`;
}

export function assertValidInterval(period: Pick<WorkLocationPeriod, "effectiveFrom" | "effectiveTo">) {
  if (period.effectiveTo !== null && period.effectiveTo < period.effectiveFrom) {
    throw new AppError("La fecha hasta no puede ser anterior a la fecha desde.", 400, "WORK_LOCATION_INVALID_INTERVAL");
  }
}

/**
 * Sin superposición por persona y zona, incluidas las vigencias futuras.
 * `existing` son las filas de la persona tal como quedarían después de la
 * operación, sin la fila candidata.
 */
export function assertNoOverlap(candidate: WorkLocationPeriod, existing: WorkLocationPeriod[], zoneName: string) {
  const conflict = existing
    .filter((row) => row.id !== candidate.id && row.zoneId === candidate.zoneId)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .find((row) => periodsOverlap(row, candidate));
  if (!conflict) return;
  throw new AppError(
    `Se superpone con la ubicación en “${zoneName}” ${describePeriod(conflict)}. Para reemplazarla desde una fecha usá “Cambiar desde…”; para arreglar un dato mal cargado, “Corregir”.`,
    409,
    "WORK_LOCATION_OVERLAP",
    { conflictingPeriod: { effectiveFrom: conflict.effectiveFrom, effectiveTo: conflict.effectiveTo } },
  );
}

/**
 * Zona y establecimientos seleccionados explícitamente (D-2: no existe "zona
 * completa"; una lista vacía nunca significa "todos"). Los nodos inactivos
 * sólo se aceptan si ya estaban en el registro que se corrige.
 */
export function assertZoneAndEstablishments(input: {
  zoneId: string;
  establishmentIds: string[];
  zone: ResolvedZone | null;
  establishments: ResolvedEstablishment[];
  keepZoneId?: string;
  keepEstablishmentIds?: ReadonlySet<string>;
}) {
  const { zone } = input;
  if (!zone) throw new AppError("La zona seleccionada no existe.", 400, "WORK_LOCATION_ZONE_INVALID");
  // A8 §12.4: lo archivado (también por una eliminación controlada) es
  // evidencia: no se asigna ni se reafirma en una corrección.
  if (zone.archivedAt) {
    throw new AppError(`La zona “${zone.name}” fue eliminada y no puede asignarse.`, 400, "WORK_LOCATION_ZONE_ARCHIVED");
  }
  if (zone.status !== "ACTIVO" && input.keepZoneId !== zone.id) {
    throw new AppError(`La zona “${zone.name}” está inactiva y no puede asignarse.`, 409, "WORK_LOCATION_ZONE_INACTIVE");
  }
  if (!input.establishmentIds.length) {
    throw new AppError("Seleccioná al menos un establecimiento de la zona.", 400, "WORK_LOCATION_ESTABLISHMENTS_REQUIRED");
  }
  if (new Set(input.establishmentIds).size !== input.establishmentIds.length) {
    throw new AppError("El mismo establecimiento fue seleccionado más de una vez.", 409, "WORK_LOCATION_ESTABLISHMENT_DUPLICATE");
  }
  const byId = new Map(input.establishments.map((item) => [item.id, item]));
  for (const id of input.establishmentIds) {
    const establishment = byId.get(id);
    if (!establishment) throw new AppError("Uno de los establecimientos seleccionados no existe.", 400, "WORK_LOCATION_ESTABLISHMENT_INVALID");
    // A8 §12.4: primero lo archivado (causa más específica), después legado/inactivo.
    if (establishment.archivedAt) {
      throw new AppError(`“${establishment.name}” está archivado y no puede asignarse.`, 400, "WORK_LOCATION_ESTABLISHMENT_ARCHIVED");
    }
    if (establishment.zoneId === null) {
      throw new AppError(`“${establishment.name}” pertenece a la estructura anterior y no tiene zona: no puede asignarse.`, 409, "WORK_LOCATION_ESTABLISHMENT_LEGACY");
    }
    if (establishment.zoneId !== zone.id) {
      throw new AppError(`“${establishment.name}” no pertenece a la zona “${zone.name}”.`, 409, "WORK_LOCATION_ESTABLISHMENT_ZONE_MISMATCH");
    }
    if (establishment.status !== "ACTIVO" && !input.keepEstablishmentIds?.has(id)) {
      throw new AppError(`“${establishment.name}” está inactivo y no puede asignarse.`, 409, "WORK_LOCATION_ESTABLISHMENT_INACTIVE");
    }
  }
}

/**
 * Cobertura de cada establecimiento elegido. El modo es siempre explícito: una
 * lista de unidades vacía nunca significa "todas" ni "ninguna".
 * - ESTABLISHMENT: establecimiento completo, sin unidades.
 * - UNITS: al menos una unidad, todas de ESE establecimiento, existentes, no
 *   archivadas y activas (una inactiva sólo se conserva al corregir un
 *   registro que ya la tenía).
 * Se ejecuta después de assertZoneAndEstablishments.
 */
export function assertUnitSelection(input: {
  selections: EstablishmentSelection[];
  establishments: ResolvedEstablishment[];
  units: ResolvedUnit[];
  keepUnitIds?: ReadonlySet<string>;
}) {
  const establishmentById = new Map(input.establishments.map((item) => [item.id, item]));
  const unitById = new Map(input.units.map((item) => [item.id, item]));
  for (const selection of input.selections) {
    const establishmentName = establishmentById.get(selection.establishmentId)?.name ?? "el establecimiento";
    if (selection.coverage === "ESTABLISHMENT") {
      if (selection.unitIds.length) {
        throw new AppError(
          `“${establishmentName}” está marcado como establecimiento completo: no se eligen unidades. Para asignar sólo algunas, elegí “Unidades específicas”.`,
          400,
          "WORK_LOCATION_UNITS_NOT_ALLOWED",
        );
      }
      continue;
    }
    if (!selection.unitIds.length) {
      throw new AppError(`Elegí al menos una unidad de “${establishmentName}” o marcalo como establecimiento completo.`, 400, "WORK_LOCATION_UNITS_REQUIRED");
    }
    if (new Set(selection.unitIds).size !== selection.unitIds.length) {
      throw new AppError(`La misma unidad de “${establishmentName}” fue seleccionada más de una vez.`, 409, "WORK_LOCATION_UNIT_DUPLICATE");
    }
    for (const unitId of selection.unitIds) {
      const unit = unitById.get(unitId);
      if (!unit) throw new AppError("Una de las unidades seleccionadas no existe.", 400, "WORK_LOCATION_UNIT_INVALID");
      if (unit.archivedAt) throw new AppError(`La unidad “${unit.name}” está archivada y no puede asignarse.`, 400, "WORK_LOCATION_UNIT_ARCHIVED");
      if (unit.establishmentId !== selection.establishmentId) {
        throw new AppError(`La unidad “${unit.name}” no pertenece a “${establishmentName}”.`, 409, "WORK_LOCATION_UNIT_ESTABLISHMENT_MISMATCH");
      }
      if (unit.status !== "ACTIVO" && !input.keepUnitIds?.has(unit.id)) {
        throw new AppError(`La unidad “${unit.name}” está inactiva y no puede asignarse.`, 409, "WORK_LOCATION_UNIT_INACTIVE");
      }
    }
  }
}

/** Clave canónica de una selección, para comparar sin depender del orden. */
export function selectionKey(selections: EstablishmentSelection[]) {
  return selections
    .map((item) => `${item.establishmentId}:${item.coverage}:${item.coverage === "UNITS" ? [...item.unitIds].sort().join(",") : ""}`)
    .sort()
    .join("|");
}

/** Texto de negocio de un establecimiento asignado: "La Suiza (Lote Norte, Lote Sur)" o "Oficina Central". */
export function establishmentLabel(name: string, coverage: WorkLocationCoverage, unitNames: string[]) {
  if (coverage !== "UNITS") return name;
  return `${name} (${[...unitNames].sort((a, b) => a.localeCompare(b, "es")).join(", ")})`;
}

/** Nodos de Ubicaciones que se eliminan (eliminación controlada, shared/deletion). */
export type LocationNodeRemoval = { zoneIds: ReadonlySet<string>; establishmentIds: ReadonlySet<string>; unitIds: ReadonlySet<string> };

/**
 * Qué pasa con una asignación que no terminó antes de hoy cuando se eliminan
 * nodos de Ubicaciones. Nunca amplía: una selección de unidades que queda
 * vacía saca al establecimiento, no lo convierte en "completo".
 * - CLOSE: ya regía antes de hoy → se cierra ayer; si queda selección, sigue
 *   desde hoy en una vigencia nueva (`next`).
 * - NARROW: todavía no rige → se corrige la misma fila con lo que queda.
 * - CANCEL: todavía no rige y no queda nada → se cancela (no tiene historia).
 * null: no la alcanza (p. ej. establecimiento completo cuyo lote se elimina).
 */
export type WorkLocationDetachment =
  | { kind: "CLOSE"; closeTo: string; next: EstablishmentSelection[] }
  | { kind: "NARROW"; next: EstablishmentSelection[] }
  | { kind: "CANCEL" };

export function planWorkLocationDetachment(
  row: { zoneId: string; effectiveFrom: string; establishments: EstablishmentSelection[] },
  removal: LocationNodeRemoval,
  todayKey: string,
): WorkLocationDetachment | null {
  const next = removal.zoneIds.has(row.zoneId)
    ? []
    : row.establishments
      .filter((item) => !removal.establishmentIds.has(item.establishmentId))
      .map((item) => (item.coverage === "UNITS" ? { ...item, unitIds: item.unitIds.filter((unitId) => !removal.unitIds.has(unitId)) } : item))
      .filter((item) => item.coverage !== "UNITS" || item.unitIds.length > 0);
  if (selectionKey(next) === selectionKey(row.establishments)) return null;
  if (row.effectiveFrom >= todayKey) return next.length ? { kind: "NARROW", next } : { kind: "CANCEL" };
  return { kind: "CLOSE", closeTo: previousCalendarDateKey(todayKey), next };
}
