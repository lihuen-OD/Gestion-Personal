import { describe, expect, it } from "vitest";
import { calendarRangeQuerySchema, doubleRuleSchema, listNotificationsQuerySchema, updateDoubleRuleSchema } from "./workforce.schemas";

describe("listNotificationsQuerySchema — Etapa 9I", () => {
  it("sin parámetros: aplica los defaults (page=1, take=20, sin filtro de status)", () => {
    const result = listNotificationsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ page: 1, take: 20 });
    }
  });

  it("acepta status NO_LEIDA/LEIDA", () => {
    expect(listNotificationsQuerySchema.safeParse({ status: "NO_LEIDA" }).success).toBe(true);
    expect(listNotificationsQuerySchema.safeParse({ status: "LEIDA" }).success).toBe(true);
  });

  it("rechaza un status fuera del enum", () => {
    expect(listNotificationsQuerySchema.safeParse({ status: "ARCHIVADA" }).success).toBe(false);
  });

  it("rechaza un take por encima del máximo seguro (100)", () => {
    const result = listNotificationsQuerySchema.safeParse({ take: 500 });
    expect(result.success).toBe(false);
  });

  it("acepta take=100 (el máximo permitido)", () => {
    expect(listNotificationsQuerySchema.safeParse({ take: 100 }).success).toBe(true);
  });

  it("coerciona page/take desde query string", () => {
    const result = listNotificationsQuerySchema.safeParse({ page: "3", take: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ page: 3, take: 10 });
    }
  });
});

describe("doubleRuleSchema — Etapa 8B", () => {
  const base = { name: "Domingo", recurrenceType: "SEMANAL" as const, fromDate: "2026-01-01", reason: "Domingo" };

  it("no exige employeeIds (regla general)", () => {
    expect(doubleRuleSchema.safeParse(base).success).toBe(true);
  });

  it("FECHA sin dates: falla con el mensaje esperado en el campo dates", () => {
    const result = doubleRuleSchema.safeParse({ ...base, recurrenceType: "FECHA" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "dates")).toBe(true);
    }
  });

  it("FECHA con dates: pasa", () => {
    const result = doubleRuleSchema.safeParse({ ...base, recurrenceType: "FECHA", dates: [{ date: "2026-12-25" }] });
    expect(result.success).toBe(true);
  });
});

describe("doubleRuleSchema.kind — Etapa 12B (clasificación estructurada, nunca por nombre)", () => {
  const base = { name: "Pedro", recurrenceType: "SEMANAL" as const, fromDate: "2026-01-01", reason: "Motivo" };

  it("sin kind: queda OTRO (default seguro, nunca se infiere del nombre)", () => {
    const result = doubleRuleSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("OTRO");
  });

  it.each(["FERIADO", "DOMINGO", "JORNADA_ESPECIAL", "OTRO"] as const)("acepta kind=%s", (kind) => {
    const result = doubleRuleSchema.safeParse({ ...base, kind });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe(kind);
  });

  it("rechaza un kind fuera del enum — no acepta texto libre", () => {
    const result = doubleRuleSchema.safeParse({ ...base, kind: "SANTO" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.join(".") === "kind")).toBe(true);
  });

  it("updateDoubleRuleSchema permite reclasificar sólo el kind de una regla existente", () => {
    const result = updateDoubleRuleSchema.safeParse({ kind: "FERIADO" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("FERIADO");
  });
});

describe("calendarRangeQuerySchema.kind — Etapa 12B", () => {
  const range = { from: "2026-08-01", to: "2026-08-31" };

  it("sin kind: opcional, no rompe el contrato existente", () => {
    const result = calendarRangeQuerySchema.safeParse(range);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBeUndefined();
  });

  it("acepta kind=FERIADO", () => {
    const result = calendarRangeQuerySchema.safeParse({ ...range, kind: "FERIADO" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe("FERIADO");
  });

  it("rechaza un kind fuera del enum", () => {
    expect(calendarRangeQuerySchema.safeParse({ ...range, kind: "SANTO" }).success).toBe(false);
  });
});

describe("updateDoubleRuleSchema — Etapa 8C (cierre de hueco)", () => {
  it("payload vacío: falla (nada para actualizar)", () => {
    expect(updateDoubleRuleSchema.safeParse({}).success).toBe(false);
  });

  it("cambia sólo priority: pasa sin exigir el resto de los campos", () => {
    expect(updateDoubleRuleSchema.safeParse({ priority: 5 }).success).toBe(true);
  });

  it("cambia recurrenceType a FECHA sin mandar dates: falla (antes de 8C esto pasaba y dejaba la regla sin ninguna fecha que pudiera matchear)", () => {
    const result = updateDoubleRuleSchema.safeParse({ recurrenceType: "FECHA" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "dates")).toBe(true);
    }
  });

  it("cambia recurrenceType a FECHA con dates: pasa", () => {
    const result = updateDoubleRuleSchema.safeParse({ recurrenceType: "FECHA", dates: [{ date: "2026-12-25" }] });
    expect(result.success).toBe(true);
  });
});
