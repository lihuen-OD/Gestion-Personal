import { describe, expect, it } from "vitest";
import { assignInstantToBlock, candidateBlocksAround, DEFAULT_BLOCK_EARLY_WINDOW_MINUTES } from "./blockAssignment";
import { PLANTA_EMPLOYEES, plantaConfiguration } from "./plantaRotation.fixture";
import { resolveRotationDayPlan, type ExpectedBlock, type ExpectedDayPlan } from "./rotationPlan";

// R4.2 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.3): asignación PURA de
// una fichada a un bloque. Ventana [inicio − 240 min, fin); fuera de todas →
// UNASSIGNED; a lo sumo un bloque por fichada.
const art = (dateKey: string, hhmm: string) => new Date(`${dateKey}T${hhmm}:00.000-03:00`);
const config = plantaConfiguration();
const planFor = (employeeId: string) => (dateKey: string) => resolveRotationDayPlan(employeeId, dateKey, config);
const assign = (employeeId: string, instant: Date) => assignInstantToBlock(instant, candidateBlocksAround(instant, planFor(employeeId)));
/** Resultado compacto: "<fecha operativa>#<bloque>" o el motivo de UNASSIGNED. */
function where(result: ReturnType<typeof assign>): string {
  return result.kind === "ASSIGNED" ? `${result.block.operationalDate}#${result.block.blockIndex}` : result.reason;
}

describe("José, viernes 06/11/2026 (semana A): bloques 07:00–11:00 (#0) y 19:00–07:00 (#1)", () => {
  const JOSE = PLANTA_EMPLOYEES.JOSE;

  it("entrada 07:02 → bloque 07–11, en curso, +2 min", () => {
    const result = assign(JOSE, art("2026-11-06", "07:02"));
    expect(result).toMatchObject({ kind: "ASSIGNED", block: { blockIndex: 0, operationalDate: "2026-11-06" }, differenceMinutes: 2, withinScheduledInterval: true });
  });

  it("entrada 18:55 → bloque 19–07, anticipada −5 min (todavía no en curso)", () => {
    const result = assign(JOSE, art("2026-11-06", "18:55"));
    expect(result).toMatchObject({ kind: "ASSIGNED", block: { blockIndex: 1 }, differenceMinutes: -5, withinScheduledInterval: false });
  });

  it("la entrada 07:02 nunca es evidencia del bloque de las 19:00 (sólo se evalúa contra todo el plan)", () => {
    const result = assign(JOSE, art("2026-11-06", "07:02"));
    if (result.kind !== "ASSIGNED") throw new Error("esperaba ASSIGNED");
    expect(result.block.obligationKey).not.toBe(`${JOSE}|2026-11-06T22:00:00.000Z`);
  });

  it("entrada 11:30 (terminó el bloque 07–11 y todavía no abre la ventana del 19:00) → sin bloque", () => {
    expect(assign(JOSE, art("2026-11-06", "11:30"))).toEqual({ kind: "UNASSIGNED", reason: "OUTSIDE_ALL_WINDOWS" });
  });

  it.each([
    ["03:00", "2026-11-06#0"], // inicio de ventana del 07:00 (07:00 − 240), inclusivo
    ["02:59", "OUTSIDE_ALL_WINDOWS"],
    ["10:59", "2026-11-06#0"],
    ["11:00", "OUTSIDE_ALL_WINDOWS"], // fin del bloque, exclusivo
    ["14:59", "OUTSIDE_ALL_WINDOWS"],
    ["15:00", "2026-11-06#1"], // inicio de ventana del 19:00, inclusivo
    ["23:59", "2026-11-06#1"],
  ])("borde exacto viernes %s → %s", (hhmm, expected) => {
    expect(where(assign(JOSE, art("2026-11-06", hhmm)))).toBe(expected);
  });

  it("cruce de medianoche: el sábado 00:30 (03:30 UTC) y 06:59 siguen en el bloque del viernes; 07:00 ya no (fin exclusivo)", () => {
    expect(where(assign(JOSE, art("2026-11-07", "00:30")))).toBe("2026-11-06#1");
    expect(where(assign(JOSE, art("2026-11-07", "06:59")))).toBe("2026-11-06#1");
    expect(where(assign(JOSE, art("2026-11-07", "07:00")))).toBe("OUTSIDE_ALL_WINDOWS");
    expect(where(assign(JOSE, art("2026-11-07", "15:00")))).toBe("2026-11-07#0"); // ventana del sábado 19:00
  });

  it("barrido minuto a minuto (jue 12:00 → sáb 12:00): cada instante cae en a lo sumo un bloque, según los intervalos de ventana", () => {
    const start = art("2026-11-05", "12:00").getTime();
    const end = art("2026-11-07", "12:00").getTime();
    const expectedAt = (at: number): string => {
      const minute = (key: string, hhmm: string) => art(key, hhmm).getTime();
      if (at < minute("2026-11-05", "15:00")) return "2026-11-05#0"; // jueves 07–15 en curso
      if (at >= minute("2026-11-06", "03:00") && at < minute("2026-11-06", "11:00")) return "2026-11-06#0";
      if (at >= minute("2026-11-06", "15:00") && at < minute("2026-11-07", "07:00")) return "2026-11-06#1";
      return "OUTSIDE_ALL_WINDOWS";
    };
    for (let at = start; at < end; at += 60_000) {
      expect(where(assign(JOSE, new Date(at)))).toBe(expectedAt(at));
    }
  });
});

