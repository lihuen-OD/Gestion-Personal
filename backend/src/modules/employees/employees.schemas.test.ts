import { describe, expect, it } from "vitest";
import { createEmployeeSchema, employeeTimeGridQuerySchema, updateEmployeeSchema } from "./employees.schemas";

/**
 * Etapa 14I.9 — regresión del bug encontrado en 14I.8: `z.coerce.boolean()`
 * aplica `Boolean(valor)` de JS, y como un query param HTTP siempre llega
 * como string, `Boolean("false")` da `true` (cualquier string no vacío es
 * truthy) — `?includeDetails=false` nunca desactivaba la rama pesada de
 * `employeesRepository.findTimeGrid` (novedades del período + catálogo de
 * `getTimeGridCatalogs()`). Estos tests fijan el comportamiento correcto
 * después del fix (`employees.schemas.ts::employeeTimeGridQuerySchema`).
 * Ver docs/decisions/TIME_GRID_CATALOG_CACHE_INVALIDATION_DIAGNOSTIC_14I8.md.
 */
describe("employeeTimeGridQuerySchema.includeDetails — Etapa 14I.9", () => {
  it("el string 'false' (como llega un query param real de Express) parsea a `false`", () => {
    const result = employeeTimeGridQuerySchema.parse({ period: "2026-09", includeDetails: "false" });
    expect(result.includeDetails).toBe(false);
  });

  it("el string 'true' sigue parseando a `true`", () => {
    const result = employeeTimeGridQuerySchema.parse({ period: "2026-09", includeDetails: "true" });
    expect(result.includeDetails).toBe(true);
  });

  it("sin el query param: sigue usando el default `true` (mismo comportamiento de antes del fix)", () => {
    const result = employeeTimeGridQuerySchema.parse({ period: "2026-09" });
    expect(result.includeDetails).toBe(true);
  });

  it("un booleano real `false` (uso directo desde código, no HTTP) también parsea a `false`", () => {
    const result = employeeTimeGridQuerySchema.parse({ period: "2026-09", includeDetails: false });
    expect(result.includeDetails).toBe(false);
  });

  it("un booleano real `true` sigue parseando a `true`", () => {
    const result = employeeTimeGridQuerySchema.parse({ period: "2026-09", includeDetails: true });
    expect(result.includeDetails).toBe(true);
  });

  it("el fix es deliberadamente acotado al string exacto 'false' — cualquier otro string sigue coercionando a `true` (mismo comportamiento previo, sin ampliar el alcance del cambio)", () => {
    expect(employeeTimeGridQuerySchema.parse({ period: "2026-09", includeDetails: "False" }).includeDetails).toBe(true);
    expect(employeeTimeGridQuerySchema.parse({ period: "2026-09", includeDetails: "0" }).includeDetails).toBe(true);
    expect(employeeTimeGridQuerySchema.parse({ period: "2026-09", includeDetails: "no" }).includeDetails).toBe(true);
  });

  it("`period` sigue exigiendo el formato YYYY-MM, sin cambios por este fix", () => {
    expect(employeeTimeGridQuerySchema.safeParse({ period: "2026-9", includeDetails: "false" }).success).toBe(false);
    expect(employeeTimeGridQuerySchema.safeParse({ period: "2026-09", includeDetails: "false" }).success).toBe(true);
  });
});

// Alta mínima de legajo: sólo legajo, DNI, nombre y apellido son obligatorios.
describe("createEmployeeSchema — alta mínima", () => {
  const minimal = { legajo: "0001", dni: "12345678", firstName: "Juan", lastName: "Perez" };

  it("acepta sólo legajo, DNI, nombre y apellido, sin inventar datos", () => {
    const parsed = createEmployeeSchema.parse(minimal);
    expect(parsed).toMatchObject({ ...minimal, status: "ACTIVO", companyIds: [] });
    expect(parsed.cuil).toBeUndefined();
    expect(parsed.birthDate).toBeUndefined();
    expect(parsed.gender).toBeUndefined();
    expect(parsed.nationality).toBeUndefined();
    expect(parsed.positionId).toBeUndefined();
    expect(parsed.costCenterId).toBeUndefined();
    expect(parsed.initialLaborMovement).toBeUndefined();
    expect(parsed.address).toBeUndefined();
  });

  it("acepta CUIL, nacimiento, sexo y nacionalidad en null y los conserva null (nacimiento no se convierte en 1970-01-01)", () => {
    const parsed = createEmployeeSchema.parse({ ...minimal, cuil: null, birthDate: null, gender: null, nationality: null });
    expect(parsed).toMatchObject({ cuil: null, birthDate: null, gender: null, nationality: null });
  });

  it("sigue exigiendo legajo, DNI, nombre y apellido", () => {
    for (const field of ["legajo", "dni", "firstName", "lastName"] as const) {
      const { [field]: _omitted, ...rest } = minimal;
      expect(createEmployeeSchema.safeParse(rest).success).toBe(false);
    }
  });

  it("cuando vienen informados, mantiene las validaciones existentes", () => {
    expect(createEmployeeSchema.safeParse({ ...minimal, cuil: "123" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, cuil: "x".repeat(31) }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, birthDate: "no-es-fecha" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, gender: "" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, gender: "x".repeat(41) }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, nationality: "" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, nationality: "x".repeat(81) }).success).toBe(false);
    const full = createEmployeeSchema.parse({ ...minimal, cuil: "20-12345678-9", birthDate: "1990-05-10", gender: "Masculino", nationality: "Argentina" });
    expect(full).toMatchObject({ cuil: "20-12345678-9", gender: "Masculino", nationality: "Argentina" });
    expect(full.birthDate).toEqual(new Date("1990-05-10"));
  });

  it("con fecha de alta, el movimiento inicial sigue exigiendo un motivo válido", () => {
    expect(createEmployeeSchema.safeParse({ ...minimal, initialLaborMovement: { type: "ALTA", effectiveFrom: "2026-11-01" } }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, initialLaborMovement: { type: "ALTA", effectiveFrom: "2026-11-01", reason: "" } }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...minimal, initialLaborMovement: { type: "ALTA", effectiveFrom: "2026-11-01", reason: "Reingreso" } }).success).toBe(true);
  });
});

describe("updateEmployeeSchema — completar o vaciar datos opcionales", () => {
  it("birthDate null queda null (antes `z.coerce.date()` lo convertía en 1970-01-01)", () => {
    expect(updateEmployeeSchema.parse({ birthDate: null }).birthDate).toBeNull();
  });

  it("acepta vaciar CUIL, sexo y nacionalidad, y completarlos después con las mismas validaciones", () => {
    expect(updateEmployeeSchema.parse({ cuil: null, gender: null, nationality: null })).toMatchObject({ cuil: null, gender: null, nationality: null });
    expect(updateEmployeeSchema.safeParse({ cuil: "123" }).success).toBe(false);
    expect(updateEmployeeSchema.parse({ cuil: "20-12345678-9" }).cuil).toBe("20-12345678-9");
  });
});
