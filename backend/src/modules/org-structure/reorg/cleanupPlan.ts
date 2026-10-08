// Plan de limpieza controlada del modelo organizacional anterior
// (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5 y §6). Funciones puras:
// reciben el inventario congelado, las referencias encontradas en el catálogo
// de la base y las decisiones por regla, y devuelven las operaciones y los
// bloqueos. No tocan la base: el script de limpieza vuelve a verificar todo
// dentro de su transacción.
//
// Principios:
// - Sólo se borran/vacían IDs del inventario congelado; los registros nuevos
//   quedan fuera aunque estén en las mismas tablas.
// - Borrado explícito y en orden: ningún CASCADE ni SET NULL de la base debe
//   dispararse.
// - Una DoubleHourRule nunca se libera dejando su alcance en NULL (la
//   ampliaría) ni se borra: sólo R1 (reasignar), R2 (lista explícita no
//   vacía) o R3 (retener el destino viejo). Inactivar sólo se combina.
// - Toda FK desconocida hacia la estructura bloquea (fail closed).
// - A8 §12.2: el inventario congelado lleva `history` con los IDs exactos de
//   las 7 tablas de historia (D-5); un destino referenciado por historia se
//   promueve a raíz → retained → archivado, nunca se borra. Un ID fuera del
//   inventario bloquea SIN reconocimiento ni flag: la única salida es ampliar
//   el inventario y re-congelar (§12.2).
// - La historia temporal de D-5 (§19) nunca se borra ni se vacía para liberar
//   un registro: si referencia algo del inventario, la limpieza se bloquea
//   hasta retener ese registro o resolverlo con una decisión explícita.

export type TargetTable = "Company" | "BusinessUnit" | "Establishment" | "Area" | "Sector" | "Position";
export type CompanyMode = "C1" | "C2";

/** Orden de borrado: hijos antes que padres en la cadena del modelo anterior. */
export const DELETE_ORDER: readonly TargetTable[] = ["Position", "Sector", "Area", "Establishment", "BusinessUnit", "Company"];

export type InventoryClass = "borrable" | "conservada" | "nueva";

export interface InventoryRecord {
  id: string;
  code: string;
  name: string;
  status: string;
  /** Padres del modelo anterior (legado), para retener ancestros con R3. */
  parents: Partial<Record<TargetTable, string | null>>;
  /**
   * Clase de membresía de la transición (A8 §12.2): `borrable` (por defecto)
   * candidato a borrado; `conservada` (en alcance y activa por el modo, p. ej.
   * empresa bajo C1) o `nueva` (catálogo fuera de la transición) cuando una
   * ampliación la incorpora. Sólo un `borrable` referenciado por historia se
   * promueve a raíz → archivado; `conservada`/`nueva` nunca se archivan ni se
   * borran.
   */
  class?: InventoryClass;
}

/** Referencia de historia temporal (D-5) con los IDs EXACTOS, no sólo conteos (A8 §12.2). */
export interface HistoryReference {
  /** `Tabla.columna` de origen, p. ej. "EmployeeLegacySectorPeriod.sectorId". */
  source: string;
  targetTable: TargetTable;
  /** IDs exactos referenciados, ordenados y sin duplicados. */
  referencedIds: string[];
  /** ∩ inventario congelado (records, cualquier clase). */
  insideInventory: string[];
  /** ∉ inventario, listados uno a uno. Bloquea sin reconocimiento ni flag. */
  outsideInventory: string[];
}

/**
 * Resolución de una fila de CLASE 4 (fila del modelo nuevo que apunta a un ID
 * del inventario, A8 §3.2): `retain` promueve el destino a raíz (queda
 * archivado), `retire` retira la fila nueva (borrado autorizado de fila, §12.4).
 * Sin resolución, la referencia sigue bloqueando con `UNCLASSIFIED_OR_NEW_DEPENDENCY`.
 */
export interface ClassFourResolution {
  table: string;
  column: string;
  target: TargetTable;
  retain: string[];
  retire: string[];
}

