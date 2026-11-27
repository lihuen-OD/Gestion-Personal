import { describe, expect, it } from "vitest";
import { emptyNoveltyType } from "../components/novelty-types/NoveltyTypeFields";
import type { NoveltyType, NoveltyTypeCoverage } from "../types/noveltyType.types";
import {
  applyCoverageDayRule,
  canonicalCoverage,
  defaultNoveltyTypeCoverage,
  applyCoverageMode,
  coverageConfigChanged,
  describeNoveltyTypeConfig,
  noveltyTypeIssues,
  toggleCoverageWeekday,
} from "./noveltyTypeCoverage";

function build(coverage: Partial<NoveltyTypeCoverage> = {}, rules: Partial<NoveltyType["rules"]> = {}): NoveltyType {
  const base = emptyNoveltyType();
  return { ...base, name: "Tipo", description: "Descripción", rules: { ...base.rules, ...rules }, coverage: { ...base.coverage, ...coverage } };
}

const issueFields = (item: NoveltyType) => noveltyTypeIssues(item).map((issue) => issue.field);

describe("applyCoverageMode — transiciones coherentes con el backend", () => {
  it("NONE limpia cantidad, días, políticas, multiplicadores y suma, pero conserva la compatibilidad", () => {
    const item = build({ mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "SELECTED_WEEKDAYS", weekdays: [1, 2], onDayOff: "COVER", onHoliday: "COVER", appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    expect(applyCoverageMode(item, "NONE").coverage).toEqual({
      mode: "NONE", fixedMinutes: null, dayRule: "EVERY_DAY", weekdays: [], onDayOff: null, onHoliday: null,
      appliesSpecialHours: false, countsTowardTotal: false, realWorkCompatibility: "INCOMPATIBLE",
    });
  });

  it("MANUAL_MINUTES fuerza un único día con cantidad de horas y sin reglas de días", () => {
    const next = applyCoverageMode(build({ mode: "FIXED_MINUTES", fixedMinutes: 240, dayRule: "WORK_OBLIGATION" }, { allowsDateRange: true, allowsHours: false }), "MANUAL_MINUTES");
    expect(next.rules).toMatchObject({ allowsDateRange: false, allowsHours: true });
    expect(next.coverage).toMatchObject({ fixedMinutes: null, dayRule: "EVERY_DAY", weekdays: [], onDayOff: null, onHoliday: null });
  });

  it("salir de MANUAL_MINUTES desactiva la cantidad de horas que ese modo había impuesto", () => {
    const manual = applyCoverageMode(build(), "MANUAL_MINUTES");
    expect(applyCoverageMode(manual, "FIXED_MINUTES").rules.allowsHours).toBe(false);
  });

  it("EXPECTED_SCHEDULE sólo existe con días de obligación laboral", () => {
    const next = applyCoverageMode(build({ mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "EVERY_DAY", onDayOff: "COVER", onHoliday: "COVER" }), "EXPECTED_SCHEDULE");
    expect(next.coverage).toMatchObject({ mode: "EXPECTED_SCHEDULE", fixedMinutes: null, dayRule: "WORK_OBLIGATION", onDayOff: null, onHoliday: null });
  });

  it("FIXED_MINUTES desde NONE arranca sin cantidad ni políticas (nunca inventa un default)", () => {
    const next = applyCoverageMode(build(), "FIXED_MINUTES");
    expect(next.coverage).toMatchObject({ fixedMinutes: null, dayRule: "EVERY_DAY", onDayOff: null, onHoliday: null });
    expect(issueFields(next)).toEqual(["fixedMinutes", "onDayOff", "onHoliday"]);
  });

  it("FIXED_MINUTES desde la jornada esperada conserva la regla de obligación laboral", () => {
    const next = applyCoverageMode(build({ mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION", appliesSpecialHours: true }), "FIXED_MINUTES");
    expect(next.coverage).toMatchObject({ dayRule: "WORK_OBLIGATION", fixedMinutes: null, appliesSpecialHours: true });
  });
});

describe("reglas de días", () => {
  it("WORK_OBLIGATION borra días elegidos y políticas de franco/feriado", () => {
    const item = build({ mode: "FIXED_MINUTES", fixedMinutes: 60, dayRule: "SELECTED_WEEKDAYS", weekdays: [1], onDayOff: "COVER", onHoliday: "ONLY_IF_CONVOKED" });
    expect(applyCoverageDayRule(item, "WORK_OBLIGATION").coverage).toMatchObject({ weekdays: [], onDayOff: null, onHoliday: null });
  });

  it("los días se guardan ordenados como los normaliza el backend (0 = domingo)", () => {
    let item = build({ mode: "FIXED_MINUTES", dayRule: "SELECTED_WEEKDAYS" });
    for (const day of [5, 0, 1]) item = toggleCoverageWeekday(item, day);
    expect(item.coverage.weekdays).toEqual([0, 1, 5]);
    expect(toggleCoverageWeekday(item, 0).coverage.weekdays).toEqual([1, 5]);
  });

  it("SELECTED_WEEKDAYS sin días se marca antes de enviar", () => {
    expect(issueFields(build({ mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "SELECTED_WEEKDAYS", onDayOff: "COVER", onHoliday: "COVER" }))).toEqual(["weekdays"]);
  });
});

describe("noveltyTypeIssues", () => {
  it("una cantidad fija fuera de 1..1440 minutos es inválida", () => {
    expect(issueFields(build({ mode: "FIXED_MINUTES", fixedMinutes: 0, dayRule: "WORK_OBLIGATION" }))).toEqual(["fixedMinutes"]);
    expect(issueFields(build({ mode: "FIXED_MINUTES", fixedMinutes: 1440, dayRule: "WORK_OBLIGATION" }))).toEqual([]);
  });

  it("no exige políticas de franco/feriado cuando no aplican", () => {
    expect(issueFields(build({ mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION" }))).toEqual([]);
    expect(issueFields(build({ mode: "NONE" }))).toEqual([]);
  });

  it("horas al cargar + Valor 1 en días es una combinación inviable", () => {
    expect(issueFields(build({}, { allowsHours: true, finnegansValueUnit: "DAYS" }))).toEqual(["finnegansValueUnit"]);
  });
});

describe("describeNoveltyTypeConfig — resumen generado sólo desde la configuración", () => {
  it("Vacaciones (jornada esperada) se describe sin depender del nombre", () => {
    const item = { ...build({ mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION", appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" }, { allowsDateRange: true }), name: "Cualquier nombre" };
    expect(describeNoveltyTypeConfig(item)).toEqual([
      "Cubre las horas que la persona debía trabajar cada día.",
      "Sólo cuenta en días con obligación laboral: los francos quedan en 0 h y los feriados cuentan sólo si la persona fue convocada.",
      "Aplica reglas de domingos, feriados y Horas Especiales para liquidación.",
      "Suma al total computable.",
      "No puede coexistir con horas trabajadas: si hay trabajo real ese día, queda para revisión.",
      "Puede cargarse por rango de fechas.",
    ]);
  });

  it("Maternidad (cantidad fija lunes a viernes) muestra días y políticas elegidas", () => {
    const lines = describeNoveltyTypeConfig(build({ mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "SELECTED_WEEKDAYS", weekdays: [1, 2, 3, 4, 5], onDayOff: "COVER", onHoliday: "ONLY_IF_CONVOKED", countsTowardTotal: true }));
    expect(lines).toContain("Cubre 8 h por día.");
    expect(lines).toContain("Cuenta sólo: lunes, martes, miércoles, jueves, viernes.");
    expect(lines).toContain("Si es feriado: cuenta sólo si la persona estaba convocada a trabajar.");
    expect(lines).toContain("No aplica multiplicadores de domingos, feriados ni Horas Especiales.");
  });

  it("una novedad que no registra horas no habla de totales ni multiplicadores", () => {
    const lines = describeNoveltyTypeConfig(build({ mode: "NONE" }));
    expect(lines[0]).toBe("No registra horas: sólo deja constancia de la situación.");
    expect(lines.some((line) => line.includes("total computable") || line.includes("multiplicadores"))).toBe(false);
  });
});

describe("coverageConfigChanged", () => {
  it("detecta sólo cambios en lo que la novedad cubre", () => {
    const item = build({ mode: "FIXED_MINUTES", fixedMinutes: 240 });
    expect(coverageConfigChanged(item.coverage, { ...item.coverage })).toBe(false);
    expect(coverageConfigChanged(item.coverage, { ...item.coverage, fixedMinutes: 300 })).toBe(true);
  });
});

describe("limpieza al cambiar de modo — nada sobrevive oculto", () => {
  it("FIXED_MINUTES → NONE deja todo en su valor canónico", () => {
    const fixed = build({ mode: "FIXED_MINUTES", fixedMinutes: 240, dayRule: "SELECTED_WEEKDAYS", weekdays: [1, 3], onDayOff: "COVER", onHoliday: "ONLY_IF_CONVOKED", appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    const none = applyCoverageMode(fixed, "NONE");
    expect(none.coverage).toEqual({ mode: "NONE", fixedMinutes: null, dayRule: "EVERY_DAY", weekdays: [], onDayOff: null, onHoliday: null, appliesSpecialHours: false, countsTowardTotal: false, realWorkCompatibility: "INCOMPATIBLE" });
    expect(canonicalCoverage(none.coverage)).toEqual(none.coverage);
  });

  it("EXPECTED_SCHEDULE → MANUAL_MINUTES: un día, sin regla de obligación ni cantidad fija", () => {
    const expected = build({ mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION", appliesSpecialHours: true, countsTowardTotal: true }, { allowsDateRange: true });
    const manual = applyCoverageMode(expected, "MANUAL_MINUTES");
    expect(manual.coverage).toEqual({ mode: "MANUAL_MINUTES", fixedMinutes: null, dayRule: "EVERY_DAY", weekdays: [], onDayOff: null, onHoliday: null, appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "COMPATIBLE" });
    expect(manual.rules).toMatchObject({ allowsDateRange: false, allowsHours: true });
    // Multiplicadores y suma siguen visibles y válidos para una cantidad indicada al cargar.
    expect(canonicalCoverage(manual.coverage)).toEqual(manual.coverage);
  });

  it("SELECTED_WEEKDAYS → EVERY_DAY borra los días; FIXED → jornada borra la cantidad y las políticas", () => {
    const weekdays = build({ mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "SELECTED_WEEKDAYS", weekdays: [1, 2], onDayOff: "COVER", onHoliday: "COVER" });
    expect(applyCoverageDayRule(weekdays, "EVERY_DAY").coverage).toMatchObject({ weekdays: [], onDayOff: "COVER", onHoliday: "COVER" });
    expect(applyCoverageMode(weekdays, "EXPECTED_SCHEDULE").coverage).toMatchObject({ fixedMinutes: null, dayRule: "WORK_OBLIGATION", weekdays: [], onDayOff: null, onHoliday: null });
  });

  it("canonicalCoverage descarta valores que el modo no usa aunque hayan quedado en memoria", () => {
    expect(canonicalCoverage({ mode: "EXPECTED_SCHEDULE", fixedMinutes: 480, dayRule: "EVERY_DAY", weekdays: [2], onDayOff: "COVER", onHoliday: "COVER", appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" }))
      .toEqual({ mode: "EXPECTED_SCHEDULE", fixedMinutes: null, dayRule: "WORK_OBLIGATION", weekdays: [], onDayOff: null, onHoliday: null, appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" });
    expect(canonicalCoverage({ ...defaultNoveltyTypeCoverage(), mode: "FIXED_MINUTES", fixedMinutes: 60, dayRule: "WORK_OBLIGATION", onDayOff: "COVER", onHoliday: "COVER" }))
      .toMatchObject({ onDayOff: null, onHoliday: null });
  });
});

describe("casos representativos — sólo configuración, nunca el nombre", () => {
  const configure = (steps: (item: NoveltyType) => NoveltyType) => steps(build());
  const cases: { name: string; item: NoveltyType; coverage: NoveltyTypeCoverage; allowsDateRange: boolean }[] = [
    {
      name: "Trámite bancario",
      item: configure((item) => ({ ...applyCoverageMode(item, "FIXED_MINUTES"), rules: { ...item.rules, allowsDateRange: false } })),
      coverage: { mode: "FIXED_MINUTES", fixedMinutes: 240, dayRule: "EVERY_DAY", weekdays: [], onDayOff: "NO_COVERAGE", onHoliday: "NO_COVERAGE", appliesSpecialHours: false, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
      allowsDateRange: false,
    },
    {
      name: "Vacaciones",
      item: configure((item) => applyCoverageMode(item, "EXPECTED_SCHEDULE")),
      coverage: { mode: "EXPECTED_SCHEDULE", fixedMinutes: null, dayRule: "WORK_OBLIGATION", weekdays: [], onDayOff: null, onHoliday: null, appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
      allowsDateRange: true,
    },
    {
      name: "Maternidad",
      item: configure((item) => [1, 2, 3, 4, 5].reduce(toggleCoverageWeekday, applyCoverageDayRule(applyCoverageMode(item, "FIXED_MINUTES"), "SELECTED_WEEKDAYS"))),
      coverage: { mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "SELECTED_WEEKDAYS", weekdays: [1, 2, 3, 4, 5], onDayOff: "COVER", onHoliday: "NO_COVERAGE", appliesSpecialHours: false, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
      allowsDateRange: true,
    },
    {
      name: "Llegada tarde",
      item: configure((item) => applyCoverageMode(item, "MANUAL_MINUTES")),
      coverage: { mode: "MANUAL_MINUTES", fixedMinutes: null, dayRule: "EVERY_DAY", weekdays: [], onDayOff: null, onHoliday: null, appliesSpecialHours: false, countsTowardTotal: false, realWorkCompatibility: "COMPATIBLE" },
      allowsDateRange: false,
    },
    {
      name: "Falta sin aviso",
      item: configure((item) => applyCoverageMode(item, "NONE")),
      coverage: { mode: "NONE", fixedMinutes: null, dayRule: "EVERY_DAY", weekdays: [], onDayOff: null, onHoliday: null, appliesSpecialHours: false, countsTowardTotal: false, realWorkCompatibility: "INCOMPATIBLE" },
      allowsDateRange: true,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}: se completa con preguntas visibles y queda en forma canónica`, () => {
      // Las respuestas que la persona elige en pantalla (cantidad, políticas, impacto).
      const { mode, dayRule, weekdays, ...answers } = testCase.coverage;
      const item = { ...testCase.item, name: testCase.name, coverage: { ...testCase.item.coverage, ...answers } };
      expect({ mode: item.coverage.mode, dayRule: item.coverage.dayRule, weekdays: item.coverage.weekdays }).toEqual({ mode, dayRule, weekdays });
      expect(noveltyTypeIssues(item)).toEqual([]);
      expect(canonicalCoverage(item.coverage)).toEqual(testCase.coverage);
      expect(item.rules.allowsDateRange).toBe(testCase.allowsDateRange);
      // El mismo tipo con otro nombre produce exactamente el mismo resumen.
      expect(describeNoveltyTypeConfig({ ...item, name: "Otro nombre", code: "X" })).toEqual(describeNoveltyTypeConfig(item));
    });
  }

  it("la Maternidad admite cualquiera de las tres políticas de feriado (P1 sigue abierta)", () => {
    const maternity = cases[2];
    for (const onHoliday of ["NO_COVERAGE", "COVER", "ONLY_IF_CONVOKED"] as const) {
      expect(noveltyTypeIssues({ ...maternity.item, coverage: { ...maternity.coverage, onHoliday } })).toEqual([]);
    }
  });
});
