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

describe("Caso D — salvaguarda defensiva: si igual llega una regla no habilitada (no debería pasar desde la Etapa 15I)", () => {
  // Etapa 15I (docs/decisions/ENABLED_HOUR_CONCEPT_CLASSIFICATION_15I.md): el
  // único caller real (classifySegmentsForEmployee) ya filtra activeRules a
  // sólo conceptos habilitados ANTES de llamar a classifyShiftInterval — este
  // caso ya no ocurre en el camino normal. Se conserva para blindar el
  // comportamiento defensivo de la función pura en sí (datos legacy, o un
  // caller futuro que no pre-filtre): si por lo que sea llega una regla de un
  // concepto no habilitado, sigue marcando CONCEPTO_NO_HABILITADO en vez de
  // fallar o inventar un resultado — ver "Etapa 15I" más abajo para el
  // comportamiento esperado del caller real.
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

// Etapa 15I (docs/decisions/ENABLED_HOUR_CONCEPT_CLASSIFICATION_15I.md): estos
// casos ejercitan exactamente lo que hace el caller real (classifySegmentsForEmployee,
// timeEntries.service.ts) desde esta etapa — le pasa a estas funciones puras
// `activeRules` YA filtradas a sólo conceptos habilitados para el empleado
// (candidateRules = activeRules.filter(rule => enabledHourConceptIds.has(rule.hourConceptId))).
// Sereno nunca tiene su propia regla de Hora normal en producción (Etapa 6E:
// una HourConceptRule no puede pertenecer al concepto systemRole=NORMAL_BASE),
// así que estos fixtures no incluyen una regla "NORMAL" — el fallback
// (Hora normal) es siempre lo que classifyShiftInterval usa cuando ningún
// candidato cubre el tramo.
describe("Etapa 15I — sólo conceptos habilitados llegan como reglas candidatas", () => {
  const SERENO: HourConceptRuleRef = {
    id: "rule-sereno",
    hourConceptId: "concept-sereno",
    hourConceptName: "Sereno",
    startTime: "21:00",
    endTime: "03:00",
    crossesMidnight: true,
    priority: 0,
  };

  function expectNoConceptoNoHabilitado(result: Array<{ conceptStatus: string }>) {
    expect(result.every((segment) => segment.conceptStatus !== "CONCEPTO_NO_HABILITADO")).toBe(true);
  }

  it("1) sólo Hora normal + trabajo diurno, Sereno filtrado (no candidato) -> 100% Hora normal, sin CONCEPTO_NO_HABILITADO", () => {
    // candidateRules ya vino vacía del caller: Sereno no está habilitado para
    // este empleado, así que ni siquiera llega acá.
    const result = classifyWorkShiftSegments({
      daySegments: [{ date: NEXT_DAY, startAt: art(DAY, "09:00"), endAt: art(DAY, "17:00") }],
      activeRules: [],
      enabledHourConceptIds: new Set(),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, hourConceptName: FALLBACK.name, conceptStatus: "MANUAL", minutes: 480 });
    expectNoConceptoNoHabilitado(result);
    expect(sumClassifiedMinutes(result)).toBe(480);
  });

  it("2) sólo Hora normal + trabajo nocturno, Sereno filtrado -> 100% Hora normal, sin CONCEPTO_NO_HABILITADO", () => {
    const result = classifyWorkShiftSegments({
      daySegments: [{ date: NEXT_DAY, startAt: art(DAY, "21:00"), endAt: art(DAY, "23:30") }],
      activeRules: [],
      enabledHourConceptIds: new Set(),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, conceptStatus: "MANUAL", minutes: 150 });
    expectNoConceptoNoHabilitado(result);
    expect(sumClassifiedMinutes(result)).toBe(150);
  });

  it("3) sólo Hora normal + cross-midnight, Sereno filtrado -> 100% Hora normal en ambos tramos de día, sin CONCEPTO_NO_HABILITADO", () => {
    const daySegments = [
      { date: NEXT_DAY, startAt: art(DAY, "22:00"), endAt: art(DAY, "24:00") },
      { date: new Date(NEXT_DAY.getTime() + 24 * 60 * 60_000), startAt: art(DAY, "00:00", true), endAt: art(DAY, "02:00", true) },
    ];

    const result = classifyWorkShiftSegments({
      daySegments,
      activeRules: [],
      enabledHourConceptIds: new Set(),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, conceptStatus: "MANUAL", minutes: 120, date: daySegments[0]!.date });
    expect(result[1]).toMatchObject({ hourConceptId: FALLBACK.id, conceptStatus: "MANUAL", minutes: 120, date: daySegments[1]!.date });
    expectNoConceptoNoHabilitado(result);
    expect(sumClassifiedMinutes(result)).toBe(240);
  });

  it("4) Hora normal + Sereno habilitados, tramo mixto (mismo día) -> reparto correcto, sin pérdida ni CONCEPTO_NO_HABILITADO", () => {
    // Sereno sí es candidata (habilitada). 14:00-21:00 no cae dentro de
    // 21:00-03:00 -> ningún candidato lo cubre -> fallback Hora normal
    // (SIN_CONCEPTO_COMPATIBLE, no CONCEPTO_NO_HABILITADO). 21:00-22:00 sí.
    const result = classifyShiftInterval({
      startAt: art(DAY, "14:00"),
      endAt: art(DAY, "22:00"),
      activeRules: [SERENO],
      enabledHourConceptIds: new Set(["concept-sereno"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, minutes: 420 });
    expect(result[1]).toMatchObject({ hourConceptId: "concept-sereno", conceptStatus: "SUGERIDO", minutes: 60 });
    expectNoConceptoNoHabilitado(result);
    expect(sumClassifiedMinutes(result)).toBe(480); // 14:00 a 22:00 = 8h reales
  });

  it("5) Hora normal + Sereno habilitados, jornada íntegramente dentro de Sereno -> 100% Sereno", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "22:00"),
      endAt: art(DAY, "02:00", true),
      activeRules: [SERENO],
      enabledHourConceptIds: new Set(["concept-sereno"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ hourConceptId: "concept-sereno", conceptStatus: "SUGERIDO", minutes: 240 });
    expectNoConceptoNoHabilitado(result);
    expect(sumClassifiedMinutes(result)).toBe(240); // 22:00 a 02:00 = 4h reales
  });

  it("6) Hora normal + Sereno habilitados, cross-midnight -> reparto correcto (ejemplo del pedido: 18:00-03:00, Normal=3h, Sereno=6h, total=9h)", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "18:00"),
      endAt: art(DAY, "03:00", true),
      activeRules: [SERENO],
      enabledHourConceptIds: new Set(["concept-sereno"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, minutes: 180 }); // 18:00-21:00 = 3h Hora normal
    expect(result[1]).toMatchObject({ hourConceptId: "concept-sereno", conceptStatus: "SUGERIDO", minutes: 360 }); // 21:00-03:00 = 6h Sereno
    expectNoConceptoNoHabilitado(result);
    expect(sumClassifiedMinutes(result)).toBe(540); // 9h reales
  });

  it("7/8/9) invariante de minutos con candidateRules ya filtradas: nunca se pierden, inventan ni duplican, en ningún escenario anterior", () => {
    const scenarios: Array<{ startAt: Date; endAt: Date; activeRules: HourConceptRuleRef[]; enabledHourConceptIds: ReadonlySet<string> }> = [
      { startAt: art(DAY, "09:00"), endAt: art(DAY, "17:00"), activeRules: [], enabledHourConceptIds: new Set() },
      { startAt: art(DAY, "21:00"), endAt: art(DAY, "23:30"), activeRules: [], enabledHourConceptIds: new Set() },
      { startAt: art(DAY, "14:00"), endAt: art(DAY, "22:00"), activeRules: [SERENO], enabledHourConceptIds: new Set(["concept-sereno"]) },
      { startAt: art(DAY, "22:00"), endAt: art(DAY, "02:00", true), activeRules: [SERENO], enabledHourConceptIds: new Set(["concept-sereno"]) },
      { startAt: art(DAY, "18:00"), endAt: art(DAY, "03:00", true), activeRules: [SERENO], enabledHourConceptIds: new Set(["concept-sereno"]) },
    ];

    for (const scenario of scenarios) {
      const expectedMinutes = Math.round((scenario.endAt.getTime() - scenario.startAt.getTime()) / 60_000);
      const result = classifyShiftInterval({ ...scenario, fallbackHourConcept: FALLBACK });
      expect(sumClassifiedMinutes(result)).toBe(expectedMinutes); // ni se pierde ni se inventa
      const ids = new Set(result.map((segment) => `${segment.startAt.getTime()}-${segment.endAt.getTime()}`));
      expect(ids.size).toBe(result.length); // ningún sub-tramo se cuenta dos veces
      expectNoConceptoNoHabilitado(result);
    }
  });
});