export interface FrozenInventory {
  companyMode: CompanyMode;
  records: Record<TargetTable, InventoryRecord[]>;
  /** Historia temporal (A8 §12.2), si el congelado la produjo. */
  history?: HistoryReference[];
}

export type TreatmentKind = "NULLIFY" | "DELETE_LINKS" | "CHAIN" | "RULE_DECISION" | "HISTORY" | "BLOCK";

/**
 * Tratamiento de cada FK hacia la estructura, por `Tabla.columna`. Lo no
 * listado es BLOCK: si aparece una FK nueva, la limpieza se detiene hasta
 * clasificarla.
 */
export const REFERENCE_TREATMENTS: Readonly<Record<string, TreatmentKind>> = {
  // Vínculos incompatibles de legajos/usuarios/dispositivos: se vacían (autorizado).
  "Employee.positionId": "NULLIFY",
  "Employee.sectorId": "NULLIFY",
  "User.sectorId": "NULLIFY",
  "User.companyId": "NULLIFY",
  "ClockDevice.sectorId": "NULLIFY",
  // Filas de vínculo del modelo anterior: se borran explícitamente.
  "EmployeeCompany.companyId": "DELETE_LINKS",
  "PositionSalaryCategory.positionId": "DELETE_LINKS",
  "CostCenterCompany.companyId": "DELETE_LINKS",
  "CostCenterBusinessUnit.businessUnitId": "DELETE_LINKS",
  "CostCenterEstablishment.establishmentId": "DELETE_LINKS",
  "CostCenterArea.areaId": "DELETE_LINKS",
  "CostCenterSector.sectorId": "DELETE_LINKS",
  // Cadena interna del modelo anterior: ambos extremos en el inventario.
  "BusinessUnit.companyId": "CHAIN",
  "Establishment.companyId": "CHAIN",
  "Establishment.businessUnitId": "CHAIN",
  "Area.establishmentId": "CHAIN",
  "Sector.areaId": "CHAIN",
  "Position.sectorId": "CHAIN",
  // Reglas de horas especiales: requieren decisión explícita por regla.
  "DoubleHourRule.companyId": "RULE_DECISION",
  "DoubleHourRule.sectorId": "RULE_DECISION",
  "DoubleHourRule.positionId": "RULE_DECISION",
  // Historia temporal (D-5): conocida, pero nunca tratable por la limpieza.
  "EmployeePositionPeriod.positionId": "HISTORY",
  "EmployeeLegacySectorPeriod.sectorId": "HISTORY",
  "EmployeeEmployerPeriodCompany.companyId": "HISTORY",
  "PositionOrgScopePeriod.positionId": "HISTORY",
  "PositionOrgScopePeriodNode.companyId": "HISTORY",
  "PositionOrgScopePeriodNode.businessUnitId": "HISTORY",
  "PositionOrgScopePeriodNode.sectorId": "HISTORY",
  "PositionOrgScopePeriodNode.areaId": "HISTORY",
  "PositionOrgScopePeriodNode.areaSectorId": "HISTORY",
};

export interface ReferenceCount {
  constraint: string;
  table: string;
  column: string;
  target: TargetTable;
  /** confdeltype de Postgres: a=no action, r=restrict, c=cascade, n=set null, d=set default. */
  onDelete: string;
  /** Filas que apuntan a un ID del inventario. */
  rowsToInventory: number;
  /** De esas, cuántas son registros que NO están en el inventario. */
  rowsOutsideInventory: number;
  /**
   * IDs exactos del inventario referenciados por esta FK (A8 §12.2/§12.4:
   * los reportes listan IDs, no sólo conteos). Opcional para no romper
   * consumidores que sólo cuentan; el plan lo usa cuando está presente.
   */
  targetIds?: string[];
}

export interface Issue {
  code: string;
  blocking: boolean;
  message: string;
  ref?: string;
}

export function treatmentOf(table: string, column: string): TreatmentKind {
  return REFERENCE_TREATMENTS[`${table}.${column}`] ?? "BLOCK";
}

