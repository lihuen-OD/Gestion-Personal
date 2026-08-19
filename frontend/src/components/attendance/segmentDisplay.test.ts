import { describe, expect, it } from "vitest";
import {
  describeHourConceptRule,
  describeSpecialRuleApplication,
  formatMinutesDuration,
  formatMultiplier,
  getSegmentReviewState,
  segmentConceptStatusLabel,
  segmentConceptStatusMessage,
  sortSegmentsByStart,
} from "./segmentDisplay";
import type { AttendanceSegment } from "../../services/api/attendanceApiService";

function segment(overrides: Partial<AttendanceSegment> = {}): AttendanceSegment {
  return {
    id: "segment-1",
    date: "2026-08-18T00:00:00.000Z",
    fromDateTime: "2026-08-18T10:00:00.000Z",
    toDateTime: "2026-08-18T12:00:00.000Z",
    minutes: 120,
    hourConceptName: "Hora normal",
    isHoliday: false,
    isNight: false,
    isSpecial: false,
    ...overrides,
  };
}

describe("A. Labels/helpers", () => {
  it("segmentConceptStatusLabel traduce los 4 estados a texto humano", () => {
    expect(segmentConceptStatusLabel("SUGERIDO")).toBe("Sugerido por sistema");
    expect(segmentConceptStatusLabel("MANUAL")).toBe("Manual");
    expect(segmentConceptStatusLabel("SIN_CONCEPTO_COMPATIBLE")).toBe("Sin concepto compatible");
    expect(segmentConceptStatusLabel("CONCEPTO_NO_HABILITADO")).toBe("Concepto no habilitado");
  });

  it("segmentConceptStatusMessage devuelve el mensaje explicativo pedido para cada estado", () => {
    expect(segmentConceptStatusMessage("SUGERIDO")).toBe("Clasificado automáticamente según reglas horarias configuradas.");
    expect(segmentConceptStatusMessage("MANUAL")).toBe("Clasificación manual.");
    expect(segmentConceptStatusMessage("SIN_CONCEPTO_COMPATIBLE")).toBe("El sistema no encontró una regla horaria compatible para este tramo. Requiere revisión de RRHH.");
    expect(segmentConceptStatusMessage("CONCEPTO_NO_HABILITADO")).toBe("El sistema detectó un concepto posible, pero el empleado no lo tiene habilitado. Requiere revisión.");
  });

  it("formatMultiplier: 1 -> Normal, 1.5 -> x1.5, 2 -> x2, otros -> xN", () => {
    expect(formatMultiplier(1)).toBe("Normal");
    expect(formatMultiplier(1.5)).toBe("x1.5");
    expect(formatMultiplier(2)).toBe("x2");
    expect(formatMultiplier(3.25)).toBe("x3.25");
  });

  it("formatMultiplier acepta el Decimal del backend serializado como string ('1.50')", () => {
    expect(formatMultiplier("1.50")).toBe("x1.5");
    expect(formatMultiplier("2.00")).toBe("x2");
    expect(formatMultiplier("1.00")).toBe("Normal");
  });

  it("formatMultiplier devuelve '-' si el dato no está disponible", () => {
    expect(formatMultiplier(undefined)).toBe("-");
    expect(formatMultiplier(null)).toBe("-");
  });

  it("formatMinutesDuration: 90 -> '1h 30m'", () => {
    expect(formatMinutesDuration(90)).toBe("1h 30m");
  });

  it("formatMinutesDuration: minutos exactos en horas no muestran '0m'", () => {
    expect(formatMinutesDuration(120)).toBe("2h");
  });

  it("formatMinutesDuration: menos de una hora solo muestra minutos", () => {
    expect(formatMinutesDuration(45)).toBe("45m");
  });

  it("formatMinutesDuration devuelve '-' si el dato no está disponible", () => {
    expect(formatMinutesDuration(undefined)).toBe("-");
    expect(formatMinutesDuration(null)).toBe("-");
  });
});

