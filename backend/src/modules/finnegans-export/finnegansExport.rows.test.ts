import { describe, expect, it } from "vitest";
import type { NoveltyExportCoverageDay } from "../novelties/noveltyCoverageAccounting";
import type { FinnegansExportNovelty } from "./finnegansExport.repository";
import { buildFinnegansNoveltyExportRows, minutesToHoursValue } from "./finnegansExport.rows";

// Etapa 9 de cobertura (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §16).
// Decisiones del usuario (2026-11-16): HOURS = base efectiva SIN multiplicador
// (P2); DAYS = días corridos; una novedad con cobertura se divide por mes.

const decimal = (value: string) => ({ toString: () => value }) as unknown as import("@prisma/client").Prisma.Decimal;
const utc = (key: string) => new Date(`${key}T00:00:00.000Z`);

type Overrides = {
  id?: string;
  fromDate?: string;
  toDate?: string | null;
  quantityHours?: string | null;
  quantityDays?: string | null;
  coverageMode?: "NONE" | "FIXED_MINUTES" | "MANUAL_MINUTES" | "EXPECTED_SCHEDULE";
  unit?: "HOURS" | "DAYS" | "UNIT" | null;
  code?: string | null;
  requiresValidity?: boolean;
  name?: string;
};

function novelty(overrides: Overrides = {}): FinnegansExportNovelty {
  return {
    id: overrides.id ?? "nov-1",
    employeeId: "emp-1",
    fromDate: utc(overrides.fromDate ?? "2026-11-16"),
    toDate: overrides.toDate === undefined ? null : overrides.toDate === null ? null : utc(overrides.toDate),
    quantityHours: overrides.quantityHours ? decimal(overrides.quantityHours) : null,
    quantityDays: overrides.quantityDays ? decimal(overrides.quantityDays) : null,
    employee: { id: "emp-1", legajo: "100", legajoFinnegans: null, firstName: "Ana", lastName: "Gómez", costCenter: null },
    noveltyType: {
      name: overrides.name ?? "Tipo",
      coverageMode: overrides.coverageMode ?? "FIXED_MINUTES",
      finnegansValueUnit: overrides.unit === undefined ? "HOURS" : overrides.unit,
      finnegansCode: overrides.code === undefined ? "COD" : overrides.code,
      finnegansRequiresValidity: overrides.requiresValidity ?? false,
    },
  } as unknown as FinnegansExportNovelty;
}

const day = (dateKey: string, baseMinutes: number, state: NoveltyExportCoverageDay["state"] = "COUNTED"): NoveltyExportCoverageDay => ({ dateKey, baseMinutes, state });

function build(period: string, items: FinnegansExportNovelty[], coverage: Record<string, NoveltyExportCoverageDay[]> = {}, closureApproved = true) {
  return buildFinnegansNoveltyExportRows({ period, novelties: items, coverageByNovelty: new Map(Object.entries(coverage)), isClosureApproved: () => closureApproved });
}

