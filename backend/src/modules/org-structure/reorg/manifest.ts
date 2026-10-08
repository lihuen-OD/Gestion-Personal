// Manifiesto por fila y verificaciones V1/V2
// (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5.4). Funciones puras: el
// script captura el manifiesto con consultas de sólo lectura y estas
// funciones comparan.
//
// Cada fila se identifica por su clave primaria y guarda:
// - `stable`: hash del contenido excluyendo las columnas vigiladas y las
//   volátiles (updatedAt) de las tablas vigiladas;
// - `watched`: valores en claro de las columnas cuyo cambio puede estar
//   autorizado (vínculos que la limpieza vacía, datos laborales de la recarga).
// En `Employee`, `stable` es el hash personal/protegido: nunca puede cambiar.

export const WATCHED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  // A8 §12.9.4: `archivedAt` es la única columna de las 6 tablas de
  // DELETE_ORDER cuyo cambio puede estar autorizado en V1 (sólo en los IDs
  // `retained` del manifiesto; cualquier otro diff aborta).
  Company: ["archivedAt"],
  BusinessUnit: ["archivedAt"],
  Establishment: ["archivedAt"],
  Area: ["archivedAt"],
  Sector: ["archivedAt"],
  Position: ["archivedAt"],
  Employee: ["positionId", "sectorId", "costCenterId", "receiptCategory", "internalCategory", "agreement", "healthInsurance"],
  User: ["sectorId", "companyId"],
  ClockDevice: ["sectorId", "establishmentId"],
  DoubleHourRule: ["companyId", "sectorId", "positionId", "status"],
  AuditLog: ["entity", "entityId", "createdAt"],
};

/** Columnas que una escritura vía Prisma actualiza solas: se excluyen del hash estable de las tablas vigiladas. */
export const VOLATILE_COLUMNS: readonly string[] = ["updatedAt"];

export type WatchedValues = Record<string, string | null>;
export interface RowEntry { stable: string; watched?: WatchedValues }
export interface TableManifest { key: string[]; columns: string[]; rows: Record<string, RowEntry> }
export interface RowManifest { takenAt: string; host: string; tables: Record<string, TableManifest> }

export interface Violation { table: string; key?: string; code: string; message: string }

/** Columnas incluidas en el hash estable de una tabla. */
export function stableColumns(table: string, columns: string[]): string[] {
  const watched = WATCHED_COLUMNS[table];
  if (!watched) return columns;
  return columns.filter((column) => !watched.includes(column) && !VOLATILE_COLUMNS.includes(column));
}

// ---------------------------------------------------------------------------
// V1 — tras la limpieza: cambia SOLO lo autorizado.
// ---------------------------------------------------------------------------

export interface V1Expectation {
  /** Claves (PK) que deben haber desaparecido, por tabla. */
  deleted: Record<string, string[]>;
  /** Columnas vigiladas que debían pasar a NULL, por tabla y clave. */
  nullified: Record<string, Record<string, string[]>>;
  /** Cambios autorizados en reglas (R1/R2/inactivación): clave → columna → valor nuevo. */
  ruleChanges: Record<string, WatchedValues>;
  /** Filas nuevas autorizadas: tabla → claves exactas, o "AuditLog" con una cantidad exacta. */
  newRows: Record<string, string[]>;
  /** Cantidad exacta de filas nuevas de AuditLog, o "ANY" (restauración: la auditoría nunca se borra). */
  newAuditRows: number | "ANY";
  /** A8 §12.1/§12.9.4: tablas → claves que DEBEN haber quedado con `archivedAt` NOT NULL (`retained`). */
  archived?: Record<string, string[]>;
}