describe("bloques nocturnos y días vecinos", () => {
  it("Carlos (semana A): jue 05/11 16:55 → bloque del jueves; vie 02:30 → el mismo bloque (en curso); vie 03:00 → sin bloque (viernes descanso)", () => {
    expect(assign(PLANTA_EMPLOYEES.CARLOS, art("2026-11-05", "16:55"))).toMatchObject({ kind: "ASSIGNED", block: { operationalDate: "2026-11-05" }, differenceMinutes: -5 });
    expect(assign(PLANTA_EMPLOYEES.CARLOS, art("2026-11-06", "02:30"))).toMatchObject({ kind: "ASSIGNED", block: { operationalDate: "2026-11-05" }, withinScheduledInterval: true });
    expect(where(assign(PLANTA_EMPLOYEES.CARLOS, art("2026-11-06", "03:00")))).toBe("OUTSIDE_ALL_WINDOWS");
  });

  it("Juanchi: lun 09/11 06:55 → 07–15; lun 16/11 06:30 → el sereno del domingo 15/11 (en curso)", () => {
    expect(where(assign(PLANTA_EMPLOYEES.JUANCHI, art("2026-11-09", "06:55")))).toBe("2026-11-09#0");
    expect(where(assign(PLANTA_EMPLOYEES.JUANCHI, art("2026-11-16", "06:30")))).toBe("2026-11-15#0");
  });

  it("sin bloques candidatos (Juanjo no está en la rotación) → NO_CANDIDATES", () => {
    expect(assign(PLANTA_EMPLOYEES.JUANJO, art("2026-11-07", "07:00"))).toEqual({ kind: "UNASSIGNED", reason: "NO_CANDIDATES" });
  });
});