export interface ClassifyOptions {
  /**
   * A8 §12.7/AT-7: la historia hacia `Company` en C2 sólo deja de bloquear
   * cuando la capacidad de §12.7 está implementada y activada
   * (`archiveHistoryCompanies`); mientras tanto C2 aborta (HT-4).
   */
  historyBlocking?: boolean;
  /** IDs del inventario que NO resuelve ninguna resolución de clase 4 (§12.4). */
  unresolvedIds?: string[];
}

/**
 * Particiona los IDs referenciados por una fuente de historia contra el
 * inventario congelado (A8 §12.2): `referencedIds` exactos ordenados y sin
 * duplicados; `insideInventory` = ∩ inventario (cualquier clase);
 * `outsideInventory` = ∉ inventario, uno a uno (bloquea, única salida ampliar).
 * Producida por el script de inventario y consumida por `buildCleanupPlan`.
 */
export function partitionHistoryReference(source: string, targetTable: TargetTable, referencedIds: string[], inventory: Pick<FrozenInventory, "records">): HistoryReference {
  const ids = [...new Set(referencedIds)].sort();
  const known = new Set(inventory.records[targetTable].map((record) => record.id));
  const insideInventory = ids.filter((id) => known.has(id));
  const outsideInventory = ids.filter((id) => !known.has(id));
  return { source, targetTable, referencedIds: ids, insideInventory, outsideInventory };
}

export function classifyReference(ref: ReferenceCount, options?: ClassifyOptions): { treatment: TreatmentKind; issue?: Issue } {
  const treatment = treatmentOf(ref.table, ref.column);
  const label = `${ref.table}.${ref.column} → ${ref.target}`;
  if (treatment === "BLOCK" && ref.rowsToInventory > 0) {
    const unresolved = options?.unresolvedIds;
    if (unresolved && !unresolved.length) return { treatment };
    const detail = unresolved?.length ? ` IDs sin resolver: ${unresolved.join(", ")}.` : "";
    return { treatment, issue: { code: "UNCLASSIFIED_OR_NEW_DEPENDENCY", blocking: true, ref: label, message: `${ref.rowsToInventory} fila(s) de ${ref.table}.${ref.column} dependen de registros del inventario y la dependencia no tiene tratamiento autorizado (registro nuevo o FK no clasificada).${detail}` } };
  }
  if (treatment === "HISTORY" && ref.rowsToInventory > 0) {
    // A8 §12.2: con raíces históricas la referencia queda informativa (los
    // destinos entran a retained → archivado), salvo el aborto de C2 (§12.7).
    if (options?.historyBlocking) {
      return { treatment, issue: { code: "HISTORY_REFERENCES_INVENTORY", blocking: true, ref: label, message: `${ref.rowsToInventory} fila(s) de historia temporal (${ref.table}.${ref.column}) referencian empresas del inventario en C2. La historia nunca se borra ni se vacía: C2 aborta hasta que la capacidad de §12.7 (archivo de empresas por historia) esté implementada y activada.` } };
    }
    return { treatment, issue: { code: "HISTORY_REFERENCES_INVENTORY", blocking: false, ref: label, message: `${ref.rowsToInventory} fila(s) de historia temporal (${ref.table}.${ref.column}) referencian registros del inventario: esos destinos se promueven a raíz → retained → archivado (A8 §12.2); la historia no se borra.` } };
  }
  if (treatment === "CHAIN" && ref.rowsOutsideInventory > 0) {
    return { treatment, issue: { code: "OUTSIDE_RECORD_DEPENDS_ON_INVENTORY", blocking: true, ref: label, message: `${ref.rowsOutsideInventory} registro(s) de ${ref.table} fuera del inventario dependen de registros a borrar.` } };
  }
  return { treatment };
}

// ---------------------------------------------------------------------------
// Reglas de horas especiales
// ---------------------------------------------------------------------------

