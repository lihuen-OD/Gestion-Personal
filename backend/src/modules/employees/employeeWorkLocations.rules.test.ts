import { describe, expect, it } from "vitest";
import { assertNoOverlap, assertValidInterval, assertZoneAndEstablishments, periodsOverlap, workLocationState } from "./employeeWorkLocations.rules";

const period = (id: string, zoneId: string, effectiveFrom: string, effectiveTo: string | null) => ({ id, zoneId, effectiveFrom, effectiveTo });

describe("workLocationState — vigencias como días calendario", () => {
  it("distingue actual, futura y finalizada con extremos inclusivos", () => {
    expect(workLocationState(period("a", "z", "2026-10-07", null), "2026-10-07")).toBe("CURRENT");
    expect(workLocationState(period("a", "z", "2026-01-01", "2026-10-07"), "2026-10-07")).toBe("CURRENT");
    expect(workLocationState(period("a", "z", "2026-10-08", null), "2026-10-07")).toBe("FUTURE");
    expect(workLocationState(period("a", "z", "2026-01-01", "2026-10-06"), "2026-10-07")).toBe("ENDED");
  });
});

describe("periodsOverlap — intervalos cerrados, null = abierto", () => {
  it("el mismo día de fin e inicio se superpone; el día siguiente no", () => {
    expect(periodsOverlap(period("a", "z", "2026-01-01", "2026-03-31"), period("b", "z", "2026-03-31", null))).toBe(true);
    expect(periodsOverlap(period("a", "z", "2026-01-01", "2026-03-31"), period("b", "z", "2026-04-01", null))).toBe(false);
  });

  it("dos abiertas siempre se superponen; una futura contenida también", () => {
    expect(periodsOverlap(period("a", "z", "2026-01-01", null), period("b", "z", "2027-01-01", null))).toBe(true);
    expect(periodsOverlap(period("a", "z", "2026-01-01", null), period("b", "z", "2026-05-01", "2026-05-31"))).toBe(true);
  });
});

describe("assertNoOverlap", () => {
  const existing = [period("cur", "north", "2026-01-01", null), period("south", "south", "2026-01-01", null)];

  it("rechaza una futura en la misma zona con mensaje legible y período en conflicto", () => {
    expect(() => assertNoOverlap(period("new", "north", "2027-01-01", null), existing, "Zona Norte")).toThrow(
      expect.objectContaining({ statusCode: 409, code: "WORK_LOCATION_OVERLAP", message: expect.stringContaining("“Zona Norte” desde el 01/01/2026, sin fecha de fin") }),
    );
  });

  it("zonas distintas pueden superponerse", () => {
    expect(() => assertNoOverlap(period("new", "west", "2026-01-01", null), existing, "Zona Oeste")).not.toThrow();
  });

  it("ignora la propia fila (corrección)", () => {
    expect(() => assertNoOverlap(period("cur", "north", "2025-12-01", null), existing, "Zona Norte")).not.toThrow();
  });
});

describe("assertValidInterval", () => {
  it("acepta un solo día y rechaza hasta < desde", () => {
    expect(() => assertValidInterval({ effectiveFrom: "2026-10-07", effectiveTo: "2026-10-07" })).not.toThrow();
    expect(() => assertValidInterval({ effectiveFrom: "2026-10-07", effectiveTo: "2026-10-06" })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_INVALID_INTERVAL" }));
  });
});

describe("assertZoneAndEstablishments — selección explícita (D-2)", () => {
  const zone = { id: "north", name: "Zona Norte", status: "ACTIVO" };
  const establishments = [
    { id: "e1", name: "Campo La Esperanza", status: "ACTIVO", zoneId: "north" },
    { id: "e2", name: "Planta Sur", status: "ACTIVO", zoneId: "south" },
    { id: "e3", name: "Establecimiento anterior", status: "ACTIVO", zoneId: null },
    { id: "e4", name: "Campo cerrado", status: "INACTIVO", zoneId: "north" },
  ];
  const check = (overrides: Partial<Parameters<typeof assertZoneAndEstablishments>[0]>) => () =>
    assertZoneAndEstablishments({ zoneId: "north", establishmentIds: ["e1"], zone, establishments, ...overrides });

  it("acepta establecimientos de la zona", () => expect(check({})).not.toThrow());
  it("una lista vacía no significa toda la zona", () => expect(check({ establishmentIds: [] })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ESTABLISHMENTS_REQUIRED" })));
  it("rechaza duplicados", () => expect(check({ establishmentIds: ["e1", "e1"] })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ESTABLISHMENT_DUPLICATE" })));
  it("rechaza un establecimiento de otra zona", () => expect(check({ establishmentIds: ["e1", "e2"] })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ESTABLISHMENT_ZONE_MISMATCH", message: "“Planta Sur” no pertenece a la zona “Zona Norte”." })));
  it("rechaza un establecimiento de la estructura anterior", () => expect(check({ establishmentIds: ["e3"] })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ESTABLISHMENT_LEGACY" })));
  it("rechaza un establecimiento inexistente", () => expect(check({ establishmentIds: ["missing"] })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ESTABLISHMENT_INVALID" })));
  it("rechaza zona inexistente", () => expect(check({ zone: null })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ZONE_INVALID" })));
  it("rechaza un nodo inactivo nuevo", () => {
    expect(check({ establishmentIds: ["e4"] })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ESTABLISHMENT_INACTIVE" }));
    expect(check({ zone: { ...zone, status: "INACTIVO" } })).toThrow(expect.objectContaining({ code: "WORK_LOCATION_ZONE_INACTIVE" }));
  });
  it("conserva un nodo inactivo que ya estaba en el registro corregido", () => {
    expect(check({ establishmentIds: ["e4"], keepEstablishmentIds: new Set(["e4"]) })).not.toThrow();
    expect(check({ zone: { ...zone, status: "INACTIVO" }, keepZoneId: "north" })).not.toThrow();
  });
});