describe("reglas de desempate entre ventanas que compiten", () => {
  const block = (startHhmm: string, endHhmm: string, name: string) => ({ name, scheduledStartAt: art("2026-11-10", startHhmm), scheduledEndAt: art("2026-11-10", endHhmm) });
  const morning = block("07:00", "11:00", "mañana");
  const noon = block("13:00", "17:00", "mediodía"); // ventana desde las 09:00: se pisa con el bloque en curso

  it("dos ventanas contienen la fichada: gana el bloque en curso aunque el otro empiece más cerca", () => {
    const result = assignInstantToBlock(art("2026-11-10", "10:30"), [noon, morning]);
    expect(result).toMatchObject({ kind: "ASSIGNED", block: { name: "mañana" }, withinScheduledInterval: true });
  });

  it("terminado el bloque en curso, la misma fichada tardía pasa a ser anticipada del siguiente", () => {
    expect(assignInstantToBlock(art("2026-11-10", "11:00"), [morning, noon])).toMatchObject({ kind: "ASSIGNED", block: { name: "mediodía" }, differenceMinutes: -120 });
  });

  it("varias ventanas, ninguna en curso: gana el inicio más cercano; con bloques en curso superpuestos, también", () => {
    const a = block("12:00", "18:00", "a");
    const b = block("14:00", "18:00", "b");
    expect(assignInstantToBlock(art("2026-11-10", "11:30"), [b, a])).toMatchObject({ block: { name: "a" } }); // 30 min vs 150 min
    expect(assignInstantToBlock(art("2026-11-10", "14:30"), [a, b])).toMatchObject({ block: { name: "b" } }); // ambos en curso: 30 vs 150
  });

  it("a igual distancia del inicio (mismo inicio, ambos en curso) gana el que termina antes, en cualquier orden de entrada", () => {
    // x en curso y y sólo en ventana: gana x (regla del bloque en curso).
    const x = block("10:00", "14:00", "x");
    const y = block("12:00", "14:00", "y");
    expect(assignInstantToBlock(art("2026-11-10", "11:00"), [y, x])).toMatchObject({ block: { name: "x" } });
    // Empate en todas las reglas anteriores sólo es posible con el mismo inicio: decide el fin.
    const p = block("11:00", "13:00", "p");
    const q = block("11:00", "14:00", "q");
    expect(assignInstantToBlock(art("2026-11-10", "11:30"), [p, q])).toMatchObject({ block: { name: "p" } });
    expect(assignInstantToBlock(art("2026-11-10", "11:30"), [q, p])).toMatchObject({ block: { name: "p" } });
  });

  it("dos bloques en ventana, ninguno en curso y a la misma distancia sólo es posible con el mismo inicio: decide el fin, no el orden", () => {
    const p = block("12:00", "13:00", "p");
    const q = block("12:00", "15:00", "q");
    expect(assignInstantToBlock(art("2026-11-10", "11:00"), [q, p])).toMatchObject({ block: { name: "p" }, differenceMinutes: -60 });
    expect(assignInstantToBlock(art("2026-11-10", "11:00"), [p, q])).toMatchObject({ block: { name: "p" } });
  });

  it("la ventana anticipada por defecto es el umbral de revisión de ingreso anticipado (240 min) y es configurable", () => {
    expect(DEFAULT_BLOCK_EARLY_WINDOW_MINUTES).toBe(240);
    expect(assignInstantToBlock(art("2026-11-10", "06:00"), [morning], { earlyWindowMinutes: 30 })).toEqual({ kind: "UNASSIGNED", reason: "OUTSIDE_ALL_WINDOWS" });
    expect(assignInstantToBlock(art("2026-11-10", "06:30"), [morning], { earlyWindowMinutes: 30 })).toMatchObject({ kind: "ASSIGNED" });
  });
});

describe("candidateBlocksAround", () => {
  it("reúne D−1, D y D+1, sin duplicados por obligationKey y ordenados por inicio", () => {
    const blocks = candidateBlocksAround(art("2026-11-06", "12:00"), planFor(PLANTA_EMPLOYEES.JOSE));
    expect(blocks.map((block) => `${block.operationalDate}#${block.blockIndex}`)).toEqual(["2026-11-05#0", "2026-11-06#0", "2026-11-06#1", "2026-11-07#0"]);
    const friday = resolveRotationDayPlan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", config)!;
    expect(candidateBlocksAround(art("2026-11-06", "12:00"), () => friday)).toHaveLength(2);
  });

  it("REST, MISSING, CONFLICT y null no aportan candidatos", () => {
    const base = { dateKey: "2026-11-06", employeeId: "e", source: "ROTATION" as const };
    const plans: Array<ExpectedDayPlan | null> = [
      { ...base, kind: "REST", origin: { rotationId: "r", versionId: "v", crewId: "c", cycleWeekIndex: 0, weekday: 5, dayId: "d" } },
      { ...base, kind: "MISSING", reason: "NO_DAY_ROW", origin: { rotationId: "r", crewId: "c" } },
      { ...base, kind: "CONFLICT", reason: "MULTIPLE_MEMBERSHIPS", detail: [] },
      null,
    ];
    for (const plan of plans) expect(candidateBlocksAround(art("2026-11-06", "12:00"), () => plan)).toEqual([] as ExpectedBlock[]);
  });
});
