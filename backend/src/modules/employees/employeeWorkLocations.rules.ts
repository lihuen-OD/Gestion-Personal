import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate } from "../../shared/datetime/argentinaTime";

/**
 * Reglas puras de ubicaciones de trabajo (ORG_LOCATION_REORGANIZATION.md
 * §3.3). Las fechas son claves de calendario "YYYY-MM-DD": se comparan como
 * texto y nunca pasan por un huso horario. Vigencia = intervalo cerrado
 * [effectiveFrom, effectiveTo]; effectiveTo null = abierta.
 */
export type WorkLocationPeriod = { id: string; zoneId: string; effectiveFrom: string; effectiveTo: string | null };
export type WorkLocationState = "CURRENT" | "FUTURE" | "ENDED";

type NamedNode = { id: string; name: string; status: string };
export type ResolvedZone = NamedNode;
// A8 §12.1: `archivedAt` alimenta el rechazo de asignación a un establecimiento archivado.
export type ResolvedEstablishment = NamedNode & { zoneId: string | null; archivedAt?: Date | null };

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