export function verifyV1(pre: RowManifest, post: RowManifest, expected: V1Expectation): Violation[] {
  const violations: Violation[] = [];
  for (const [table, before] of Object.entries(pre.tables)) {
    const after = post.tables[table];
    if (!after) { violations.push({ table, code: "TABLE_MISSING", message: "La tabla desapareció." }); continue; }
    const deleted = new Set(expected.deleted[table] ?? []);
    for (const [key, row] of Object.entries(before.rows)) {
      const now = after.rows[key];
      if (deleted.has(key)) {
        if (now) violations.push({ table, key, code: "NOT_DELETED", message: "Debía borrarse y sigue presente." });
        continue;
      }
      if (!now) { violations.push({ table, key, code: "UNEXPECTED_DELETE", message: "Fila borrada fuera del alcance autorizado." }); continue; }
      if (now.stable !== row.stable) violations.push({ table, key, code: "CONTENT_CHANGED", message: "Cambió contenido no autorizado." });
      const nullified = new Set(expected.nullified[table]?.[key] ?? []);
      const ruleChange = table === "DoubleHourRule" ? expected.ruleChanges[key] ?? {} : {};
      const archived = new Set(expected.archived?.[table] ?? []);
      const mustBeArchived = archived.has(key);
      if (mustBeArchived && !now.watched?.archivedAt) {
        violations.push({ table, key, code: "NOT_ARCHIVED", message: "Debía quedar archivado (archivedAt NOT NULL) y no lo está." });
      }
      for (const [column, value] of Object.entries(row.watched ?? {})) {
        const current = now.watched?.[column] ?? null;
        if (column === "archivedAt" && mustBeArchived) continue; // exactamente el whitelist de §12.9.4
        if (nullified.has(column)) {
          if (current !== null) violations.push({ table, key, code: "NOT_NULLIFIED", message: `${column} debía quedar vacío.` });
        } else if (column in ruleChange) {
          if (current !== ruleChange[column]) violations.push({ table, key, code: "RULE_CHANGE_MISMATCH", message: `${column} no tiene el valor decidido.` });
        } else if (current !== value) {
          violations.push({ table, key, code: "WATCHED_CHANGED", message: `${column} cambió sin autorización.` });
        }
      }
    }
    for (const key of deleted) {
      if (!(key in before.rows)) violations.push({ table, key, code: "DELETE_NOT_IN_MANIFEST", message: "Se esperaba borrar una clave que no estaba en el manifiesto previo." });
    }
    const added = Object.keys(after.rows).filter((key) => !(key in before.rows));
    if (table === "AuditLog") {
      if (expected.newAuditRows !== "ANY" && added.length !== expected.newAuditRows) violations.push({ table, code: "AUDIT_COUNT", message: `Se esperaban ${expected.newAuditRows} filas de auditoría nuevas y hay ${added.length}.` });
    } else {
      const allowed = new Set(expected.newRows[table] ?? []);
      for (const key of added) if (!allowed.has(key)) violations.push({ table, key, code: "UNEXPECTED_NEW_ROW", message: "Fila nueva no autorizada." });
      for (const key of allowed) if (!added.includes(key)) violations.push({ table, key, code: "MISSING_NEW_ROW", message: "Falta una fila nueva esperada." });
    }
  }
  for (const table of Object.keys(post.tables)) {
    if (!pre.tables[table]) violations.push({ table, code: "TABLE_ADDED", message: "Tabla nueva inesperada." });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// V2 — tras la recarga: cambios laborales explícitos y auditados.
// ---------------------------------------------------------------------------

/** Catálogos y vínculos que la recarga manual vuelve a cargar o editar. */
export const RELOAD_MUTABLE_TABLES: readonly string[] = [
  "Company", "BusinessUnit", "Sector", "Area", "Zone", "Establishment", "Position", "PositionSalaryCategory", "PositionOrgScope",
  "CostCenter", "CostCenterCompany", "CostCenterBusinessUnit", "CostCenterEstablishment", "CostCenterArea", "CostCenterSector",
  "EmployeeCompany", "EmployeeWorkLocation", "EmployeeWorkLocationEstablishment", "ClockDevice", "User", "_prisma_migrations",
];

export interface V2Summary { violations: Violation[]; newRowsByTable: Record<string, number>; laborChanges: number }

export function verifyV2(baseline: RowManifest, current: RowManifest): V2Summary {
  const violations: Violation[] = [];
  const newRowsByTable: Record<string, number> = {};
  const auditBefore = baseline.tables.AuditLog?.rows ?? {};
  const auditNow = current.tables.AuditLog?.rows ?? {};
  const auditedEmployees = new Set(
    Object.entries(auditNow).filter(([key, row]) => !(key in auditBefore) && row.watched?.entity === "Employee").map(([, row]) => row.watched?.entityId),
  );
  let laborChanges = 0;

  for (const [table, before] of Object.entries(baseline.tables)) {
    const after = current.tables[table];
    if (!after) { violations.push({ table, code: "TABLE_MISSING", message: "La tabla desapareció." }); continue; }
    newRowsByTable[table] = Object.keys(after.rows).filter((key) => !(key in before.rows)).length;
    if (RELOAD_MUTABLE_TABLES.includes(table)) continue;
    for (const [key, row] of Object.entries(before.rows)) {
      const now = after.rows[key];
      if (!now) { violations.push({ table, key, code: "PROTECTED_DELETED", message: "Registro protegido borrado." }); continue; }
      if (now.stable !== row.stable) violations.push({ table, key, code: "PROTECTED_CHANGED", message: table === "Employee" ? "Cambiaron datos personales o protegidos del legajo." : "Cambió un registro protegido." });
      if (table === "Employee") {
        const changed = Object.entries(row.watched ?? {}).filter(([column, value]) => (now.watched?.[column] ?? null) !== value);
        if (changed.length) {
          laborChanges += 1;
          if (!auditedEmployees.has(key)) violations.push({ table, key, code: "UNAUDITED_LABOR_CHANGE", message: `Cambio laboral sin auditoría: ${changed.map(([column]) => column).join(", ")}.` });
        }
      }
    }
  }
  return { violations, newRowsByTable, laborChanges };
}
