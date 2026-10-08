import { describe, expect, it } from "vitest";
import { monthsBetween, periodAt, planChangeFrom, sameIdSet, type Period } from "./laborHistory.periods";

const TODAY = "2026-10-08";
const p = <V>(id: string, effectiveFrom: string, effectiveTo: string | null, value: V): Period<V> => ({ id, effectiveFrom, effectiveTo, value });
const plan = <V>(periods: Period<V>[], from: string, value: V) => planChangeFrom(periods, from, TODAY, (current) => current === value, "Puesto");

describe("periodAt — una fecha resuelve a lo sumo una vigencia; sin vigencia no hay valor", () => {
  const history = [p("a", "2026-01-01", "2026-05-31", "pos-a"), p("b", "2026-06-01", null, "pos-b")];

  it("límites cerrados: el último día de la anterior y el primero de la nueva", () => {
    expect(periodAt(history, "2026-05-31")?.value).toBe("pos-a");
    expect(periodAt(history, "2026-06-01")?.value).toBe("pos-b");
  });

  it("antes del inicio de la historia no hay evidencia (nunca el valor actual)", () => {
    expect(periodAt(history, "2025-12-31")).toBeUndefined();
  });

  it("una vigencia abierta cubre también fechas futuras", () => {
    expect(periodAt(history, "2027-03-01")?.value).toBe("pos-b");
  });

  it("un valor NULL es un dato conocido, distinto de no tener vigencia", () => {
    expect(periodAt([p("x", "2026-01-01", null, null)], "2026-02-01")).toEqual(expect.objectContaining({ value: null }));
  });
});

describe("planChangeFrom — cambio desde una fecha", () => {
  it("sin historia abre la primera vigencia en D y no completa fechas anteriores", () => {
    expect(plan([], "2026-09-01", "pos-a")).toEqual({ kind: "OPEN", effectiveFrom: "2026-09-01", effectiveTo: null });
  });

  it("cambio desde D: cierra la vigente en D − 1 y abre la nueva en D", () => {
    expect(plan([p("a", "2026-01-01", null, "pos-a")], "2026-10-01", "pos-b")).toEqual({
      kind: "SPLIT", closePeriodId: "a", closeTo: "2026-09-30", previous: "pos-a", effectiveFrom: "2026-10-01", effectiveTo: null,
    });
  });

  it("cambio desde el 1 de marzo en año bisiesto cierra el 29 de febrero", () => {
    expect(planChangeFrom([p("a", "2028-01-01", null, "x")], "2028-03-01", "2028-03-10", (current) => current === "y", "Puesto")).toMatchObject({ closeTo: "2028-02-29" });
  });

  it("D igual al inicio de la vigente: corrección del valor de esa vigencia, sin abrir otra", () => {
    expect(plan([p("a", "2026-10-01", null, "pos-a")], "2026-10-01", "pos-b")).toEqual({ kind: "REPLACE", periodId: "a", previous: "pos-a", effectiveFrom: "2026-10-01", effectiveTo: null });
  });

  it("mismo valor ya vigente en D: no registra nada", () => {
    expect(plan([p("a", "2026-01-01", null, "pos-a")], "2026-10-01", "pos-a")).toEqual({ kind: "NONE" });
  });

  it("rechaza una fecha anterior al inicio de la vigencia actual: no reescribe historia ya registrada", () => {
    expect(() => plan([p("a", "2026-01-01", "2026-05-31", "x"), p("b", "2026-06-01", null, "y")], "2026-05-15", "z"))
      .toThrow(expect.objectContaining({ statusCode: 409, code: "LABOR_HISTORY_DATE_BEFORE_CURRENT_PERIOD" }));
  });

  it("rechaza una fecha futura: no hay activación programada de las columnas vigentes", () => {
    expect(() => plan([p("a", "2026-01-01", null, "x")], "2026-10-09", "y")).toThrow(expect.objectContaining({ code: "LABOR_HISTORY_FUTURE_DATE_NOT_SUPPORTED" }));
    expect(() => plan([], "2026-11-01", "y")).toThrow(expect.objectContaining({ code: "LABOR_HISTORY_FUTURE_DATE_NOT_SUPPORTED" }));
  });

  it("acepta corregir una vigencia que empieza en el futuro (alta con ingreso futuro) en su misma fecha", () => {
    expect(plan([p("a", "2026-11-01", null, "x")], "2026-11-01", "y")).toMatchObject({ kind: "REPLACE", periodId: "a" });
  });

  it("después de una vigencia cerrada abre una nueva sin completar el hueco", () => {
    expect(plan([p("a", "2026-01-01", "2026-03-31", "x")], "2026-06-01", "y")).toEqual({ kind: "OPEN", effectiveFrom: "2026-06-01", effectiveTo: null });
  });
});

describe("auxiliares", () => {
  it("monthsBetween incluye ambos extremos y cruza años", () => {
    expect(monthsBetween("2026-11-15", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-10-08", "2026-10-08")).toEqual(["2026-10"]);
  });

  it("sameIdSet ignora orden y duplicados", () => {
    expect(sameIdSet(["b", "a", "a"], ["a", "b"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
  });
});
