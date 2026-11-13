import { describe, expect, it } from "vitest";
import { NOVELTY_DEPENDENT_CACHE_FAMILIES } from "./noveltyApiService";
import { WORKED_TIME_DERIVED_CACHE_FAMILIES } from "../cache";

// Etapa 4 de cobertura: las mutaciones de novedades invalidan todas las
// familias con contabilidad de horas, además de las novedades.
describe("noveltyApiService — invalidación de cachés", () => {
  it("incluye todas las familias derivadas de horas y la de novedades", () => {
    expect(NOVELTY_DEPENDENT_CACHE_FAMILIES).toEqual(expect.arrayContaining([...WORKED_TIME_DERIVED_CACHE_FAMILIES, "novelties"]));
    expect(NOVELTY_DEPENDENT_CACHE_FAMILIES).toEqual(expect.arrayContaining(["pending", "monthly-closures", "employees", "dashboard", "time-entries"]));
  });
});