export type RuleDimension = "companyId" | "sectorId" | "positionId";
const DIMENSION_TARGET: Record<RuleDimension, TargetTable> = { companyId: "Company", sectorId: "Sector", positionId: "Position" };

export interface RuleReference {
  ruleId: string;
  name: string;
  status: string;
  companyId: string | null;
  sectorId: string | null;
  positionId: string | null;
  /** Legajos que HOY cumplen el alcance completo de la regla (todas sus dimensiones y lista). */
  currentPopulation: string[];
}

export type RuleDecision =
  | { ruleId: string; treatment: "R1"; targets: Partial<Record<RuleDimension, string>>; inactivate?: boolean; approvedBy?: string; note?: string }
  | { ruleId: string; treatment: "R2"; inactivate?: boolean; approvedBy?: string; note?: string }
  | { ruleId: string; treatment: "R3"; inactivate?: boolean; approvedBy?: string; note?: string };

/** Estado de un destino nuevo propuesto para R1 (lo resuelve el script). */
export interface R1TargetState {
  exists: boolean;
  /** Registro del modelo anterior (sector sin UN, etc.) o incluido en el inventario. */
  legacyOrInventory: boolean;
}

export type RuleOperation =
  | { ruleId: string; kind: "R1"; set: Partial<Record<RuleDimension, string>> }
  | { ruleId: string; kind: "R2"; employeeIds: string[]; clear: RuleDimension[] }
  | { ruleId: string; kind: "INACTIVATE" };

function inventoryIdSet(inventory: FrozenInventory) {
  const sets = {} as Record<TargetTable, Set<string>>;
  for (const table of DELETE_ORDER) sets[table] = new Set(inventory.records[table].map((record) => record.id));
  return sets;
}

/** Dimensiones de la regla que apuntan a un ID del inventario. */
export function inventoryDimensions(rule: RuleReference, inventory: FrozenInventory): RuleDimension[] {
  const ids = inventoryIdSet(inventory);
  return (Object.keys(DIMENSION_TARGET) as RuleDimension[]).filter((dimension) => {
    const value = rule[dimension];
    return value !== null && ids[DIMENSION_TARGET[dimension]].has(value);
  });
}

// ---------------------------------------------------------------------------
// Retención (R3) y conjuntos a borrar
// ---------------------------------------------------------------------------

const PARENT_TABLES: Record<TargetTable, TargetTable[]> = {
  Position: ["Sector"],
  Sector: ["Area"],
  Area: ["Establishment"],
  Establishment: ["BusinessUnit", "Company"],
  BusinessUnit: ["Company"],
  Company: [],
};

/** Retiene los IDs pedidos y todos sus ancestros del modelo anterior (no se puede borrar el padre de algo retenido). */
export function retainedClosure(inventory: FrozenInventory, roots: Array<{ table: TargetTable; id: string }>): Map<string, { table: TargetTable; id: string }> {
  const byId = {} as Record<TargetTable, Map<string, InventoryRecord>>;
  for (const table of DELETE_ORDER) byId[table] = new Map(inventory.records[table].map((record) => [record.id, record]));
  const retained = new Map<string, { table: TargetTable; id: string }>();
  const visit = (table: TargetTable, id: string) => {
    const key = `${table}:${id}`;
    const record = byId[table].get(id);
    if (!record || retained.has(key)) return;
    retained.set(key, { table, id });
    for (const parentTable of PARENT_TABLES[table]) {
      const parentId = record.parents[parentTable];
      if (parentId) visit(parentTable, parentId);
    }
  };
  for (const root of roots) visit(root.table, root.id);
  return retained;
}

export interface CleanupPlan {
  companyMode: CompanyMode;
  deletable: Record<TargetTable, string[]>;
  retained: Array<{ table: TargetTable; id: string }>;
  ruleOperations: RuleOperation[];
  nullify: Array<{ table: string; column: string; target: TargetTable }>;
  deleteLinks: Array<{ table: string; column: string; target: TargetTable }>;
  /** Filas clase 4 a retirar en la misma transacción (borrado autorizado de fila nueva, §12.4). */
  retireRows: Array<{ table: string; column: string; target: TargetTable; ids: string[] }>;
  deleteOrder: readonly TargetTable[];
  issues: Issue[];
  blocking: boolean;
}

