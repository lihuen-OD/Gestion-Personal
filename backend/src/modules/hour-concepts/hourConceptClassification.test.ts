import { describe, expect, it } from "vitest";
import { scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";
import {
  classifyShiftInterval,
  classifyWorkShiftSegments,
  sumClassifiedMinutes,
  type HourConceptRuleRef,
} from "./hourConceptClassification";

// Ancla siempre dentro del mismo día calendario Argentina (09:00 ART), para
// poder pedir cualquier HH:MM de ese día (o +1 día) sin depender de la zona
// horaria del proceso que corre el test — igual que ya exige argentinaTime.ts.
function art(dateKey: string, time: string, addDay = false): Date {
  const reference = new Date(`${dateKey}T12:00:00.000Z`);
  return scheduledInstantForShiftTime(reference, time, addDay);
}

const DAY = "2026-08-18";
const NEXT_DAY = new Date(`${DAY}T00:00:00.000Z`);

const NORMAL: HourConceptRuleRef = {
  id: "rule-normal",
  hourConceptId: "concept-normal",
  hourConceptName: "Hora normal",
  startTime: "07:00",
  endTime: "21:00",
  crossesMidnight: false,
  priority: 1,
};

const GUARDIA: HourConceptRuleRef = {
  id: "rule-guardia",
  hourConceptId: "concept-guardia",
  hourConceptName: "Guardia",
  startTime: "21:00",
  endTime: "04:00",
  crossesMidnight: true,
  priority: 1,
};

const FALLBACK = { id: "concept-normal", name: "Hora normal" };

describe("Caso A — jornada íntegramente dentro de una sola regla", () => {
  it("07:00–15:00 con Hora normal 07:00–21:00 -> 1 segmento SUGERIDO", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "07:00"),
      endAt: art(DAY, "15:00"),
      activeRules: [NORMAL],
      enabledHourConceptIds: new Set(["concept-normal"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ hourConceptId: "concept-normal", conceptStatus: "SUGERIDO", minutes: 480 });
    expect(sumClassifiedMinutes(result)).toBe(480);
  });
});

describe("Caso B — jornada que cruza medianoche entre dos reglas", () => {
  it("17:00–04:00 con Hora normal 07:00–21:00 + Guardia 21:00–04:00 -> 17-21 Normal, 21-04 Guardia", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "17:00"),
      endAt: art(DAY, "04:00", true),
      activeRules: [NORMAL, GUARDIA],
      enabledHourConceptIds: new Set(["concept-normal", "concept-guardia"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: "concept-normal", conceptStatus: "SUGERIDO", minutes: 240 });
    expect(result[1]).toMatchObject({ hourConceptId: "concept-guardia", conceptStatus: "SUGERIDO", minutes: 420 });
    expect(result[0]!.endAt.getTime()).toBe(result[1]!.startAt.getTime());
    expect(sumClassifiedMinutes(result)).toBe(660); // 17:00 a 04:00 = 11h reales
  });
});

describe("Caso C — tramo sin regla compatible al final de la jornada", () => {
  it("23:00–07:00 con solo Guardia 21:00–04:00 -> 23-04 Guardia, 04-07 SIN_CONCEPTO_COMPATIBLE", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "23:00"),
      endAt: art(DAY, "07:00", true),
      activeRules: [GUARDIA],
      enabledHourConceptIds: new Set(["concept-guardia"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: "concept-guardia", conceptStatus: "SUGERIDO", minutes: 300 });
    expect(result[1]).toMatchObject({ hourConceptId: FALLBACK.id, conceptStatus: "SIN_CONCEPTO_COMPATIBLE", minutes: 180, hourConceptRuleId: null });
    expect(sumClassifiedMinutes(result)).toBe(480); // 23:00 a 07:00 = 8h reales
  });
});

describe("Caso D — regla matchea pero el concepto no está habilitado para el empleado", () => {
  it("21:00–04:00 con Guardia matcheando pero no habilitada -> CONCEPTO_NO_HABILITADO, conserva el concepto detectado", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "21:00"),
      endAt: art(DAY, "04:00", true),
      activeRules: [GUARDIA],
      enabledHourConceptIds: new Set(), // Guardia no habilitada para este empleado.
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hourConceptId: "concept-guardia", // se conserva el concepto detectado, no se cae al fallback.
      hourConceptRuleId: "rule-guardia",
      conceptStatus: "CONCEPTO_NO_HABILITADO",
      minutes: 420,
    });
    expect(sumClassifiedMinutes(result)).toBe(420);
  });
});

describe("Caso E — ninguna regla activa cubre el tramo", () => {
  it("04:00–07:00 sin regla que matchee -> SIN_CONCEPTO_COMPATIBLE, minutos calculados igual", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "04:00"),
      endAt: art(DAY, "07:00"),
      activeRules: [NORMAL], // Normal arranca a las 07:00, no cubre este tramo.
      enabledHourConceptIds: new Set(["concept-normal"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, conceptStatus: "SIN_CONCEPTO_COMPATIBLE", minutes: 180, hourConceptRuleId: null });
    expect(sumClassifiedMinutes(result)).toBe(180);
  });
});

