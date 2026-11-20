import { describe, expect, it } from "vitest";
import { nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { PLANTA_ANCHOR, PLANTA_CREWS, PLANTA_EMPLOYEES, PLANTA_ROTATION_ID, PLANTA_TEMPLATES, PLANTA_VERSION_ID, plantaConfiguration, plantaDays, plantaRotation, plantaVersion } from "./plantaRotation.fixture";
import { resolveRotationDayPlan, rotationWeekIndex, rotationWeekLabel, type ExpectedDayPlan, type RotationConfiguration, type RotationTemplateRef } from "./rotationPlan";

// R4.2 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.3): núcleo puro de
// rotaciones contra la especificación REAL de Planta (§25).
const art = (dateKey: string, hhmm: string) => new Date(`${dateKey}T${hhmm}:00.000-03:00`);
const config = plantaConfiguration();
const plan = (employeeId: string, dateKey: string, configuration: RotationConfiguration = config) => resolveRotationDayPlan(employeeId, dateKey, configuration);

/** Resumen legible del plan: "REST", "07-17", "07-11+19-07", "MISSING:…", "CONFLICT:…". */
function summary(dayPlan: ExpectedDayPlan | null): string {
  if (!dayPlan) return "-";
  if (dayPlan.kind === "SHIFTS") return dayPlan.blocks.map((block) => `${block.template.startTime.slice(0, 2)}-${block.template.endTime.slice(0, 2)}`).join("+");
  if (dayPlan.kind === "MISSING" || dayPlan.kind === "CONFLICT") return `${dayPlan.kind}:${dayPlan.reason}`;
  return dayPlan.kind;
}

function datesFrom(start: string, count: number): string[] {
  const keys = [start];
  while (keys.length < count) keys.push(nextCalendarDateKey(keys[keys.length - 1]!));
  return keys;
}

describe("semana del ciclo (ancla lunes 02/11/2026 = A, ciclo de 2 semanas)", () => {
  it.each([
    ["2026-11-02", "A"],
    ["2026-11-08", "A"], // domingo: semana del lunes 02/11
    ["2026-11-09", "B"],
    ["2026-11-16", "A"],
    ["2026-11-23", "B"],
    ["2026-11-29", "B"],
    ["2026-11-30", "A"], // cambio de mes sin reinicio
    ["2026-12-06", "A"],
    ["2026-12-07", "B"],
    ["2026-12-28", "A"],
    ["2027-01-03", "A"], // cambio de año sin reinicio
    ["2027-01-04", "B"],
    ["2026-10-26", "B"], // anterior al ancla: módulo positivo
    ["2026-10-19", "A"],
  ])("%s → semana %s", (dateKey, label) => {
    expect(rotationWeekLabel(rotationWeekIndex(PLANTA_ANCHOR, 2, dateKey))).toBe(label);
  });

  it("ciclos de 3 y 4 semanas, y validación de ancla y longitud", () => {
    expect(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"].map((key) => rotationWeekIndex(PLANTA_ANCHOR, 3, key))).toEqual([0, 1, 2, 0]);
    expect(["2026-11-02", "2026-11-30", "2026-10-26"].map((key) => rotationWeekIndex(PLANTA_ANCHOR, 4, key))).toEqual([0, 0, 3]);
    expect(() => rotationWeekIndex("2026-11-03", 2, "2026-11-10")).toThrow(RangeError);
    expect(() => rotationWeekIndex(PLANTA_ANCHOR, 0, "2026-11-10")).toThrow(RangeError);
    expect(() => rotationWeekIndex(PLANTA_ANCHOR, 13, "2026-11-10")).toThrow(RangeError);
  });
});

// Tabla de la especificación (§25), lunes 02/11 → domingo 15/11 (semanas A y B), escrita a mano.
const EXPECTED_TWO_WEEKS: Record<string, string[]> = {
  [PLANTA_EMPLOYEES.ROBERTO]: ["07-17", "07-17", "07-17", "07-17", "07-19", "07-19", "07-19", "17-03", "17-03", "17-03", "17-03", "REST", "REST", "REST"],
  [PLANTA_EMPLOYEES.ARIEL]: ["07-17", "07-17", "07-17", "07-17", "07-19", "07-19", "07-19", "17-03", "17-03", "17-03", "17-03", "REST", "REST", "REST"],
  [PLANTA_EMPLOYEES.CARLOS]: ["17-03", "17-03", "17-03", "17-03", "REST", "REST", "REST", "07-17", "07-17", "07-17", "07-17", "07-19", "07-19", "07-19"],
  [PLANTA_EMPLOYEES.WALTER]: ["17-03", "17-03", "17-03", "17-03", "REST", "REST", "REST", "07-17", "07-17", "07-17", "07-17", "07-19", "07-19", "07-19"],
  [PLANTA_EMPLOYEES.JUANCHI]: ["REST", "03-11", "03-11", "03-11", "03-11", "REST", "REST", "07-15", "03-11", "03-11", "03-11", "19-07", "19-07", "19-07"],
  [PLANTA_EMPLOYEES.JOSE]: ["07-15", "07-15", "07-15", "07-15", "07-11+19-07", "19-07", "19-07", "REST", "07-15", "07-15", "07-15", "07-15", "REST", "REST"],
  [PLANTA_EMPLOYEES.JOHANNA]: ["07-15", "07-15", "07-15", "07-15", "07-15", "REST", "REST", "07-15", "07-15", "07-15", "07-15", "07-15", "07-15", "07-15"],
};

describe("calendario real de noviembre 2026", () => {
  const firstTwoWeeks = datesFrom("2026-11-02", 14);

  it.each(Object.entries(EXPECTED_TWO_WEEKS))("%s: 02/11–15/11 coincide con la especificación", (employeeId, expected) => {
    expect(firstTwoWeeks.map((key) => summary(plan(employeeId, key)))).toEqual(expected);
  });

  it.each(Object.entries(EXPECTED_TWO_WEEKS))("%s: 16/11–29/11 repite el ciclo y 30/11–13/12 también (sin reinicios entre meses)", (employeeId, expected) => {
    expect(datesFrom("2026-11-16", 14).map((key) => summary(plan(employeeId, key)))).toEqual(expected);
    expect(datesFrom("2026-11-30", 14).map((key) => summary(plan(employeeId, key)))).toEqual(expected);
  });

  it("Roberto 02/11 → 07–17 en instantes de Argentina", () => {
    const dayPlan = plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-02");
    expect(dayPlan).toMatchObject({ kind: "SHIFTS", source: "ROTATION", origin: { rotationId: PLANTA_ROTATION_ID, versionId: PLANTA_VERSION_ID, crewId: PLANTA_CREWS.ROBERTO_ARIEL, cycleWeekIndex: 0, weekday: 1 } });
    if (dayPlan?.kind !== "SHIFTS") throw new Error("esperaba SHIFTS");
    expect(dayPlan.blocks).toEqual([
      expect.objectContaining({ blockIndex: 0, scheduledStartAt: art("2026-11-02", "07:00"), scheduledEndAt: art("2026-11-02", "17:00"), durationMinutes: 600, operationalDate: "2026-11-02", source: "ROTATION" }),
    ]);
  });

  it("Carlos 02/11 → 17–03: el bloque pertenece al lunes y termina el martes 03:00", () => {
    const dayPlan = plan(PLANTA_EMPLOYEES.CARLOS, "2026-11-02");
    if (dayPlan?.kind !== "SHIFTS") throw new Error("esperaba SHIFTS");
    expect(dayPlan.blocks[0]).toMatchObject({ operationalDate: "2026-11-02", scheduledStartAt: art("2026-11-02", "17:00"), scheduledEndAt: art("2026-11-03", "03:00"), durationMinutes: 600 });
  });

  it("Carlos 06/11 → descanso: la salida de las 03:00 es del bloque del jueves 05/11, no un turno nuevo", () => {
    expect(plan(PLANTA_EMPLOYEES.CARLOS, "2026-11-06")?.kind).toBe("REST");
    const thursday = plan(PLANTA_EMPLOYEES.CARLOS, "2026-11-05");
    if (thursday?.kind !== "SHIFTS") throw new Error("esperaba SHIFTS");
    expect(thursday.blocks[0]).toMatchObject({ operationalDate: "2026-11-05", scheduledEndAt: art("2026-11-06", "03:00") });
  });

  it("José 06/11 (viernes A) → dos bloques independientes 07–11 y 19–07 (fin sábado 07:00), 960 min planificados", () => {
    const dayPlan = plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06");
    if (dayPlan?.kind !== "SHIFTS") throw new Error("esperaba SHIFTS");
    expect(dayPlan.blocks.map((block) => [block.blockIndex, block.scheduledStartAt, block.scheduledEndAt, block.durationMinutes])).toEqual([
      [0, art("2026-11-06", "07:00"), art("2026-11-06", "11:00"), 240],
      [1, art("2026-11-06", "19:00"), art("2026-11-07", "07:00"), 720],
    ]);
    expect(dayPlan.blocks.reduce((sum, block) => sum + block.durationMinutes, 0)).toBe(960);
    // Identidad estable por bloque, distinta entre ambos.
    expect(dayPlan.blocks.map((block) => block.obligationKey)).toEqual([
      `${PLANTA_EMPLOYEES.JOSE}|2026-11-06T10:00:00.000Z`,
      `${PLANTA_EMPLOYEES.JOSE}|2026-11-06T22:00:00.000Z`,
    ]);
    // 19:00 ART = 22:00 UTC: el bloque cruza la medianoche UTC y la de Argentina.
    expect(dayPlan.blocks[1]!.scheduledEndAt.toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });

  it("José 09/11 → descanso (la salida de las 07:00 es del domingo 08/11)", () => {
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-09")?.kind).toBe("REST");
    expect(summary(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-08"))).toBe("19-07");
  });

  it("Juanchi: 09/11 07–15; 13/11 sólo 19–07 (sin 03–11); 16/11 descanso tras el sereno del domingo", () => {
    expect(summary(plan(PLANTA_EMPLOYEES.JUANCHI, "2026-11-09"))).toBe("07-15");
    expect(summary(plan(PLANTA_EMPLOYEES.JUANCHI, "2026-11-13"))).toBe("19-07");
    expect(summary(plan(PLANTA_EMPLOYEES.JUANCHI, "2026-11-15"))).toBe("19-07");
    expect(plan(PLANTA_EMPLOYEES.JUANCHI, "2026-11-16")?.kind).toBe("REST");
  });

  it("Johanna: 07/11 descanso (A), 14/11 07–15 (B)", () => {
    expect(plan(PLANTA_EMPLOYEES.JOHANNA, "2026-11-07")?.kind).toBe("REST");
    expect(summary(plan(PLANTA_EMPLOYEES.JOHANNA, "2026-11-14"))).toBe("07-15");
  });

  it("cambio de semana sin editar nada: 29/11 (B) → 30/11 (A) y 06/12 (A) → 07/12 (B)", () => {
    expect([summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-29")), summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-30"))]).toEqual(["REST", "07-17"]);
    expect([summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-12-06")), summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-12-07"))]).toEqual(["07-19", "17-03"]);
  });

  it("Juanjo no es miembro de la rotación → null (rige su turno fijo legacy)", () => {
    expect(plan(PLANTA_EMPLOYEES.JUANJO, "2026-11-07")).toBeNull();
    expect(plan(PLANTA_EMPLOYEES.JUANJO, "2026-11-09")).toBeNull();
  });
});

describe("historia: membresías y versiones", () => {
  it("un cambio de equipo desde el 16/11 no altera lo planificado antes", () => {
    const configuration: RotationConfiguration = {
      rotations: [plantaRotation()],
      memberships: [
        { employeeId: PLANTA_EMPLOYEES.ROBERTO, rotationId: PLANTA_ROTATION_ID, crewId: PLANTA_CREWS.ROBERTO_ARIEL, effectiveFrom: PLANTA_ANCHOR, effectiveTo: "2026-11-15" },
        { employeeId: PLANTA_EMPLOYEES.ROBERTO, rotationId: PLANTA_ROTATION_ID, crewId: PLANTA_CREWS.CARLOS_WALTER, effectiveFrom: "2026-11-16", effectiveTo: null },
      ],
    };
    expect(summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-02", configuration))).toBe("07-17");
    expect(summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-15", configuration))).toBe("REST");
    expect(summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-16", configuration))).toBe("17-03");
  });

  it("una versión nueva desde el 30/11 (ciclo de 1 semana, todo descanso) no altera noviembre", () => {
    const allRest = plantaDays().filter((day) => day.cycleWeekIndex === 0).map((day) => ({ ...day, id: `v2-${day.id}`, kind: "REST" as const, blocks: [] }));
    const configuration: RotationConfiguration = {
      ...config,
      rotations: [plantaRotation({ versions: [plantaVersion({ effectiveTo: "2026-11-29" }), plantaVersion({ id: "ver-planta-2", cycleLengthWeeks: 1, anchorWeekStart: "2026-11-30", effectiveFrom: "2026-11-30", days: allRest })] })],
    };
    expect(summary(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-23", configuration))).toBe("17-03");
    expect(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-30", configuration)).toMatchObject({ kind: "REST", origin: { versionId: "ver-planta-2" } });
  });

  it("membresía terminada o rotación INACTIVA → null (deja de resolver; rige el legacy)", () => {
    const ended: RotationConfiguration = { ...config, memberships: config.memberships.map((item) => ({ ...item, effectiveTo: "2026-11-10" })) };
    expect(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-11", ended)).toBeNull();
    expect(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-01")).toBeNull(); // antes de la membresía
    expect(plan(PLANTA_EMPLOYEES.ROBERTO, "2026-11-02", { ...config, rotations: [plantaRotation({ status: "INACTIVO" })] })).toBeNull();
  });
});

describe("MISSING: configuración inexistente o incompleta (nunca descanso)", () => {
  const withVersion = (version: ReturnType<typeof plantaVersion>): RotationConfiguration => ({ ...config, rotations: [plantaRotation({ versions: [version] })] });
  const days = plantaDays();
  const joseFriday = (day: (typeof days)[number]) => day.crewId === PLANTA_CREWS.JOSE && day.cycleWeekIndex === 0 && day.weekday === 5;

  it("sin fila de día → NO_DAY_ROW", () => {
    const dayPlan = plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withVersion(plantaVersion({ days: days.filter((day) => !joseFriday(day)) })));
    expect(dayPlan).toMatchObject({ kind: "MISSING", reason: "NO_DAY_ROW", origin: { rotationId: PLANTA_ROTATION_ID, crewId: PLANTA_CREWS.JOSE, versionId: PLANTA_VERSION_ID, cycleWeekIndex: 0, weekday: 5 } });
  });

  it("día SHIFT sin bloques → SHIFT_DAY_WITHOUT_BLOCKS", () => {
    const dayPlan = plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withVersion(plantaVersion({ days: days.map((day) => (joseFriday(day) ? { ...day, blocks: [] } : day)) })));
    expect(dayPlan).toMatchObject({ kind: "MISSING", reason: "SHIFT_DAY_WITHOUT_BLOCKS" });
  });

  it("plantilla INACTIVA o con horario inválido → TEMPLATE_UNAVAILABLE", () => {
    const inactive: RotationTemplateRef = { ...PLANTA_TEMPLATES.T1907, status: "INACTIVO" };
    const invalid: RotationTemplateRef = { ...PLANTA_TEMPLATES.T1907, endTime: "25:00" };
    for (const broken of [inactive, invalid]) {
      const version = plantaVersion({ days: days.map((day) => (joseFriday(day) ? { ...day, blocks: [day.blocks[0]!, { blockIndex: 1, template: broken }] } : day)) });
      expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withVersion(version))).toMatchObject({ kind: "MISSING", reason: "TEMPLATE_UNAVAILABLE" });
    }
  });

  it("sin versión vigente, versión inválida, equipo inactivo o ajeno, rotación no cargada", () => {
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withVersion(plantaVersion({ effectiveFrom: "2026-12-01" })))).toMatchObject({ kind: "MISSING", reason: "NO_VERSION_IN_EFFECT" });
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withVersion(plantaVersion({ anchorWeekStart: "2026-11-03" })))).toMatchObject({ kind: "MISSING", reason: "INVALID_VERSION" });
    const crews = plantaRotation().crews;
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", { ...config, rotations: [plantaRotation({ crews: crews.map((crew) => (crew.id === PLANTA_CREWS.JOSE ? { ...crew, status: "INACTIVO" } : crew)) })] })).toMatchObject({ kind: "MISSING", reason: "CREW_INACTIVE" });
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", { ...config, rotations: [plantaRotation({ crews: crews.filter((crew) => crew.id !== PLANTA_CREWS.JOSE) })] })).toMatchObject({ kind: "MISSING", reason: "CREW_NOT_IN_ROTATION" });
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", { ...config, rotations: [] })).toMatchObject({ kind: "MISSING", reason: "ROTATION_NOT_FOUND" });
  });
});

describe("CONFLICT: configuración contradictoria — nunca se elige la primera", () => {
  const days = plantaDays();
  const joseFriday = (day: (typeof days)[number]) => day.crewId === PLANTA_CREWS.JOSE && day.cycleWeekIndex === 0 && day.weekday === 5;
  const withDays = (list: typeof days): RotationConfiguration => ({ ...config, rotations: [plantaRotation({ versions: [plantaVersion({ days: list })] })] });

  it("dos membresías vigentes (aun en rotaciones distintas) → MULTIPLE_MEMBERSHIPS con ambas en el detalle", () => {
    const configuration: RotationConfiguration = {
      ...config,
      memberships: [...config.memberships, { employeeId: PLANTA_EMPLOYEES.JOSE, rotationId: "rot-otra", crewId: "crew-otra", effectiveFrom: "2026-11-01", effectiveTo: "2026-11-30" }],
    };
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", configuration)).toEqual({
      kind: "CONFLICT",
      reason: "MULTIPLE_MEMBERSHIPS",
      detail: [`membership:${PLANTA_ROTATION_ID}/${PLANTA_CREWS.JOSE}[${PLANTA_ANCHOR}..∞]`, "membership:rot-otra/crew-otra[2026-11-01..2026-11-30]"],
      dateKey: "2026-11-06",
      employeeId: PLANTA_EMPLOYEES.JOSE,
      source: "ROTATION",
    });
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-12-01", configuration)?.kind).not.toBe("CONFLICT"); // fuera del solapamiento
  });

  it("dos versiones vigentes → MULTIPLE_VERSIONS", () => {
    const configuration: RotationConfiguration = { ...config, rotations: [plantaRotation({ versions: [plantaVersion(), plantaVersion({ id: "ver-solapada", effectiveFrom: "2026-11-05" })] })] };
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", configuration)).toMatchObject({ kind: "CONFLICT", reason: "MULTIPLE_VERSIONS", detail: [`version:${PLANTA_VERSION_ID}[${PLANTA_ANCHOR}..∞]`, "version:ver-solapada[2026-11-05..∞]"] });
  });

  it("día duplicado, REST con bloques, blockIndex repetido y bloques superpuestos", () => {
    const friday = days.find(joseFriday)!;
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withDays([...days, { ...friday, id: "day-dup", kind: "REST", blocks: [] }]))).toMatchObject({ kind: "CONFLICT", reason: "DUPLICATE_DAY_ROWS", detail: [`day:${friday.id}`, "day:day-dup"] });
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withDays(days.map((day) => (joseFriday(day) ? { ...day, kind: "REST" as const } : day))))).toMatchObject({ kind: "CONFLICT", reason: "REST_DAY_WITH_BLOCKS" });
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withDays(days.map((day) => (joseFriday(day) ? { ...day, blocks: day.blocks.map((block) => ({ ...block, blockIndex: 0 })) } : day))))).toMatchObject({ kind: "CONFLICT", reason: "DUPLICATE_BLOCK_INDEX", detail: [`block:${friday.id}#0`] });
    const overlapping = days.map((day) => (joseFriday(day) ? { ...day, blocks: [{ blockIndex: 0, template: PLANTA_TEMPLATES.T0715 }, { blockIndex: 1, template: PLANTA_TEMPLATES.T0711 }] } : day));
    expect(plan(PLANTA_EMPLOYEES.JOSE, "2026-11-06", withDays(overlapping))).toMatchObject({ kind: "CONFLICT", reason: "OVERLAPPING_BLOCKS", detail: [`block:${friday.id}#0`, `block:${friday.id}#1`] });
  });
});
