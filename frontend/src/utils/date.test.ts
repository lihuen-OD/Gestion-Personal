import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatDateTime, formatInstantDate, formatInstantTime } from "./date";

// Etapa 15M.21 (normalización global de fechas visibles): estos son los
// formatters canónicos para toda fecha visible al usuario. El caso crítico
// que estos tests cubren es el que motivó la etapa: una fecha calendario
// nunca debe desplazarse un día por conversión de huso horario, y un
// instante real sí debe convertirse a hora Argentina antes de mostrarse.

describe("formatCalendarDate — FECHA CALENDARIO (@db.Date), sin conversión de huso horario", () => {
  it("YYYY-MM-DD -> DD/MM/AAAA", () => {
    expect(formatCalendarDate("2026-09-21")).toBe("21/09/2026");
  });

  it("un string con hora/offset (@db.Date serializado a medianoche UTC) no se re-interpreta: sólo se toma la fecha", () => {
    expect(formatCalendarDate("2026-09-21T00:00:00.000Z")).toBe("21/09/2026");
  });
});

describe("formatInstantDate — INSTANTE real (@db.Timestamptz), sí convierte a día calendario Argentina", () => {
  it("un instante bien entrado el día no cambia de fecha", () => {
    // 2026-09-21 14:00 ART = 2026-09-21 17:00 UTC.
    expect(formatInstantDate("2026-09-21T17:00:00.000Z")).toBe("21/09/2026");
  });

  it("caso crítico: un instante de madrugada UTC que todavía es el día anterior en Argentina", () => {
    // 2026-09-21 23:30 ART = 2026-09-22 02:30 UTC — tomar el día UTC crudo
    // (22) en vez del día calendario Argentina (21) es exactamente el bug
    // que esta etapa corrige.
    expect(formatInstantDate("2026-09-22T02:30:00.000Z")).toBe("21/09/2026");
  });

  it("valor inválido no rompe el render", () => {
    expect(formatInstantDate("no-es-una-fecha")).toBe("-");
  });
});

describe("formatInstantTime — hora Argentina 'HH:mm', 24 horas", () => {
  it("formatea en 24 horas, nunca con 'a. m.'/'p. m.'", () => {
    // 2026-09-21 14:35 ART = 2026-09-21 17:35 UTC.
    expect(formatInstantTime("2026-09-21T17:35:00.000Z")).toBe("14:35");
  });
});

describe("formatDateTime — formato canónico combinado 'DD/MM/AAAA · HH:mm'", () => {
  it("combina fecha y hora Argentina con el separador ' · '", () => {
    expect(formatDateTime("2026-09-21T17:35:00.000Z")).toBe("21/09/2026 · 14:35");
  });

  it("valor inválido no rompe el render", () => {
    expect(formatDateTime("")).toBe("-");
  });
});
