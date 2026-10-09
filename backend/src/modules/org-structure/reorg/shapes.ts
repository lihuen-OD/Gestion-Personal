// Formas por fila de los seis catálogos y fases F0/F1 de la especificación de
// archivo (docs/decisions/A8_M2_PREPARATION.md §12.3) + G1 (§12.5). Funciones
// puras: los scripts leen las filas (sólo lectura) y estas funciones deciden.
//
// - F0 (paso 3, antes de escribir) clasifica cada fila como vieja o nueva
//   IGNORANDO `archivedAt` (la columna existe pero está vacía); un estado
//   mixto aborta con tabla + IDs.
// - F1 (cierre del paso 5) exige la equivalencia final: en Establishment,
//   Area y Sector `archivedAt NOT NULL` ⇔ forma vieja; en Position la fila
//   archivada conserva el resto tal cual (sin alcances activos) y la activa
//   es nueva. Company y BusinessUnit tienen una sola forma.
//
// Archivado (`archivedAt`), origen (`isLegacy`) y estado operativo (`status`)
// son ejes distintos (§12.1): ninguna de estas funciones mira `status`.

import type { TargetTable } from "./cleanupPlan";

export interface ShapeRows {
  Company: Array<{ id: string; archivedAt: string | null }>;
  BusinessUnit: Array<{ id: string; companyId: string | null; archivedAt: string | null }>;
  Establishment: Array<{ id: string; zoneId: string | null; companyId: string | null; businessUnitId: string | null; archivedAt: string | null }>;
  Area: Array<{ id: string; sectorId: string | null; establishmentId: string | null; archivedAt: string | null }>;
  Sector: Array<{ id: string; isLegacy: boolean; businessUnitId: string | null; areaId: string | null; archivedAt: string | null }>;
  /** `activeScopes`: filas de `PositionOrgScope` vigentes del puesto. */
  Position: Array<{ id: string; sectorId: string | null; activeScopes: number; archivedAt: string | null }>;
}

export type Shape = "OLD" | "NEW" | "MIXED" | "SINGLE";

export interface ShapeViolation { table: TargetTable; id: string; code: string; message: string }

const isSet = (value: string | null | undefined) => value !== null && value !== undefined;

/** Forma de una fila según la tabla de §12.3, sin mirar `archivedAt`. */
export function shapeOf<T extends TargetTable>(table: T, row: ShapeRows[T][number]): { shape: Shape; reason?: string } {
  switch (table) {
    case "Company":
      return { shape: "SINGLE" };
    case "BusinessUnit": {
      const bu = row as ShapeRows["BusinessUnit"][number];
      return isSet(bu.companyId) ? { shape: "SINGLE" } : { shape: "MIXED", reason: "unidad de negocio sin empresa" };
    }
    case "Establishment": {
      const est = row as ShapeRows["Establishment"][number];
      if (!isSet(est.zoneId) && isSet(est.companyId)) return { shape: "OLD" };
      if (isSet(est.zoneId) && !isSet(est.companyId) && !isSet(est.businessUnitId)) return { shape: "NEW" };
      if (!isSet(est.zoneId) && !isSet(est.companyId)) return { shape: "MIXED", reason: "huérfano: sin zona ni empresa" };
      if (isSet(est.zoneId) && isSet(est.companyId)) return { shape: "MIXED", reason: "doble padre: zona y empresa" };
      return { shape: "MIXED", reason: "zona con unidad de negocio del modelo anterior" };
    }
    case "Area": {
      const area = row as ShapeRows["Area"][number];
      if (!isSet(area.sectorId) && isSet(area.establishmentId)) return { shape: "OLD" };
      if (isSet(area.sectorId) && !isSet(area.establishmentId)) return { shape: "NEW" };
      return { shape: "MIXED", reason: isSet(area.sectorId) ? "doble padre: sector y establecimiento" : "huérfana: sin sector ni establecimiento" };
    }
    case "Sector": {
      const sector = row as ShapeRows["Sector"][number];
      if (sector.isLegacy && !isSet(sector.businessUnitId)) return { shape: "OLD" };
      if (!sector.isLegacy && isSet(sector.businessUnitId) && !isSet(sector.areaId)) return { shape: "NEW" };
      if (sector.isLegacy !== !isSet(sector.businessUnitId)) return { shape: "MIXED", reason: "isLegacy contradice la unidad de negocio (G1)" };
      return { shape: "MIXED", reason: "sector nuevo con área del modelo anterior" };
    }
    case "Position": {
      const position = row as ShapeRows["Position"][number];
      if (isSet(position.sectorId) && position.activeScopes > 0) return { shape: "MIXED", reason: "sector del modelo anterior y alcances activos a la vez" };
      return { shape: isSet(position.sectorId) ? "OLD" : "NEW" };
    }
    default:
      return { shape: "MIXED", reason: "tabla desconocida" };
  }
}

