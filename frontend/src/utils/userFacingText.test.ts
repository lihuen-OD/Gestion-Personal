import { describe, expect, it } from "vitest";
import { formatTimeEntryObservation } from "./userFacingText";

describe("formatTimeEntryObservation", () => {
  it("convierte una observación histórica de fichada en texto operativo", () => {
    const uuid = "a90b1c2d-3456-4789-8abc-def012345678";
    const result = formatTimeEntryObservation(
      `Fichada ${uuid}: generado por ingreso/salida. Reglas aplicadas: Feriados. Multiplicador efectivo x2 (146 min reales).`,
    );

    expect(result).toBe(
      "Generado automáticamente a partir de la fichada. Reglas aplicadas: Feriados. Multiplicador x2 · 2 h 26 min trabajadas.",
    );
    expect(result).not.toContain(uuid);
  });

  it("elimina un UUID aislado sin alterar una observación normal", () => {
    expect(formatTimeEntryObservation("Revisión interna a90b1c2d-3456-4789-8abc-def012345678 pendiente"))
      .toBe("Revisión interna pendiente");
    expect(formatTimeEntryObservation("Confirmado por el encargado.")).toBe("Confirmado por el encargado.");
  });

  // Etapa audit-human-identity: nota legada de la reconciliación 15M.4.
  it("muestra la nota legada 'fusionada en TimeEntry <id>' con su redacción vigente, sin id ni frase rota", () => {
    const uuid = "e92bb60e-cf14-47ba-a79b-ae0814163741";
    const result = formatTimeEntryObservation(
      `Generado por fichada de ingreso/salida.\nRetirada de cómputo por reconciliación 15M.4 -- fusionada en TimeEntry ${uuid}.`,
    );

    expect(result).toBe(
      "Generado automáticamente a partir de la fichada.\nRetirada de cómputo por reconciliación 15M.4 -- fusionada en la carga de Horas normales del mismo día.",
    );
    expect(result).not.toContain(uuid);
    expect(result).not.toContain("TimeEntry");
  });

  it("el texto que hoy persiste el backend se muestra tal cual (el formateador no necesita ocultar nada)", () => {
    const persisted = "Generado automáticamente a partir de la fichada.\nRetirada de cómputo por reconciliación 15M.4 -- fusionada en la carga de Horas normales del mismo día.";
    expect(formatTimeEntryObservation(persisted)).toBe(persisted);
  });

  it("normaliza también la variante histórica sin UUID", () => {
    expect(formatTimeEntryObservation("Generado por fichada de ingreso/salida. Reglas aplicadas: Domingo."))
      .toBe("Generado automáticamente a partir de la fichada. Reglas aplicadas: Domingo.");
  });
});
