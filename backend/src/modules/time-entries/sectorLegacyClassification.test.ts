import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { evaluateSpecialHourRulesByDate } from "./timeEntries.repository";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));

/**
 * A8-3 (docs/decisions/A8_M2_PREPARATION.md §3.4; ADR §20, hallazgo 1):
 * clasificación legado/nuevo del sector PERSISTIDA en `Sector.isLegacy`.
 *
 * Antes de A8-3 la clasificación se derivaba en cada lectura del padre actual
 * (`Boolean(rule.sectorId) && !rule.sector?.businessUnitId`), de modo que un
 * re-padreamiento — o el NOT NULL de `Sector.businessUnitId` de M2 —
 * reinterpretaba la ruta de evaluación de una regla existente
 * (LEGACY_SECTOR contra EmployeeLegacySectorPeriod vs. “Ubicado dentro de”
 * sobre los alcances del puesto) y con ella la resolución histórica.
 *
 * Este archivo corre el MOTOR REAL (evaluateSpecialHourRulesByDate) sobre un
 * cliente en memoria: nada escribe en ninguna base y todos los sectores son
 * fixtures — no se reubica ningún nodo histórico real.
 *
 * El “antes” se modela fielmente: la única diferencia del motor pre-A8-3 era
 * cómo calculaba la bandera, así que alimentarla con el criterio previo
 * (businessUnitId IS NULL) reproduce exactamente su resolución.
 */
type Row = { id: string; effectiveFrom: Date; effectiveTo: Date | null };
const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
const period = (from: string, to: string | null = null) => ({ id: `p-${from}`, effectiveFrom: d(from), effectiveTo: to ? d(to) : null });

type World = {
  position?: Array<Row & { positionId: string | null }>;
  costCenter?: Array<Row & { costCenterId: string | null }>;
  legacySector?: Array<Row & { sectorId: string | null }>;
  employer?: Array<Row & { companies: Array<{ companyId: string }> }>;
  scopes?: Array<Row & { positionId: string; nodes: Array<{ level: string; companyId: string | null; businessUnitId: string | null; sectorId: string | null; areaId: string | null; areaSectorId: string | null }> }>;
  rules: Array<Record<string, unknown>>;
  convocations?: Array<{ date: Date; employeeId: string }>;
};

function db(world: World) {
  return {
    employeePositionPeriod: { findMany: async () => world.position ?? [] },
    employeeCostCenterPeriod: { findMany: async () => world.costCenter ?? [] },
    employeeLegacySectorPeriod: { findMany: async () => world.legacySector ?? [] },
    employeeEmployerPeriod: { findMany: async () => world.employer ?? [] },
    positionOrgScopePeriod: { findMany: async () => world.scopes ?? [] },
    doubleHourRule: { findMany: async ({ where }: { where: { kind?: string } }) => world.rules.filter((rule) => !where.kind || (rule as { kind?: string }).kind === where.kind) },
    holidayWorkAssignment: { findMany: async () => world.convocations ?? [] },
  } as never;
}

const rule = (overrides: Record<string, unknown>) => ({
  id: "rule", name: "Regla", kind: "OTRO", recurrenceType: "SEMANAL", fromDate: d("2026-01-01"), toDate: d("2028-12-31"), weekdays: [0],
  multiplier: 2, priority: 0, companyId: null, sectorId: null, costCenterId: null, positionId: null, dates: [], sector: null, ...overrides,
});

const SUN = d("2026-09-27");
const SAT = d("2026-09-26");

const outcome = async (world: World, dates: Date[]) =>
  Object.fromEntries([...(await evaluateSpecialHourRulesByDate("emp-1", dates, db(world)))].map(([key, value]) => [key, value.missingHistory ? `MISSING:${value.missingHistory.dimensions.join("+")}` : Number(value.resolution!.multiplier)]));

// ---------------------------------------------------------------------------
// Fixtures de sectores (datos, no nodos históricos reales)
// ---------------------------------------------------------------------------

type SectorRow = { id: string; businessUnitId: string | null; isLegacy: boolean };
/** Sector creado en el modelo anterior: sin unidad de negocio al crearse. */
const PANOL: SectorRow = { id: "panol", businessUnitId: null, isLegacy: true };
/** Sector creado en el modelo nuevo. */
const AGRO: SectorRow = { id: "agro", businessUnitId: "bu-agro", isLegacy: false };

/** Criterio PREVIO a A8-3 y de la migración: sin padre del modelo objetivo = legado. */
const criterioPrevio = (sector: Pick<SectorRow, "businessUnitId">) => !sector.businessUnitId;
/** Motor pre-A8-3: la bandera se derivaba del padre actual en cada lectura. */
const flagAntes = (sector: SectorRow) => ({ isLegacy: criterioPrevio(sector) });
/** Motor post-A8-3: la bandera sale de la clasificación persistida. */
const flagDespues = (sector: SectorRow) => ({ isLegacy: sector.isLegacy });

