import { describe, expect, it } from "vitest";
import { formatApiErrorMessage } from "./apiClient";

describe("formatApiErrorMessage", () => {
  it("lists required or invalid fields using user-facing labels", () => {
    expect(formatApiErrorMessage({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: {
          formErrors: [],
          fieldErrors: {
            gender: ["Expected string, received null"],
            nationality: ["Expected string, received null"],
          },
        },
      },
    })).toBe("Revisá los campos obligatorios o inválidos: Sexo, Nacionalidad.");
  });

  it("keeps the backend message when there are no field errors", () => {
    expect(formatApiErrorMessage({
      error: { code: "BUSINESS_ERROR", message: "La operación no está permitida." },
    })).toBe("La operación no está permitida.");
  });
});