describe("buildFinnegansNoveltyExportRows — tipos representativos", () => {
  it("sin novedades: sin filas", () => {
    expect(build("2026-11", [])).toEqual([]);
  });

  it("Trámite bancario 4 h aprobado y contado: Valor 1 = 4 (nunca quantityHours)", () => {
    const [row] = build("2026-11", [novelty({ quantityHours: "9" })], { "nov-1": [day("2026-11-16", 240)] });
    expect(row).toMatchObject({ ready: true, reviewDays: 0, row: { "Valor 1": "4", Novedad: "COD", "Fecha Aplicación": "16/11/2026", estado: "LISTO" } });
  });

  it("Trámite bancario en revisión (trabajo real incompatible): no exporta horas y bloquea", () => {
    const [row] = build("2026-11", [novelty()], { "nov-1": [day("2026-11-19", 240, "REVIEW_REQUIRED")] });
    expect(row).toMatchObject({ ready: false, reviewDays: 1, hasNonClosureBlocker: true, reasonCodes: ["COVERAGE_REVIEW_PENDING"], row: { "Valor 1": "", estado: "REVISION_PENDIENTE" } });
  });

  it("Vacaciones por rango con días heterogéneos: suma la base de cada día (lunes 8, franco 0, feriado no convocado 0, domingo ×2 = 8 base)", () => {
    const [row] = build("2026-11", [novelty({ coverageMode: "EXPECTED_SCHEDULE", fromDate: "2026-11-16", toDate: "2026-11-22" })], {
      "nov-1": [
        day("2026-11-16", 480),
        day("2026-11-17", 0), // franco
        day("2026-11-18", 480),
        day("2026-11-19", 360), // jornada de 6 h
        day("2026-11-20", 0), // feriado no convocado
        day("2026-11-21", 0), // sin obligación
        day("2026-11-22", 480), // domingo ×2: la base sigue siendo 8 h
      ],
    });
    expect(row!.row["Valor 1"]).toBe("30");
  });

  it("el multiplicador no se aplica dos veces: un domingo ×2 de 8 h exporta 8, nunca 16", () => {
    const [row] = build("2026-11", [novelty({ coverageMode: "EXPECTED_SCHEDULE", fromDate: "2026-11-22" })], { "nov-1": [day("2026-11-22", 480)] });
    expect(row!.row["Valor 1"]).toBe("8");
  });

  it("Maternidad lunes a viernes: el fin de semana y el feriado excluido suman 0", () => {
    const [row] = build("2026-11", [novelty({ fromDate: "2026-11-16", toDate: "2026-11-22" })], {
      "nov-1": [day("2026-11-16", 480), day("2026-11-17", 480), day("2026-11-18", 480), day("2026-11-19", 480), day("2026-11-20", 0), day("2026-11-21", 0), day("2026-11-22", 0)],
    });
    expect(row!.row["Valor 1"]).toBe("32");
  });

  it("Llegada tarde (cantidad indicada al cargar, informativa): exporta su duración, como antes", () => {
    const [row] = build("2026-11", [novelty({ coverageMode: "MANUAL_MINUTES", quantityHours: "1.5" })], { "nov-1": [day("2026-11-16", 90, "INFORMATIVE")] });
    expect(row).toMatchObject({ ready: true, row: { "Valor 1": "1.5" } });
  });

  it("Falta sin aviso con trabajo real ese día (revisión): bloquea aunque no tenga cobertura", () => {
    const [row] = build("2026-11", [novelty({ coverageMode: "NONE", unit: "UNIT" })], { "nov-1": [day("2026-11-16", 0, "REVIEW_REQUIRED")] });
    expect(row).toMatchObject({ ready: false, reviewDays: 1, reasonCodes: ["COVERAGE_REVIEW_PENDING"], row: { estado: "REVISION_PENDIENTE" } });
  });

  it("Falta sin aviso (sin cobertura): conserva el contrato anterior (UNIT = 1, DAYS = quantityDays)", () => {
    expect(build("2026-11", [novelty({ coverageMode: "NONE", unit: "UNIT" })])[0]!.row["Valor 1"]).toBe("1");
    expect(build("2026-11", [novelty({ coverageMode: "NONE", unit: "DAYS", quantityDays: "1" })])[0]!.row["Valor 1"]).toBe("1");
  });

  it("resolución manual: se exporta la base efectiva que ya trae la contabilidad", () => {
    const [row] = build("2026-11", [novelty({ coverageMode: "EXPECTED_SCHEDULE" })], { "nov-1": [day("2026-11-16", 360)] });
    expect(row!.row["Valor 1"]).toBe("6");
  });

  it("sin horas que exportar en el período (sólo francos): no hay fila", () => {
    expect(build("2026-11", [novelty({ coverageMode: "EXPECTED_SCHEDULE", fromDate: "2026-11-21", toDate: "2026-11-22" })], { "nov-1": [day("2026-11-21", 0), day("2026-11-22", 0)] })).toEqual([]);
  });

  it("cobertura faltante: se bloquea, no se inventa una cantidad", () => {
    const [row] = build("2026-11", [novelty()], {});
    expect(row).toMatchObject({ ready: false, reasonCodes: ["COVERAGE_MISSING"], row: { "Valor 1": "", estado: "FALTA_CANTIDAD" } });
  });
});

