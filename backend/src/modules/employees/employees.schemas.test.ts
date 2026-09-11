import { describe, expect, it } from "vitest";
import { employeeTimeGridQuerySchema } from "./employees.schemas";

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
