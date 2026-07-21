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

  it("keeps a user-facing business message when there are no field errors", () => {
    expect(formatApiErrorMessage({
      error: { code: "BUSINESS_ERROR", message: "La operación no está permitida." },
    })).toBe("La operación no está permitida.");
  });

  it("translates known internal errors instead of exposing backend wording", () => {
    expect(formatApiErrorMessage({
      error: { code: "EMPLOYEE_NOT_FOUND", message: "Employee not found" },
    })).toBe("No encontramos el legajo solicitado.");
  });

  it("does not expose the configured file provider", () => {
    expect(formatApiErrorMessage({
      error: {
        code: "STORAGE_GOOGLE_DRIVE_API_ERROR",
        message: "Google Drive API error",
      },
    })).toBe("No pudimos completar la operación con el archivo. Intentá nuevamente.");
  });

  it("uses safe guidance for an unknown technical error", () => {
    expect(formatApiErrorMessage({
      error: { code: "NEW_INTERNAL_CODE", message: "Backend service not found" },
    })).toBe("No pudimos completar la operación. Intentá nuevamente.");
  });
});