// Historia compartida: el legajo tuvo el sector anterior "panol" y un puesto
// cuyo alcance vigente contiene "agro" (no "panol").
const legacyHistory = () => [{ ...period("2026-01-01"), sectorId: "panol" }];
const positionHistory = () => [{ ...period("2026-01-01"), positionId: "pos-1" }];
const scopeHistory = () => [{ ...period("2026-01-01"), positionId: "pos-1", nodes: [{ level: "SECTOR", companyId: null, businessUnitId: null, sectorId: "agro", areaId: null, areaSectorId: null }] }];

/** Mundo con la regla limitada al sector dado y las historias completas. */
const worldFor = (sector: SectorRow, flag: (row: SectorRow) => { isLegacy: boolean }): World => ({
  rules: [rule({ id: `dom-${sector.id}`, name: `Domingos ${sector.id}`, sectorId: sector.id, multiplier: 2, sector: flag(sector) })],
  legacySector: legacyHistory(),
  position: positionHistory(),
  scopes: scopeHistory(),
});

// ---------------------------------------------------------------------------
// Prueba principal
// ---------------------------------------------------------------------------

describe("A8-3 — clasificación legado/nuevo persistida (motor real, fixtures)", () => {
  it("PRUEBA PRINCIPAL: cambiar el padre administrativo de un sector no cambia su clasificación ni la resolución histórica", async () => {
    const rePadreado = { ...PANOL, businessUnitId: "bu-administracion" };

    const antesDeMigrar = await outcome(worldFor(PANOL, flagAntes), [SUN]);
    const despuesDelCambioDePadre = await outcome(worldFor(rePadreado, flagDespues), [SUN]);
    const conElCriterioViejo = await outcome(worldFor(rePadreado, flagAntes), [SUN]);

    // Mismo resultado que antes de tocar el padre: la regla sigue comparando
    // contra el sector anterior del legajo (LEGACY_SECTOR), no contra alcances.
    expect(antesDeMigrar).toEqual({ "2026-09-27": 2 });
    expect(despuesDelCambioDePadre).toEqual(antesDeMigrar);
    // El criterio viejo (derivado del padre) habría REINTERPRETADO la regla:
    // otra ruta, otro resultado. Esto es lo que A8-3 elimina.
    expect(conElCriterioViejo).toEqual({ "2026-09-27": 1 });
  });

  it("caso inverso: un sector nuevo que pierde su padre no se reclasifica como legado", async () => {
    const sinPadre = { ...AGRO, businessUnitId: null };

    const despues = await outcome(worldFor(sinPadre, flagDespues), [SUN]);
    const conElCriterioViejo = await outcome(worldFor(sinPadre, flagAntes), [SUN]);

    // Sigue en la ruta de sector nuevo (“Ubicado dentro de” con el alcance del puesto).
    expect(despues).toEqual({ "2026-09-27": 2 });
    // El criterio viejo la habría hecho pasar por legada: compara contra el
    // sector anterior del legajo ("panol"), no coincide con "agro" y el
    // multiplicador cae en silencio a 1.
    expect(conElCriterioViejo).toEqual({ "2026-09-27": 1 });
  });

  it("sector legado con historia: compara contra el sector anterior vigente ese día", async () => {
    const world: World = { ...worldFor(PANOL, flagDespues), legacySector: [{ ...period("2026-01-01", "2026-09-30"), sectorId: "panol" }, { ...period("2026-10-01"), sectorId: "otro" }] };
    expect(await outcome(world, [SUN])).toEqual({ "2026-09-27": 2 });
    expect(await outcome(world, [d("2026-10-04")])).toEqual({ "2026-10-04": 1 });
  });

  it("sector nuevo con historia de puesto y alcance: decide el alcance vigente ese día", async () => {
    const world: World = {
      ...worldFor(AGRO, flagDespues),
      scopes: [
        { ...period("2026-01-01", "2026-09-30"), positionId: "pos-1", nodes: [{ level: "SECTOR", companyId: null, businessUnitId: null, sectorId: "agro", areaId: null, areaSectorId: null }] },
        { ...period("2026-10-01"), positionId: "pos-1", nodes: [{ level: "SECTOR", companyId: null, businessUnitId: null, sectorId: "ganaderia", areaId: null, areaSectorId: null }] },
      ],
    };
    expect(await outcome(world, [SUN])).toEqual({ "2026-09-27": 2 });
    expect(await outcome(world, [d("2026-10-04")])).toEqual({ "2026-10-04": 1 });
  });

  it("historia insuficiente: MISSING de la dimensión que la regla restringe, nunca el valor actual", async () => {
    const sinHistoriaLegada: World = { ...worldFor(PANOL, flagDespues), legacySector: [] };
    expect(await outcome(sinHistoriaLegada, [SUN])).toEqual({ "2026-09-27": "MISSING:LEGACY_SECTOR" });

    const sinHistoriaDePuesto: World = { ...worldFor(AGRO, flagDespues), position: [], scopes: [] };
    expect(await outcome(sinHistoriaDePuesto, [SUN])).toEqual({ "2026-09-27": "MISSING:POSITION" });

    const sinAlcance: World = { ...worldFor(AGRO, flagDespues), scopes: [] };
    expect(await outcome(sinAlcance, [SUN])).toEqual({ "2026-09-27": "MISSING:POSITION_SCOPE" });
  });

  it("reglas sin sector: no participa ninguna historia de sector y resuelven igual antes y después", async () => {
    const world: World = { rules: [rule({ id: "general", multiplier: 2 })] };
    expect(await outcome(world, [SAT, SUN])).toEqual({ "2026-09-26": 1, "2026-09-27": 2 });
    // Con todas las historias vacías, una regla sin alcance no las necesita.
    expect(await outcome({ rules: [rule({ id: "general" })] }, [SUN])).toEqual({ "2026-09-27": 2 });
  });

  // -------------------------------------------------------------------------
  // Comparación antes / después de la migración
  // -------------------------------------------------------------------------

  it("antes/después de la migración: el criterio previo reproduce la clasificación persistida y la resolución no cambia", async () => {
    const escenarios: Array<{ row: SectorRow; world: (flag: (row: SectorRow) => { isLegacy: boolean }) => World; dates: Date[] }> = [
      // legado con historia suficiente → MATCH
      { row: PANOL, world: (flag) => worldFor(PANOL, flag), dates: [SUN] },
      // legado sin historia → MISSING, nunca el valor actual
      { row: PANOL, world: (flag) => ({ ...worldFor(PANOL, flag), legacySector: [] }), dates: [SUN] },
      // nuevo con alcance vigente → MATCH; sin historia de puesto ya cubierto arriba
      { row: AGRO, world: (flag) => worldFor(AGRO, flag), dates: [SUN] },
    ];
    for (const { row, world, dates } of escenarios) {
      // En el momento de la migración, clasificación persistida == criterio previo
      // (la migración backfillea exactamente con ese criterio).
      expect(flagAntes(row)).toEqual(flagDespues(row));
      // Mismo mundo y misma bandera → misma resolución con el motor pre y post A8-3.
      const antes = await outcome(world(flagAntes), dates);
      const despues = await outcome(world(flagDespues), dates);
      expect(despues).toEqual(antes);
    }
  });

  it("la migración aditiva clasifica con el criterio previo, sin asignar padres ni asumir DEFAULT", () => {
    const sql = readFileSync("prisma/migrations/20261008110000_sector_org_classification/migration.sql", "utf8");
    const statements = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(statements).toContain(`ADD COLUMN "isLegacy" BOOLEAN;`);
    expect(statements).toContain(`SET "isLegacy" = ("businessUnitId" IS NULL)`);
    expect(statements).toContain(`ALTER COLUMN "isLegacy" SET NOT NULL`);
    expect(statements).not.toMatch(/DEFAULT/i);
    expect(statements).not.toMatch(/UPDATE "Sector" SET "businessUnitId"/);
    expect(statements).not.toMatch(/\bINSERT\b|\bDELETE\b/i);
  });

  // -------------------------------------------------------------------------
  // Conservación de cierres protegidos
  // -------------------------------------------------------------------------

  it("cierres protegidos: los multiplicadores del período ENVIADO no cambian antes/después del cambio de padre", async () => {
    const cerrado = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"].map((date) => ({ date, appliedMultiplier: 2 }));
    const dates = cerrado.map((row) => d(row.date));
    const rePadreado = { ...PANOL, businessUnitId: "bu-administracion" };

    const antes = await outcome(worldFor(PANOL, flagAntes), dates);
    const despues = await outcome(worldFor(rePadreado, flagDespues), dates);
    expect(despues).toEqual(antes);

    // Un período protegido nunca se reescribe: sólo se informan filas cuyo
    // multiplicador difiere (specialHourReinterpretation.ts). Con resolución
    // idéntica no hay ninguna fila pendiente → el cierre queda conservado.
    const pendientes = cerrado.filter((row) => Number(despues[row.date]) !== row.appliedMultiplier);
    expect(pendientes).toEqual([]);
  });
});
