import { describe, expect, it } from "vitest";
import { classifyNormalHoursDiscrepancy, pickCanonicalEntry, requiresRepair, type NormalEntryRow } from "./normalHoursReconciliation";

function row(overrides: Partial<NormalEntryRow> = {}): NormalEntryRow {
  return {
    id: "entry-1",
    totalMinutes: 249,
    actualMinutes: 249,
    hours: 249 / 60,
    status: "APROBADO",
    workShiftId: "shift-1",
    timeSegmentId: "segment-1",
    createdAt: new Date("2026-09-16T15:00:00.000Z"),
    updatedAt: new Date("2026-09-16T15:00:00.000Z"),
    ...overrides,
  };
}

describe("classifyNormalHoursDiscrepancy", () => {
  it("OK — una sola fila cuyo total coincide exactamente con lo esperado", () => {
    const result = classifyNormalHoursDiscrepancy(249, [row()]);
    expect(result).toMatchObject({ kind: "OK", differenceMinutes: 0, currentTotalMinutes: 249 });
  });

  it("MISSING_TIME_ENTRY — hay minutos esperados pero cero filas", () => {
    const result = classifyNormalHoursDiscrepancy(250, []);
    expect(result.kind).toBe("MISSING_TIME_ENTRY");
  });

  it("OK — cero filas y cero minutos esperados (fecha sin actividad, no debería ni llegar acá en la práctica)", () => {
    const result = classifyNormalHoursDiscrepancy(0, []);
    expect(result.kind).toBe("OK");
  });

  it("UNDERCOUNT — regresión exacta del caso legajo 30/16-09: 61 persistidos, 250 esperados", () => {
    const result = classifyNormalHoursDiscrepancy(250, [row({ totalMinutes: 61, actualMinutes: 61, hours: 61 / 60 })]);
    expect(result).toMatchObject({ kind: "UNDERCOUNT", differenceMinutes: 61 - 250, currentTotalMinutes: 61 });
  });

  it("OVERCOUNT — el TimeEntry persistido tiene más minutos que los reales según WorkShift/TimeSegment", () => {
    const result = classifyNormalHoursDiscrepancy(200, [row({ totalMinutes: 260, actualMinutes: 260, hours: 260 / 60 })]);
    expect(result.kind).toBe("OVERCOUNT");
  });

  it("DUPLICATE — dos filas activas del mismo status para la misma fecha", () => {
    const result = classifyNormalHoursDiscrepancy(443, [
      row({ id: "a", totalMinutes: 180, actualMinutes: 180, hours: 3 }),
      row({ id: "b", totalMinutes: 263, actualMinutes: 263, hours: 263 / 60 }),
    ]);
    expect(result).toMatchObject({ kind: "DUPLICATE", rowCount: 2 });
  });

  it("MIXED_STATUS — dos filas activas con status distinto", () => {
    const result = classifyNormalHoursDiscrepancy(443, [
      row({ id: "a", totalMinutes: 180, status: "APROBADO" }),
      row({ id: "b", totalMinutes: 263, status: "EN_REVISION" }),
    ]);
    expect(result.kind).toBe("MIXED_STATUS");
  });

  it("LEGACY_INCONSISTENT — hours*60 no coincide con totalMinutes en una única fila", () => {
    const result = classifyNormalHoursDiscrepancy(249, [row({ hours: 5 })]); // 5*60=300 != 249
    expect(result.kind).toBe("LEGACY_INCONSISTENT");
  });

  it("LEGACY_INCONSISTENT — actualMinutes no nulo pero distinto de totalMinutes", () => {
    const result = classifyNormalHoursDiscrepancy(249, [row({ actualMinutes: 100 })]);
    expect(result.kind).toBe("LEGACY_INCONSISTENT");
  });

  it("idempotencia: después de un repair (canónica correcta + duplicado retirado en 0) vuelve a dar OK, no DUPLICATE", () => {
    const result = classifyNormalHoursDiscrepancy(250, [
      row({ id: "canonical", totalMinutes: 250, actualMinutes: 250, hours: 250 / 60 }),
      row({ id: "retired", totalMinutes: 0, actualMinutes: 0, hours: 0 }),
    ]);
    expect(result).toMatchObject({ kind: "OK", rowCount: 2 });
  });

  it("MISSING_TIME_ENTRY sigue detectándose aunque todas las filas físicas estén retiradas en 0", () => {
    const result = classifyNormalHoursDiscrepancy(120, [row({ totalMinutes: 0, actualMinutes: 0, hours: 0 })]);
    expect(result.kind).toBe("MISSING_TIME_ENTRY");
  });
});

describe("requiresRepair", () => {
  it("sólo OK no requiere reparación", () => {
    expect(requiresRepair("OK")).toBe(false);
    for (const kind of ["MISSING_TIME_ENTRY", "UNDERCOUNT", "OVERCOUNT", "DUPLICATE", "MIXED_STATUS", "LEGACY_INCONSISTENT"] as const) {
      expect(requiresRepair(kind)).toBe(true);
    }
  });
});

describe("pickCanonicalEntry", () => {
  it("con una sola fila activa (aunque haya otras ya retiradas en 0), esa sigue siendo la canónica -- preserva continuidad entre corridas", () => {
    const active = row({ id: "canonical", totalMinutes: 250 });
    const retired = row({ id: "retired", totalMinutes: 0 });
    const { canonical, duplicates } = pickCanonicalEntry([retired, active]);
    expect(canonical.id).toBe("canonical");
    expect(duplicates.map((d) => d.id)).toEqual(["retired"]);
  });

  it("entre duplicados reales (todas activas), elige el estado más avanzado", () => {
    const borrador = row({ id: "borrador", status: "BORRADOR", createdAt: new Date("2026-09-14T10:00:00Z") });
    const aprobado = row({ id: "aprobado", status: "APROBADO", createdAt: new Date("2026-09-14T12:00:00Z") });
    const { canonical } = pickCanonicalEntry([borrador, aprobado]);
    expect(canonical.id).toBe("aprobado");
  });

  it("en empate de estado, elige la fila con createdAt más antiguo", () => {
    const later = row({ id: "later", status: "APROBADO", createdAt: new Date("2026-09-14T16:58:56Z") });
    const earlier = row({ id: "earlier", status: "APROBADO", createdAt: new Date("2026-09-14T16:58:55Z") });
    const { canonical, duplicates } = pickCanonicalEntry([later, earlier]);
    expect(canonical.id).toBe("earlier");
    expect(duplicates.map((d) => d.id)).toEqual(["later"]);
  });

  it("CERRADO le gana a APROBADO aunque sea más nuevo", () => {
    const aprobado = row({ id: "aprobado", status: "APROBADO", createdAt: new Date("2026-09-14T10:00:00Z") });
    const cerrado = row({ id: "cerrado", status: "CERRADO", createdAt: new Date("2026-09-14T12:00:00Z") });
    const { canonical } = pickCanonicalEntry([aprobado, cerrado]);
    expect(canonical.id).toBe("cerrado");
  });
});