const TABLES: readonly TargetTable[] = ["Company", "BusinessUnit", "Establishment", "Area", "Sector", "Position"];

function eachRow(rows: ShapeRows, visit: <T extends TargetTable>(table: T, row: ShapeRows[T][number]) => void) {
  for (const table of TABLES) for (const row of rows[table]) visit(table, row as never);
}

/** G1: `Sector.isLegacy ⇔ businessUnitId IS NULL` (§12.5). */
export function g1Violations(sectors: ShapeRows["Sector"]): ShapeViolation[] {
  return sectors
    .filter((sector) => sector.isLegacy !== !isSet(sector.businessUnitId))
    .map((sector) => ({ table: "Sector" as const, id: sector.id, code: "G1_CLASSIFICATION", message: `isLegacy=${sector.isLegacy} con businessUnitId ${isSet(sector.businessUnitId) ? "presente" : "vacío"}.` }));
}

export interface PhaseResult { ok: boolean; violations: ShapeViolation[]; counts: Record<TargetTable, Record<Shape, number>> }

function emptyCounts(): Record<TargetTable, Record<Shape, number>> {
  return Object.fromEntries(TABLES.map((table) => [table, { OLD: 0, NEW: 0, MIXED: 0, SINGLE: 0 }])) as Record<TargetTable, Record<Shape, number>>;
}

/**
 * F0 (§12.3): cada fila en exactamente una forma, evaluada SIN `archivedAt`
 * (F0.1), y G1 sin violaciones (F0.2). No exige ni mira el archivo.
 */
export function evaluateF0(rows: ShapeRows): PhaseResult {
  const violations: ShapeViolation[] = [];
  const counts = emptyCounts();
  eachRow(rows, (table, row) => {
    const { shape, reason } = shapeOf(table, row);
    counts[table][shape] += 1;
    if (shape === "MIXED") violations.push({ table, id: row.id, code: "F0_MIXED_SHAPE", message: `Estado mixto: ${reason}.` });
  });
  violations.push(...g1Violations(rows.Sector));
  return { ok: violations.length === 0, violations, counts };
}

/**
 * F1.3 (§12.3): formas finales con `archivedAt`. Establishment/Area/Sector:
 * archivado ⇔ forma vieja. Position: archivado ⇒ sin alcances activos (resto
 * tal cual); activo ⇒ forma nueva. Sin estados mixtos en ninguna tabla.
 */
export function evaluateF1Shapes(rows: ShapeRows): PhaseResult {
  const violations: ShapeViolation[] = [];
  const counts = emptyCounts();
  eachRow(rows, (table, row) => {
    const { shape, reason } = shapeOf(table, row);
    counts[table][shape] += 1;
    const archived = isSet(row.archivedAt);
    if (shape === "MIXED") {
      violations.push({ table, id: row.id, code: "F1_MIXED_SHAPE", message: `Estado mixto: ${reason}.` });
      return;
    }
    if (table === "Position") {
      const position = row as ShapeRows["Position"][number];
      if (archived && position.activeScopes > 0) violations.push({ table, id: row.id, code: "F1_ARCHIVED_WITH_SCOPES", message: "Puesto archivado con alcances activos." });
      if (!archived && shape !== "NEW") violations.push({ table, id: row.id, code: "F1_ACTIVE_OLD_SHAPE", message: "Puesto activo con sector del modelo anterior." });
      return;
    }
    if (shape === "SINGLE") return;
    if (archived && shape !== "OLD") violations.push({ table, id: row.id, code: "F1_ARCHIVED_NEW_SHAPE", message: "Fila archivada con forma nueva." });
    if (!archived && shape !== "NEW") violations.push({ table, id: row.id, code: "F1_ACTIVE_OLD_SHAPE", message: "Fila activa con forma vieja: debía archivarse o borrarse." });
  });
  return { ok: violations.length === 0, violations, counts };
}
