import { describe, expect, it } from "vitest";
import { buildReadinessSummary, evaluateNoveltyReadiness, type NoveltyReadinessInput } from "./finnegansExport.readiness";

function baseInput(overrides: Partial<NoveltyReadinessInput> = {}): NoveltyReadinessInput {
  return {
    quantityHours: null,
    quantityDays: null,
    toDate: null,
    finnegansValueUnit: "UNIT",
    finnegansRequiresValidity: false,
    hasFinnegansCode: true,
    closureApproved: true,
    ...overrides,
  };
}

const decimal = (value: string) => ({ toString: () => value });

describe("evaluateNoveltyReadiness — Etapa 15L.3A", () => {
  it("UNIT: siempre lista, sin exigir ninguna cantidad", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "UNIT" }));
    expect(result).toEqual({ ready: true, estado: "LISTO", reasonCodes: [] });
  });

  it("HOURS con quantityHours: lista", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "HOURS", quantityHours: decimal("5") }));
    expect(result.ready).toBe(true);
    expect(result.estado).toBe("LISTO");
  });

  it("HOURS sin quantityHours: blocker", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "HOURS" }));
    expect(result.ready).toBe(false);
    expect(result.reasonCodes).toEqual(["MISSING_HOURS_QUANTITY"]);
    expect(result.estado).toBe("FALTA_CANTIDAD");
  });

  it("HOURS con quantityDays solamente: blocker (no usa la otra cantidad)", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "HOURS", quantityDays: decimal("2") }));
    expect(result.ready).toBe(false);
    expect(result.reasonCodes).toEqual(["MISSING_HOURS_QUANTITY"]);
  });

  it("DAYS con quantityDays: lista", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "DAYS", quantityDays: decimal("3") }));
    expect(result.ready).toBe(true);
  });

  it("DAYS sin quantityDays: blocker", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "DAYS" }));
    expect(result.reasonCodes).toEqual(["MISSING_DAYS_QUANTITY"]);
  });

  it("DAYS con quantityHours solamente: blocker (no usa la otra cantidad)", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "DAYS", quantityHours: decimal("4") }));
    expect(result.reasonCodes).toEqual(["MISSING_DAYS_QUANTITY"]);
  });

  it("finnegansValueUnit=null: blocker, sin inventar DAYS/UNIT", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: null }));
    expect(result.reasonCodes).toEqual(["MISSING_VALUE_UNIT"]);
    expect(result.estado).toBe("FALTA_CONFIGURACION");
  });

  it("requiresValidity=false: nunca exige toDate", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansRequiresValidity: false, toDate: null }));
    expect(result.ready).toBe(true);
  });

  it("requiresValidity=true con toDate: lista", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansRequiresValidity: true, toDate: new Date("2026-09-05") }));
    expect(result.ready).toBe(true);
  });

  it("requiresValidity=true sin toDate: blocker", () => {
    const result = evaluateNoveltyReadiness(baseInput({ finnegansRequiresValidity: true, toDate: null }));
    expect(result.reasonCodes).toEqual(["MISSING_VALIDITY_TO_DATE"]);
    expect(result.estado).toBe("FALTA_CONFIGURACION");
  });

  it("sin código Finnegans: blocker MISSING_LINK, estado Falta configuración", () => {
    const result = evaluateNoveltyReadiness(baseInput({ hasFinnegansCode: false }));
    expect(result.reasonCodes).toEqual(["MISSING_LINK"]);
    expect(result.estado).toBe("FALTA_CONFIGURACION");
  });

  it("cierre no aprobado, sin ningún otro blocker: estado Cierre pendiente", () => {
    const result = evaluateNoveltyReadiness(baseInput({ closureApproved: false }));
    expect(result.ready).toBe(false);
    expect(result.reasonCodes).toEqual(["CLOSURE_NOT_APPROVED"]);
    expect(result.estado).toBe("CIERRE_PENDIENTE");
  });

  it("configuración incompleta domina sobre cierre pendiente en el estado mostrado", () => {
    const result = evaluateNoveltyReadiness(baseInput({ hasFinnegansCode: false, closureApproved: false }));
    expect(result.estado).toBe("FALTA_CONFIGURACION");
    expect(result.reasonCodes).toEqual(["MISSING_LINK", "CLOSURE_NOT_APPROVED"]);
  });
});

describe("buildReadinessSummary — Etapa 15L.3A", () => {
  it("sin filas: ready=true, todo en cero, sin motivos", () => {
    const summary = buildReadinessSummary([]);
    expect(summary).toEqual({ ready: true, totalRows: 0, readyRows: 0, blockedRows: 0, reasons: [] });
  });

  it("todas listas: ready=true, sin motivos", () => {
    const ready = evaluateNoveltyReadiness(baseInput());
    const summary = buildReadinessSummary([
      { employeeId: "e1", readiness: ready },
      { employeeId: "e2", readiness: ready },
    ]);
    expect(summary).toEqual({ ready: true, totalRows: 2, readyRows: 2, blockedRows: 0, reasons: [] });
  });

  it("cuenta CLOSURE_NOT_APPROVED por persona distinta, no por fila", () => {
    const blocked = evaluateNoveltyReadiness(baseInput({ closureApproved: false }));
    const summary = buildReadinessSummary([
      { employeeId: "e1", readiness: blocked },
      { employeeId: "e1", readiness: blocked },
      { employeeId: "e2", readiness: blocked },
    ]);
    expect(summary.blockedRows).toBe(3);
    expect(summary.reasons).toEqual(["2 personas con cierre mensual pendiente"]);
  });

  it("cuenta blockers de datos por fila (novedad), no por persona", () => {
    const missingDays = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "DAYS" }));
    const summary = buildReadinessSummary([
      { employeeId: "e1", readiness: missingDays },
      { employeeId: "e1", readiness: missingDays },
    ]);
    expect(summary.reasons).toEqual(["2 novedades sin cantidad de días"]);
  });

  it("singular vs plural", () => {
    const missingDays = evaluateNoveltyReadiness(baseInput({ finnegansValueUnit: "DAYS" }));
    const summary = buildReadinessSummary([{ employeeId: "e1", readiness: missingDays }]);
    expect(summary.reasons).toEqual(["1 novedad sin cantidad de días"]);
  });

  it("agrega múltiples tipos de motivo en orden estable", () => {
    const missingLink = evaluateNoveltyReadiness(baseInput({ hasFinnegansCode: false }));
    const closurePending = evaluateNoveltyReadiness(baseInput({ closureApproved: false }));
    const summary = buildReadinessSummary([
      { employeeId: "e1", readiness: missingLink },
      { employeeId: "e2", readiness: closurePending },
    ]);
    expect(summary.reasons).toEqual([
      "1 novedad sin código Finnegans configurado",
      "1 persona con cierre mensual pendiente",
    ]);
  });
});
