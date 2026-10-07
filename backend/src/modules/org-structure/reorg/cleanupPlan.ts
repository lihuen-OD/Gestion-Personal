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

export type TargetTable = "Company" | "BusinessUnit" | "Establishment" | "Area" | "Sector" | "Position";
export type CompanyMode = "C1" | "C2";

/** Orden de borrado: hijos antes que padres en la cadena del modelo anterior. */
export const DELETE_ORDER: readonly TargetTable[] = ["Position", "Sector", "Area", "Establishment", "BusinessUnit", "Company"];

export interface InventoryRecord {
  id: string;
  code: string;
  name: string;
  status: string;
  /** Padres del modelo anterior (legado), para retener ancestros con R3. */
  parents: Partial<Record<TargetTable, string | null>>;
}

export interface FrozenInventory {
  companyMode: CompanyMode;
  records: Record<TargetTable, InventoryRecord[]>;
}

export type TreatmentKind = "NULLIFY" | "DELETE_LINKS" | "CHAIN" | "RULE_DECISION" | "BLOCK";

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

export function classifyReference(ref: ReferenceCount): { treatment: TreatmentKind; issue?: Issue } {
  const treatment = treatmentOf(ref.table, ref.column);
  const label = `${ref.table}.${ref.column} → ${ref.target}`;
  if (treatment === "BLOCK" && ref.rowsToInventory > 0) {
    return { treatment, issue: { code: "UNCLASSIFIED_OR_NEW_DEPENDENCY", blocking: true, ref: label, message: `${ref.rowsToInventory} fila(s) de ${ref.table}.${ref.column} dependen de registros a borrar y la dependencia no tiene tratamiento autorizado (registro nuevo o FK no clasificada).` } };
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
}

export function buildCleanupPlan(input: CleanupPlanInput): CleanupPlan {
  const { inventory, references, rules, decisions } = input;
  const issues: Issue[] = [];
  const ruleOperations: RuleOperation[] = [];
  const retainRoots: Array<{ table: TargetTable; id: string }> = [];
  const decisionOf = new Map(decisions.map((decision) => [decision.ruleId, decision]));

  if (inventory.companyMode === "C1" && inventory.records.Company.length) {
    issues.push({ code: "COMPANIES_IN_C1", blocking: true, message: "Modo C1 (conservar empresas) con empresas en el inventario: el inventario no corresponde al modo." });
  }

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

  for (const reference of references) {
    const { treatment, issue } = classifyReference(reference);
    // RULE_DECISION se evalúa arriba regla por regla.
    if (issue && treatment !== "RULE_DECISION") issues.push(issue);
  }

  const retained = retainedClosure(inventory, retainRoots);
  const deletable = {} as Record<TargetTable, string[]>;
  for (const table of DELETE_ORDER) {
    deletable[table] = inventory.records[table].map((record) => record.id).filter((id) => !retained.has(`${table}:${id}`));
  }

  const byTreatment = (kind: TreatmentKind) => references
    .filter((reference) => treatmentOf(reference.table, reference.column) === kind)
    .map((reference) => ({ table: reference.table, column: reference.column, target: reference.target }));

  return {
    companyMode: inventory.companyMode,
    deletable,
    retained: [...retained.values()],
    ruleOperations,
    nullify: byTreatment("NULLIFY"),
    deleteLinks: byTreatment("DELETE_LINKS"),
    deleteOrder: DELETE_ORDER,
    issues,
    blocking: issues.some((issue) => issue.blocking),
  };
}