export interface CleanupPlanInput {
  inventory: FrozenInventory;
  references: ReferenceCount[];
  rules: RuleReference[];
  decisions: RuleDecision[];
  r1Targets?: Record<string, R1TargetState>;
  /** Historia temporal (§12.2); si no se pasa, se toma `inventory.history`. */
  history?: HistoryReference[];
  /** Resoluciones de clase 4 (retener destino / retirar fila, §12.4). */
  classFour?: ClassFourResolution[];
  /**
   * A8 §12.7: capacidad de archivar en C2 las empresas referenciadas por
   * historia. `false` (default) = comportamiento actual: C2 aborta con
   * `HISTORY_REFERENCES_INVENTORY` (HT-4). Sólo se activa cuando las
   * condiciones de §12.7 están implementadas y D-1 lo decide en C2.
   */
  archiveHistoryCompanies?: boolean;
}

export function buildCleanupPlan(input: CleanupPlanInput): CleanupPlan {
  const { inventory, references, rules, decisions } = input;
  const history = input.history ?? inventory.history ?? [];
  const issues: Issue[] = [];
  const ruleOperations: RuleOperation[] = [];
  const retainRoots: Array<{ table: TargetTable; id: string }> = [];
  const retireRows: CleanupPlan["retireRows"] = [];
  const decisionOf = new Map(decisions.map((decision) => [decision.ruleId, decision]));

  if (inventory.companyMode === "C1" && inventory.records.Company.length) {
    issues.push({ code: "COMPANIES_IN_C1", blocking: true, message: "Modo C1 (conservar empresas) con empresas en el inventario: el inventario no corresponde al modo." });
  }

  const recordByTable = {} as Record<TargetTable, Map<string, InventoryRecord>>;
  for (const table of DELETE_ORDER) recordByTable[table] = new Map(inventory.records[table].map((record) => [record.id, record]));
  const isBorrable = (table: TargetTable, id: string) => {
    const record = recordByTable[table].get(id);
    return Boolean(record) && (record!.class ?? "borrable") === "borrable";
  };

  // §12.2 orden 2-3: raíces desde la historia. Un destino del inventario se
  // promueve (sólo si es borrable); conservada/nueva nunca se archiva; fuera
  // del inventario bloquea sin reconocimiento ni flag (única salida: ampliar).
  const historyRoots: Array<{ table: TargetTable; id: string }> = [];
  const archiveCompaniesByHistory =
    inventory.companyMode === "C1" || Boolean(input.archiveHistoryCompanies);
  for (const entry of history) {
    const inside = new Set(entry.insideInventory);
    const unknown = new Set<string>(entry.outsideInventory);
    for (const id of new Set(entry.referencedIds)) {
      if (!recordByTable[entry.targetTable].get(id)) { unknown.add(id); continue; }
    }
    // insideInventory que el congelado ya no contiene: inconsistencia → bloquea.
    for (const id of inside) {
      if (!recordByTable[entry.targetTable].get(id)) unknown.add(id);
    }
    for (const id of inside) {
      if (!isBorrable(entry.targetTable, id)) continue; // conservada/nueva: sin archivar
      if (entry.targetTable === "Company" && !archiveCompaniesByHistory) continue; // §12.7 gate off: C2 aborta
      historyRoots.push({ table: entry.targetTable, id });
    }
    if (unknown.size) {
      issues.push({
        code: "HISTORY_REFERENCE_OUTSIDE_INVENTORY",
        blocking: true,
        ref: entry.source,
        message: `${entry.source} referencia ID(s) fuera del inventario congelado: ${[...unknown].sort().join(", ")}. Bloquea sin reconocimiento ni flag: única salida, ampliar el inventario con esos destinos y sus dependencias, re-congelar y recalcular raíces/retención (A8 §12.2).`,
      });
    }
  }

  // §12.2 orden 3: retenciones de clase 4 (destino retenido) y retiro de la
  // fila nueva (borrado autorizado, §12.4). Sin resolución, la referencia
  // sigue bloqueando en la clasificación de abajo.
  const classFourCovered = new Map<string, Set<string>>();
  for (const resolution of input.classFour ?? []) {
    const key = `${resolution.table}.${resolution.column}`;
    const covered = classFourCovered.get(`${key}:${resolution.target}`) ?? new Set<string>();
    for (const id of [...new Set(resolution.retain)]) {
      covered.add(id);
      const record = recordByTable[resolution.target].get(id);
      if (!record) {
        issues.push({ code: "CLASS_FOUR_TARGET_MISSING", blocking: true, ref: key, message: `${key}: el destino retenido ${id} no está en el inventario congelado.` });
      } else if (isBorrable(resolution.target, id)) {
        retainRoots.push({ table: resolution.target, id });
      }
    }
    const retire = [...new Set(resolution.retire)].filter((id) => recordByTable[resolution.target].has(id));
    for (const id of retire) covered.add(id);
    for (const id of [...new Set(resolution.retire)]) {
      if (!recordByTable[resolution.target].has(id)) {
        issues.push({ code: "CLASS_FOUR_TARGET_MISSING", blocking: true, ref: key, message: `${key}: la fila clase 4 apunta a ${id}, que no está en el inventario congelado.` });
      }
    }
    if (retire.length) retireRows.push({ table: resolution.table, column: resolution.column, target: resolution.target, ids: retire });
    classFourCovered.set(`${key}:${resolution.target}`, covered);
  }

  // §12.2 orden 3: destinos R3.
  for (const rule of rules) {
    const dimensions = inventoryDimensions(rule, inventory);
    if (!dimensions.length) continue;
    const decision = decisionOf.get(rule.ruleId);
    const label = `Regla "${rule.name}"`;
    if (!decision) {
      issues.push({ code: "RULE_WITHOUT_DECISION", blocking: true, ref: rule.ruleId, message: `${label} referencia ${dimensions.join(", ")} del modelo anterior y no tiene decisión R1/R2/R3. No se borra ni se amplía.` });
      continue;
    }
    if (decision.treatment === "R1") {
      const missingDimensions = dimensions.filter((dimension) => !decision.targets[dimension]);
      if (missingDimensions.length) {
        issues.push({ code: "R1_INCOMPLETE", blocking: true, ref: rule.ruleId, message: `${label}: R1 no indica el destino nuevo de ${missingDimensions.join(", ")}.` });
        continue;
      }
      if (dimensions.includes("sectorId")) {
        issues.push({ code: "R1_SECTOR_REQUIRES_SEMANTICS", blocking: true, ref: rule.ruleId, message: `${label}: reasignar la dimensión sector requiere la decisión S (D-4) implementada en el motor (A7); hoy un legajo no tendría sector con qué coincidir.` });
      }
      for (const dimension of dimensions) {
        const target = decision.targets[dimension]!;
        const state = input.r1Targets?.[target];
        if (!state?.exists) issues.push({ code: "R1_TARGET_MISSING", blocking: true, ref: rule.ruleId, message: `${label}: el destino nuevo de ${dimension} no existe todavía (cargarlo antes de limpiar).` });
        else if (state.legacyOrInventory) issues.push({ code: "R1_TARGET_LEGACY", blocking: true, ref: rule.ruleId, message: `${label}: el destino nuevo de ${dimension} es un registro del modelo anterior.` });
      }
      if (dimensions.includes("positionId")) {
        issues.push({ code: "R1_POSITION_GAP", blocking: false, ref: rule.ruleId, message: `${label}: hasta reasignar el puesto nuevo a los legajos, la regla no los alcanza. La verificación de equivalencia de la transacción lo detecta.` });
      }
      ruleOperations.push({ ruleId: rule.ruleId, kind: "R1", set: Object.fromEntries(dimensions.map((dimension) => [dimension, decision.targets[dimension]!])) });
    } else if (decision.treatment === "R2") {
      if (!rule.currentPopulation.length) {
        issues.push({ code: "R2_EMPTY_POPULATION", blocking: true, ref: rule.ruleId, message: `${label}: hoy no alcanza a ningún legajo. Convertirla a lista vacía y quitar la dimensión la ampliaría a todos: R2 no aplica.` });
        continue;
      }
      ruleOperations.push({ ruleId: rule.ruleId, kind: "R2", employeeIds: [...rule.currentPopulation].sort(), clear: dimensions });
    } else {
      for (const dimension of dimensions) retainRoots.push({ table: DIMENSION_TARGET[dimension], id: rule[dimension]! });
      issues.push({ code: "R3_RETAINED", blocking: false, ref: rule.ruleId, message: `${label}: se retiene su destino del modelo anterior (y sus ancestros). M2 queda bloqueada hasta resolverla con R1 o R2.` });
    }
    if (decision.inactivate) ruleOperations.push({ ruleId: rule.ruleId, kind: "INACTIVATE" });
  }

  // §12.2 orden 4-5: retained antes que deletable.
  const retained = retainedClosure(inventory, [...historyRoots, ...retainRoots]);
  const deletable = {} as Record<TargetTable, string[]>;
  for (const table of DELETE_ORDER) {
    deletable[table] = inventory.records[table]
      .filter((record) => (record.class ?? "borrable") === "borrable")
      .map((record) => record.id)
      .filter((id) => !retained.has(`${table}:${id}`));
  }

  // §12.2 orden 6: aserción fail-closed — ningún ID referenciado por historia
  // puede seguir en deletable. (En C2 con el gate de §12.7 apagado las
  // empresas quedan acá a propósito: el aborto de C2 es doble y explícito.)
  const deletableSet = new Set(DELETE_ORDER.flatMap((table) => deletable[table]));
  const stillDeletable = [...new Set(history.flatMap((entry) => entry.referencedIds))].filter((id) => deletableSet.has(id)).sort();
  if (stillDeletable.length) {
    issues.push({
      code: "HISTORY_REFERENCE_STILL_DELETABLE",
      blocking: true,
      message: `Aserción fail-closed de A8 §12.2: ${stillDeletable.length} ID(s) referenciados por historia siguen deletable después de promover raíces: ${stillDeletable.join(", ")}. Aborta el plan.`,
    });
  }

  // §12.2 orden 7 + clasificación de referencias (la historia sólo bloquea en
  // C2 con el gate de §12.7 apagado; clase 4 sin resolver bloquea con IDs).
  for (const reference of references) {
    const historyBlocking = reference.target === "Company" && inventory.companyMode === "C2" && !input.archiveHistoryCompanies;
    const covered = classFourCovered.get(`${reference.table}.${reference.column}:${reference.target}`);
    const unresolvedIds = treatmentOf(reference.table, reference.column) === "BLOCK" && reference.targetIds
      ? reference.targetIds.filter((id) => isBorrable(reference.target as TargetTable, id) && !covered?.has(id))
      : undefined;
    const { treatment, issue } = classifyReference(reference, { historyBlocking, unresolvedIds });
    if (issue && treatment !== "RULE_DECISION") issues.push(issue);
  }

  return {
    companyMode: inventory.companyMode,
    deletable,
    retained: [...retained.values()],
    ruleOperations,
    nullify: references.filter((reference) => treatmentOf(reference.table, reference.column) === "NULLIFY").map((reference) => ({ table: reference.table, column: reference.column, target: reference.target })),
    deleteLinks: references.filter((reference) => treatmentOf(reference.table, reference.column) === "DELETE_LINKS").map((reference) => ({ table: reference.table, column: reference.column, target: reference.target })),
    retireRows,
    deleteOrder: DELETE_ORDER,
    issues,
    blocking: issues.some((issue) => issue.blocking),
  };
}