describe("Caso F — varias reglas solapadas en el mismo tramo: desambiguación determinística", () => {
  const especial: HourConceptRuleRef = {
    id: "rule-especial",
    hourConceptId: "concept-especial",
    hourConceptName: "Especial",
    startTime: "08:00",
    endTime: "09:00",
    crossesMidnight: false,
    priority: 5,
  };

  it("gana la regla de mayor priority en el sub-tramo solapado", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "08:00"),
      endAt: art(DAY, "10:00"),
      activeRules: [NORMAL, especial],
      enabledHourConceptIds: new Set(["concept-normal", "concept-especial"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: "concept-especial", minutes: 60 });
    expect(result[1]).toMatchObject({ hourConceptId: "concept-normal", minutes: 60 });
    expect(sumClassifiedMinutes(result)).toBe(120);
  });

  it("empate de priority: gana el startTime más temprano, después el id — mismo resultado en corridas repetidas", () => {
    const ruleA: HourConceptRuleRef = { id: "rule-b", hourConceptId: "concept-a", hourConceptName: "A", startTime: "08:00", endTime: "12:00", crossesMidnight: false, priority: 3 };
    const ruleB: HourConceptRuleRef = { id: "rule-a", hourConceptId: "concept-b", hourConceptName: "B", startTime: "08:00", endTime: "12:00", crossesMidnight: false, priority: 3 };

    const runOnce = () =>
      classifyShiftInterval({
        startAt: art(DAY, "08:00"),
        endAt: art(DAY, "12:00"),
        activeRules: [ruleA, ruleB],
        enabledHourConceptIds: new Set(["concept-a", "concept-b"]),
        fallbackHourConcept: FALLBACK,
      });

    const first = runOnce();
    const second = runOnce();
    expect(first).toHaveLength(1);
    expect(first[0]!.hourConceptId).toBe("concept-b"); // mismo priority y startTime -> gana el id menor ("rule-a").
    expect(second).toEqual(first); // determinístico entre corridas.
  });
});

describe("Caso G — invariante de minutos: nunca se pierden, inventan ni duplican", () => {
  it("la suma de minutos de todos los segmentos es exactamente igual a los minutos reales del rango, para cada caso anterior", () => {
    const scenarios: Array<{ startAt: Date; endAt: Date; activeRules: HourConceptRuleRef[]; enabledHourConceptIds: ReadonlySet<string> }> = [
      { startAt: art(DAY, "07:00"), endAt: art(DAY, "15:00"), activeRules: [NORMAL], enabledHourConceptIds: new Set(["concept-normal"]) },
      { startAt: art(DAY, "17:00"), endAt: art(DAY, "04:00", true), activeRules: [NORMAL, GUARDIA], enabledHourConceptIds: new Set(["concept-normal", "concept-guardia"]) },
      { startAt: art(DAY, "23:00"), endAt: art(DAY, "07:00", true), activeRules: [GUARDIA], enabledHourConceptIds: new Set(["concept-guardia"]) },
      { startAt: art(DAY, "21:00"), endAt: art(DAY, "04:00", true), activeRules: [GUARDIA], enabledHourConceptIds: new Set() },
      { startAt: art(DAY, "04:00"), endAt: art(DAY, "07:00"), activeRules: [NORMAL], enabledHourConceptIds: new Set(["concept-normal"]) },
    ];

    for (const scenario of scenarios) {
      const expectedMinutes = Math.round((scenario.endAt.getTime() - scenario.startAt.getTime()) / 60_000);
      const result = classifyShiftInterval({ ...scenario, fallbackHourConcept: FALLBACK });
      expect(sumClassifiedMinutes(result)).toBe(expectedMinutes);
    }
  });
});

describe("Caso H — regresión: sin HourConceptRule activa, comportamiento idéntico al anterior a esta etapa", () => {
  it("classifyWorkShiftSegments con activeRules=[] devuelve 1 segmento MANUAL por tramo de día, sin tocar conceptId/nombre del fallback", () => {
    const daySegments = [
      { date: NEXT_DAY, startAt: art(DAY, "17:00"), endAt: art(DAY, "24:00") },
      { date: new Date(NEXT_DAY.getTime() + 24 * 60 * 60_000), startAt: art(DAY, "00:00", true), endAt: art(DAY, "04:00", true) },
    ];

    const result = classifyWorkShiftSegments({
      daySegments,
      activeRules: [],
      enabledHourConceptIds: new Set(),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, hourConceptName: FALLBACK.name, conceptStatus: "MANUAL", hourConceptRuleId: null, minutes: 420 });
    expect(result[1]).toMatchObject({ hourConceptId: FALLBACK.id, hourConceptName: FALLBACK.name, conceptStatus: "MANUAL", hourConceptRuleId: null, minutes: 240 });
    expect(sumClassifiedMinutes(result)).toBe(660);
  });

  it("con reglas activas cargadas, classifyWorkShiftSegments compone la partición por día con la partición por concepto dentro de cada tramo", () => {
    const daySegments = [
      { date: NEXT_DAY, startAt: art(DAY, "17:00"), endAt: art(DAY, "24:00") },
      { date: new Date(NEXT_DAY.getTime() + 24 * 60 * 60_000), startAt: art(DAY, "00:00", true), endAt: art(DAY, "04:00", true) },
    ];

    const result = classifyWorkShiftSegments({
      daySegments,
      activeRules: [NORMAL, GUARDIA],
      enabledHourConceptIds: new Set(["concept-normal", "concept-guardia"]),
      fallbackHourConcept: FALLBACK,
    });

    // Mismo resultado "lógico" que el Caso B (17-21 Normal, 21-04 Guardia),
    // pero partido en 3 segmentos porque 21:00-24:00 y 00:00-04:00 caen en
    // días calendario Argentina distintos (TimeSegment.date es un solo día).
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ hourConceptId: "concept-normal", conceptStatus: "SUGERIDO", minutes: 240, date: daySegments[0]!.date });
    expect(result[1]).toMatchObject({ hourConceptId: "concept-guardia", conceptStatus: "SUGERIDO", minutes: 180, date: daySegments[0]!.date });
    expect(result[2]).toMatchObject({ hourConceptId: "concept-guardia", conceptStatus: "SUGERIDO", minutes: 240, date: daySegments[1]!.date });
    expect(sumClassifiedMinutes(result)).toBe(660);
  });
});