describe("buildFinnegansNoveltyExportRows — legacy", () => {
  it("tipo sin cobertura con horas informativas (allowsHours): usa quantityHours como antes", () => {
    expect(build("2026-11", [novelty({ coverageMode: "NONE", quantityHours: "2" })])[0]!.row["Valor 1"]).toBe("2");
  });

  it("tipo sin cobertura sin cantidad: falta cantidad (sin cambios)", () => {
    expect(build("2026-11", [novelty({ coverageMode: "NONE" })])[0]).toMatchObject({ ready: false, reasonCodes: ["MISSING_HOURS_QUANTITY"] });
  });

  it("tipo con cobertura en horas: quantityHours informativa nunca reemplaza la cobertura", () => {
    const [row] = build("2026-11", [novelty({ quantityHours: "1" })], { "nov-1": [day("2026-11-16", 480)] });
    expect(row!.row["Valor 1"]).toBe("8");
  });
});

describe("buildFinnegansNoveltyExportRows — cruce de mes (se divide por mes)", () => {
  const vacaciones = (unit: "HOURS" | "DAYS" | "UNIT", requiresValidity = false) => novelty({ coverageMode: "EXPECTED_SCHEDULE", unit, fromDate: "2026-11-28", toDate: "2026-12-05", requiresValidity });

  it("HOURS: cada mes exporta la base de sus días, con su propia fecha de aplicación", () => {
    const november = build("2026-11", [vacaciones("HOURS")], { "nov-1": [day("2026-11-28", 0), day("2026-11-29", 0), day("2026-11-30", 480)] });
    const december = build("2026-12", [vacaciones("HOURS")], { "nov-1": [day("2026-12-01", 480), day("2026-12-02", 480), day("2026-12-03", 480), day("2026-12-04", 480), day("2026-12-05", 0)] });
    expect(november[0]!.row).toMatchObject({ "Valor 1": "8", "Fecha Aplicación": "28/11/2026" });
    expect(december[0]!.row).toMatchObject({ "Valor 1": "32", "Fecha Aplicación": "01/12/2026" });
  });

  it("DAYS: días corridos de la porción de cada mes (3 + 5), con la vigencia de esa porción", () => {
    const november = build("2026-11", [vacaciones("DAYS", true)], { "nov-1": [day("2026-11-28", 0), day("2026-11-29", 0), day("2026-11-30", 480)] });
    const december = build("2026-12", [vacaciones("DAYS", true)], { "nov-1": [day("2026-12-01", 480), day("2026-12-05", 0)] });
    expect(november[0]!.row).toMatchObject({ "Valor 1": "3", "Fecha desde": "28/11/2026", "Fecha hasta": "30/11/2026" });
    expect(december[0]!.row).toMatchObject({ "Valor 1": "5", "Fecha desde": "01/12/2026", "Fecha hasta": "05/12/2026" });
  });

  it("UNIT: una novedad es una unidad, sólo en el mes de inicio", () => {
    expect(build("2026-11", [vacaciones("UNIT")], { "nov-1": [day("2026-11-30", 480)] })[0]!.row["Valor 1"]).toBe("1");
    expect(build("2026-12", [vacaciones("UNIT")], { "nov-1": [day("2026-12-01", 480)] })).toEqual([]);
  });
});

describe("buildFinnegansNoveltyExportRows — códigos y cierre", () => {
  it("código Finnegans faltante: falta configuración", () => {
    expect(build("2026-11", [novelty({ code: null })], { "nov-1": [day("2026-11-16", 240)] })[0]).toMatchObject({ ready: false, reasonCodes: ["MISSING_LINK"], row: { estado: "FALTA_CONFIGURACION" } });
  });

  it("cierre no aprobado: lista para exportar salvo el cierre", () => {
    expect(build("2026-11", [novelty()], { "nov-1": [day("2026-11-16", 240)] }, false)[0]).toMatchObject({ ready: false, hasNonClosureBlocker: false, reasonCodes: ["CLOSURE_NOT_APPROVED"], row: { "Valor 1": "4" } });
  });

  it("la misma entrada produce exactamente las mismas filas (reproducible)", () => {
    const input = () => build("2026-11", [novelty({ coverageMode: "EXPECTED_SCHEDULE", toDate: "2026-11-20" })], { "nov-1": [day("2026-11-16", 480), day("2026-11-17", 0)] });
    expect(input()).toEqual(input());
  });
});

describe("minutesToHoursValue", () => {
  it("mismo formato que un quantityHours guardado", () => {
    expect([240, 90, 20, 480 * 4].map(minutesToHoursValue)).toEqual(["4", "1.5", "0.33", "32"]);
  });
});
