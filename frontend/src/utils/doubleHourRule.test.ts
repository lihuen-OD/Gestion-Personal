import { describe, expect, it } from "vitest";
import { doubleHourMultiplierError } from "./doubleHourRule";

describe("doubleHourMultiplierError", () => {
  it.each([1, 1.5, 2, 5])("acepta el multiplicador backend %s", (value) => {
    expect(doubleHourMultiplierError(value)).toBeNull();
  });

  it.each([0, 5.01, Number.NaN, Number.POSITIVE_INFINITY])("rechaza el multiplicador inválido %s", (value) => {
    expect(doubleHourMultiplierError(value)).toBe("El multiplicador debe estar entre 1 y 5.");
  });
});