describe("B. Review state", () => {
  it("SIN_CONCEPTO_COMPATIBLE requiere revisión", () => {
    expect(getSegmentReviewState("SIN_CONCEPTO_COMPATIBLE")).toBe("REQUIRES_REVIEW");
  });

  it("CONCEPTO_NO_HABILITADO requiere revisión", () => {
    expect(getSegmentReviewState("CONCEPTO_NO_HABILITADO")).toBe("REQUIRES_REVIEW");
  });

  it("SUGERIDO no requiere revisión por sí solo", () => {
    expect(getSegmentReviewState("SUGERIDO")).toBe("OK");
  });

  it("MANUAL no requiere revisión por sí solo", () => {
    expect(getSegmentReviewState("MANUAL")).toBe("OK");
  });

  it("sin conceptStatus (dato no disponible desde la API), el estado es 'UNKNOWN', nunca 'OK' ni 'REQUIRES_REVIEW' inventado", () => {
    expect(getSegmentReviewState(undefined)).toBe("UNKNOWN");
  });
});

describe("C. Mappers/descripciones", () => {
  it("mapea un segmento con concepto (hourConceptName siempre viene, nunca hardcodeado)", () => {
    const s = segment({ hourConceptName: "Guardia" });
    expect(s.hourConceptName).toBe("Guardia");
  });

  it("mapea regla horaria presente vs faltante", () => {
    expect(describeHourConceptRule("rule-1")).toBe("Regla horaria aplicada");
    expect(describeHourConceptRule(null)).toBe("Sin regla horaria (manual)");
    expect(describeHourConceptRule(undefined)).toBe("Sin regla horaria (manual)");
  });

  it("mapea reglas especiales vacías (isSpecial false)", () => {
    expect(describeSpecialRuleApplication(false)).toBe("Sin reglas especiales");
  });

  it("sin specialHourRuleApplications (isSpecial=true pero sin detalle), no inventa cuál regla ni su multiplicador", () => {
    expect(describeSpecialRuleApplication(true)).toMatch(/no disponible/i);
    expect(describeSpecialRuleApplication(true)).not.toMatch(/Cosecha|Riego|Campaña|Feriado x2/i);
  });

  it("con specialHourRuleApplications presente (Etapa 8F), muestra el nombre real de la regla y su multiplicador — nunca hardcodeado", () => {
    const described = describeSpecialRuleApplication(true, [
      { id: "app-1", multiplierApplied: 2, doubleHourRule: { id: "rule-1", name: "Domingo" } },
    ]);
    expect(described).toBe("Domingo (x2)");
  });

  it("con varias specialHourRuleApplications, lista todas sin quedarse solo con una", () => {
    const described = describeSpecialRuleApplication(true, [
      { id: "app-1", multiplierApplied: 2, doubleHourRule: { id: "rule-1", name: "Feriado" } },
      { id: "app-2", multiplierApplied: 1.5, doubleHourRule: { id: "rule-2", name: "Nocturno" } },
    ]);
    expect(described).toBe("Feriado (x2), Nocturno (x1.5)");
  });

  it("specialHourRuleApplications vacío (array presente pero sin filas) cae al mismo mensaje que 'sin dato' — no lo confunde con 'sin reglas'", () => {
    expect(describeSpecialRuleApplication(true, [])).toMatch(/no disponible/i);
  });

  it("varios segmentos con isSpecial mixto se describen independientemente, sin contaminarse entre sí", () => {
    const segments = [segment({ id: "a", isSpecial: true }), segment({ id: "b", isSpecial: false }), segment({ id: "c", isSpecial: true })];
    expect(segments.map((s) => describeSpecialRuleApplication(s.isSpecial))).toEqual([
      "Sí — detalle de la regla no disponible en esta vista (requiere extender la API)",
      "Sin reglas especiales",
      "Sí — detalle de la regla no disponible en esta vista (requiere extender la API)",
    ]);
  });
});

describe("D. Integración lógica — orden y resiliencia", () => {
  it("sortSegmentsByStart ordena por fromDateTime ascendente sin mutar el array original", () => {
    const segments = [
      segment({ id: "late", fromDateTime: "2026-08-18T21:00:00.000Z" }),
      segment({ id: "early", fromDateTime: "2026-08-18T07:00:00.000Z" }),
    ];
    const sorted = sortSegmentsByStart(segments);
    expect(sorted.map((s) => s.id)).toEqual(["early", "late"]);
    expect(segments.map((s) => s.id)).toEqual(["late", "early"]);
  });

  it("un segmento sin los campos opcionales (conceptStatus/hourConceptRuleId ausentes) no rompe los helpers", () => {
    const reduced = segment(); // sin conceptStatus/hourConceptId/hourConceptRuleId — forma real de getSummary()
    expect(getSegmentReviewState(reduced.conceptStatus)).toBe("UNKNOWN");
    expect(reduced.hourConceptRuleId).toBeUndefined();
  });
});
