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

describe("listNotificationsQuerySchema — fecha efectiva: Desde/Hasta y cursor", () => {
  const cursor = "2026-10-02T03:00:00.000Z_2026-10-05T13:00:00.000Z_0b6a1f7e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const messages = (input: Record<string, unknown>) => {
    const result = listNotificationsQuerySchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };

  it("acepta dateFrom/dateTo AAAA-MM-DD combinados con status", () => {
    const result = listNotificationsQuerySchema.safeParse({ status: "NO_LEIDA", dateFrom: "2026-10-01", dateTo: "2026-10-05" });
    expect(result.success && result.data).toEqual({ status: "NO_LEIDA", dateFrom: "2026-10-01", dateTo: "2026-10-05", page: 1, take: 20 });
  });

  it("dateFrom = dateTo es un rango válido (un solo día)", () => {
    expect(listNotificationsQuerySchema.safeParse({ dateFrom: "2026-10-05", dateTo: "2026-10-05" }).success).toBe(true);
  });

  it("dateFrom > dateTo: error de negocio claro", () => {
    expect(messages({ dateFrom: "2026-10-05", dateTo: "2026-10-03" })).toEqual(["La fecha «Desde» no puede ser posterior a «Hasta»."]);
  });

  it.each([["05/10/2026", "debe tener el formato AAAA-MM-DD"], ["2026-02-30", "no es una fecha válida"]])("rechaza dateFrom=%s", (value, message) => {
    expect(messages({ dateFrom: value })[0]).toContain(message);
  });

  it("parsea `after`/`through` a la tupla (eventAt, createdAt, id)", () => {
    const result = listNotificationsQuerySchema.safeParse({ after: cursor });
    expect(result.success && result.data.after).toEqual({ eventAt: new Date("2026-10-02T03:00:00.000Z"), createdAt: new Date("2026-10-05T13:00:00.000Z"), id: "0b6a1f7e-3c2d-4e5f-8a9b-0c1d2e3f4a5b" });
  });

  it("rechaza un cursor mal formado (ej. un offset)", () => {
    expect(messages({ after: "40" })).toEqual(["La posición de la lista no es válida. Recargá la página."]);
  });

  it("after y through son excluyentes; page>1 no se combina con cursor", () => {
    expect(listNotificationsQuerySchema.safeParse({ after: cursor, through: cursor }).success).toBe(false);
    expect(listNotificationsQuerySchema.safeParse({ after: cursor, page: "2" }).success).toBe(false);
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
