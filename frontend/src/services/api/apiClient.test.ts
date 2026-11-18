import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, formatApiErrorMessage } from "./apiClient";

afterEach(() => vi.unstubAllGlobals());

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

  // Etapa 7 (NOVELTY_COVERAGE_ENGINE.md §14): nunca códigos, enums ni JSON crudos.
  it("keeps the business message of a rejected novelty type configuration", () => {
    expect(formatApiErrorMessage({
      error: { code: "NOVELTY_TYPE_COVERAGE_CONFIG_INVALID", message: "Elegí al menos un día de la semana." },
    })).toBe("Elegí al menos un día de la semana.");
  });

  it("replaces a message with internal codes or enums by a business explanation", () => {
    for (const message of ["INVALID_NOVELTY_COVERAGE_CONFIGURATION", "coverageMode EXPECTED_SCHEDULE requires WORK_OBLIGATION", "ONLY_IF_CONVOKED no permitido", "{\"coverageMode\":\"NONE\"}"]) {
      expect(formatApiErrorMessage({ error: { code: "NOVELTY_TYPE_COVERAGE_CONFIG_INVALID", message } }))
        .toBe("La combinación elegida para el tiempo que cubre la novedad no es válida. Revisá las secciones de tiempo, días e impacto.");
    }
    expect(formatApiErrorMessage({ error: { code: "SOME_UNKNOWN_CODE", message: "WORK_OBLIGATION" } }))
      .toBe("No pudimos completar la operación. Intentá nuevamente.");
  });

  it("labels novelty type coverage fields in Spanish on validation errors", () => {
    expect(formatApiErrorMessage({
      error: { code: "VALIDATION_ERROR", message: "Invalid request body", details: { formErrors: [], fieldErrors: { coverageFixedMinutes: ["Number must be greater than or equal to 1"], coverageOnHoliday: ["Invalid enum value"] } } },
    })).toBe("Revisá los campos obligatorios o inválidos: Cantidad de horas, Qué sucede si es feriado.");
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

  it("maps HOUR_CONCEPT_RULE_NOT_FOUND and HOUR_CONCEPT_RULE_INVALID_RANGE to friendly Spanish copy", () => {
    expect(formatApiErrorMessage({
      error: { code: "HOUR_CONCEPT_RULE_NOT_FOUND", message: "No encontramos la regla de concepto horario solicitada" },
    })).toBe("No encontramos la regla horaria solicitada.");
    expect(formatApiErrorMessage({
      error: { code: "HOUR_CONCEPT_RULE_INVALID_RANGE", message: "startTime y endTime no pueden ser iguales" },
    })).toBe("La hora desde y la hora hasta no pueden ser iguales.");
  });

  it("keeps the backend's specific overlap message for HOUR_CONCEPT_RULE_AMBIGUOUS_OVERLAP (409) instead of a generic fallback — it already names the conflicting rule", () => {
    const specificMessage = "La regla se superpone con otra activa de igual prioridad (21:00-04:00, priority 1) — la clasificación quedaría ambigua. Cambiá la prioridad o el horario.";
    expect(formatApiErrorMessage({
      error: { code: "HOUR_CONCEPT_RULE_AMBIGUOUS_OVERLAP", message: specificMessage },
    })).toBe(specificMessage);
  });
});

describe("apiRequest sin cache propia", () => {
  it("ejecuta dos GET reales aunque un llamador legado envíe apiCache=true", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 1 }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 2 }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<{ value: number }>("/cache-test", { auth: false, apiCache: true })).resolves.toEqual({ value: 1 });
    await expect(apiRequest<{ value: number }>("/cache-test", { auth: false, apiCache: true })).resolves.toEqual({ value: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("formatApiErrorMessage — eliminación de estructura con dependencias", () => {
  it("muestra tal cual el motivo de negocio del backend (no lo reemplaza por el genérico)", () => {
    const message = "No se puede eliminar la unidad de negocio “Producción” porque tiene elementos asociados: 2 establecimientos. Podés inactivarla si ya no debe utilizarse.";
    expect(formatApiErrorMessage({ error: { code: "ORG_STRUCTURE_HAS_DEPENDENCIES", message } })).toBe(message);
  });
});