describe("Etapa 15M.7A — el fallback es Hora normal sin alerta", () => {
  const rule = (id: string, concept: string, startTime: string, endTime: string): HourConceptRuleRef => ({
    id,
    hourConceptId: concept,
    hourConceptName: concept,
    startTime,
    endTime,
    crossesMidnight: false,
    priority: 0,
  });

  it("Caso A: 08:59–11:20 conserva 141 min normales y detecta 120 min de Prueba", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "08:59"),
      endAt: art(DAY, "11:20"),
      activeRules: [rule("rule-prueba", "Prueba", "09:00", "11:00")],
      enabledHourConceptIds: new Set(["Prueba"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(sumClassifiedMinutes(result)).toBe(141);
    expect(result.filter((segment) => segment.hourConceptId === "Prueba").reduce((sum, segment) => sum + segment.minutes, 0)).toBe(120);
    expect(result.filter((segment) => segment.hourConceptId === FALLBACK.id).map((segment) => segment.minutes)).toEqual([1, 20]);
  });

  it("Caso B: una regla 10:00–12:00 deja 07–10 y 12–15 como Hora normal legítima", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "07:00"),
      endAt: art(DAY, "15:00"),
      activeRules: [rule("rule-extra", "Extra", "10:00", "12:00")],
      enabledHourConceptIds: new Set(["Extra"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result.map(({ hourConceptId, minutes }) => ({ hourConceptId, minutes }))).toEqual([
      { hourConceptId: FALLBACK.id, minutes: 180 },
      { hourConceptId: "Extra", minutes: 120 },
      { hourConceptId: FALLBACK.id, minutes: 180 },
    ]);
    expect(sumClassifiedMinutes(result)).toBe(480);
  });

  it("Caso C: huecos entre varios conceptos adicionales permanecen en Hora normal", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "07:00"),
      endAt: art(DAY, "15:00"),
      activeRules: [rule("rule-a", "A", "08:00", "09:00"), rule("rule-b", "B", "12:00", "13:30")],
      enabledHourConceptIds: new Set(["A", "B"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result.filter((segment) => segment.hourConceptId === FALLBACK.id).reduce((sum, segment) => sum + segment.minutes, 0)).toBe(330);
    expect(sumClassifiedMinutes(result)).toBe(480);
  });

  it("Caso D: si ninguna regla habilitada coincide, toda la jornada queda en Hora normal", () => {
    const result = classifyShiftInterval({
      startAt: art(DAY, "07:00"),
      endAt: art(DAY, "15:00"),
      activeRules: [rule("rule-night", "Nocturno", "21:00", "23:00")],
      enabledHourConceptIds: new Set(["Nocturno"]),
      fallbackHourConcept: FALLBACK,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ hourConceptId: FALLBACK.id, minutes: 480, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" });
  });
});
