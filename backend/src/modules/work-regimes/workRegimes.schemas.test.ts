import { describe, expect, it } from "vitest";
import { createWorkRegimeSchema, listWorkRegimeEmployeesQuerySchema, updateWorkRegimeSchema } from "./workRegimes.schemas";

const base = { code: "COSECHA", name: "Cosecha", kind: "TURNO_FLEXIBLE" as const };

describe("createWorkRegimeSchema.extendedShiftAlertMinutes — Etapa 10D", () => {
  it("acepta el campo ausente (queda undefined, comportamiento actual)", () => {
    const result = createWorkRegimeSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extendedShiftAlertMinutes).toBeUndefined();
  });

  it("acepta null explícito", () => {
    const result = createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extendedShiftAlertMinutes).toBeNull();
  });

  it("acepta un valor entero dentro del rango (0-1440)", () => {
    const result = createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: 900 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extendedShiftAlertMinutes).toBe(900);
  });

  it("acepta 0 explícito (0 sólo existe si el usuario lo carga, no es el default)", () => {
    const result = createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: 0 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extendedShiftAlertMinutes).toBe(0);
  });

  it("acepta el máximo del rango (1440 = 24h)", () => {
    expect(createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: 1440 }).success).toBe(true);
  });

  it("rechaza un valor negativo", () => {
    expect(createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: -1 }).success).toBe(false);
  });

  it("rechaza un valor por encima del máximo permitido (>1440)", () => {
    expect(createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: 1441 }).success).toBe(false);
  });

  it("rechaza un valor no entero", () => {
    expect(createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: 12.5 }).success).toBe(false);
  });

  it("coerciona un string numérico (mismo criterio que el resto de los campos numéricos del proyecto)", () => {
    const result = createWorkRegimeSchema.safeParse({ ...base, extendedShiftAlertMinutes: "480" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extendedShiftAlertMinutes).toBe(480);
  });
});

describe("updateWorkRegimeSchema.extendedShiftAlertMinutes — Etapa 10D", () => {
  it("permite actualizar sólo este campo, sin exigir el resto", () => {
    expect(updateWorkRegimeSchema.safeParse({ extendedShiftAlertMinutes: 720 }).success).toBe(true);
  });

  it("permite volver a null (quitar el ajuste de régimen, caer al comportamiento del turno/default)", () => {
    expect(updateWorkRegimeSchema.safeParse({ extendedShiftAlertMinutes: null }).success).toBe(true);
  });

  it("sigue rechazando fuera de rango en una actualización parcial", () => {
    expect(updateWorkRegimeSchema.safeParse({ extendedShiftAlertMinutes: 2000 }).success).toBe(false);
  });
});

describe("listWorkRegimeEmployeesQuerySchema.status — Etapa 13J (consistencia vigente/histórica)", () => {
  it("sin status en el query, default es 'current' (no 'all') — el modal de empleados asociados no debe mezclar históricas por defecto", () => {
    const result = listWorkRegimeEmployeesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("current");
  });

  it("acepta 'historical' y 'all' explícitos sin pisarlos con el default", () => {
    expect(listWorkRegimeEmployeesQuerySchema.safeParse({ status: "historical" }).success && listWorkRegimeEmployeesQuerySchema.parse({ status: "historical" }).status).toBe("historical");
    expect(listWorkRegimeEmployeesQuerySchema.safeParse({ status: "all" }).success && listWorkRegimeEmployeesQuerySchema.parse({ status: "all" }).status).toBe("all");
  });
});
