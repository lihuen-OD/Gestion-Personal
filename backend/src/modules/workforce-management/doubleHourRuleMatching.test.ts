import { describe, expect, it } from "vitest";
import { buildActiveDatesByRule, resolveWinningRules, ruleMatchesDate, scopesCouldOverlap } from "./doubleHourRuleMatching";

describe("ruleMatchesDate", () => {
  const sunday = new Date("2026-08-16T00:00:00.000Z"); // domingo
  const monday = new Date("2026-08-17T00:00:00.000Z"); // lunes

  it("SEMANAL matchea sólo el weekday configurado, dentro de vigencia", () => {
    const rule = { id: "r1", recurrenceType: "SEMANAL" as const, fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0] };
    expect(ruleMatchesDate(rule, sunday, new Map())).toBe(true);
    expect(ruleMatchesDate(rule, monday, new Map())).toBe(false);
  });

  it("SEMANAL no matchea antes de fromDate ni después de toDate", () => {
    const rule = { id: "r1", recurrenceType: "SEMANAL" as const, fromDate: new Date("2026-09-01"), toDate: null, weekdays: [0] };
    expect(ruleMatchesDate(rule, sunday, new Map())).toBe(false);
  });

  it("RANGO matchea cualquier día dentro del rango, sin filtrar por weekday", () => {
    const rule = { id: "r1", recurrenceType: "RANGO" as const, fromDate: new Date("2026-08-15"), toDate: new Date("2026-08-18"), weekdays: [] };
    expect(ruleMatchesDate(rule, sunday, new Map())).toBe(true);
    expect(ruleMatchesDate(rule, monday, new Map())).toBe(true);
    expect(ruleMatchesDate(rule, new Date("2026-08-20"), new Map())).toBe(false);
  });

  it("FECHA matchea sólo fechas explícitas activas en activeDatesByRule, ignora fromDate/toDate", () => {
    const rule = { id: "r1", recurrenceType: "FECHA" as const, fromDate: new Date("1900-01-01"), toDate: null, weekdays: [] };
    const activeDates = new Map([["r1", new Set(["2026-08-16"])]]);
    expect(ruleMatchesDate(rule, sunday, activeDates)).toBe(true);
    expect(ruleMatchesDate(rule, monday, activeDates)).toBe(false);
  });

  it("FECHA no matchea una fecha inactiva (isActive=false ya excluida por buildActiveDatesByRule)", () => {
    const rule = { id: "r1", recurrenceType: "FECHA" as const, fromDate: new Date("1900-01-01"), toDate: null, weekdays: [] };
    const activeDates = buildActiveDatesByRule([{ id: "r1", dates: [{ date: sunday, isActive: false }] }]);
    expect(ruleMatchesDate(rule, sunday, activeDates)).toBe(false);
  });

  it("buildActiveDatesByRule agrupa varias fechas de una misma regla FECHA (ej. feriados del año)", () => {
    const navidad = new Date("2026-12-25");
    const anioNuevo = new Date("2027-01-01");
    const rule = { id: "feriados", recurrenceType: "FECHA" as const, fromDate: new Date("1900-01-01"), toDate: null, weekdays: [] };
    const activeDates = buildActiveDatesByRule([{ id: "feriados", dates: [{ date: navidad, isActive: true }, { date: anioNuevo, isActive: true }] }]);
    expect(ruleMatchesDate(rule, navidad, activeDates)).toBe(true);
    expect(ruleMatchesDate(rule, anioNuevo, activeDates)).toBe(true);
    expect(ruleMatchesDate(rule, sunday, activeDates)).toBe(false);
  });
});

describe("Etapa 12B — el motor de matching/prioridad ignora `kind` (clasificación estructurada)", () => {
  const sunday = new Date("2026-08-16T00:00:00.000Z");

  it("ruleMatchesDate matchea igual sin importar el kind de la regla — la función ni siquiera lo lee", () => {
    const feriado = { id: "r1", recurrenceType: "SEMANAL" as const, fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], kind: "FERIADO" as const };
    const otro = { id: "r2", recurrenceType: "SEMANAL" as const, fromDate: new Date("2026-01-01"), toDate: null, weekdays: [0], kind: "OTRO" as const };
    expect(ruleMatchesDate(feriado, sunday, new Map())).toBe(ruleMatchesDate(otro, sunday, new Map()));
    expect(ruleMatchesDate(feriado, sunday, new Map())).toBe(true);
  });

  it("resolveWinningRules resuelve prioridad/multiplicador igual sin importar el kind — una regla 'Pedro' clasificada FERIADO liquida exactamente igual que si fuera OTRO", () => {
    const pedroComoFeriado = { priority: 2, multiplier: 2, kind: "FERIADO" as const };
    const pedroComoOtro = { priority: 2, multiplier: 2, kind: "OTRO" as const };
    const resultFeriado = resolveWinningRules([pedroComoFeriado]);
    const resultOtro = resolveWinningRules([pedroComoOtro]);
    expect(resultFeriado.multiplier).toBe(resultOtro.multiplier);
    expect(resultFeriado.conflicting).toBe(resultOtro.conflicting);
    expect(resultFeriado.winners).toHaveLength(resultOtro.winners.length);
  });
});

describe("resolveWinningRules", () => {
  it("sin reglas: multiplicador 1, sin ganadoras, sin conflicto", () => {
    expect(resolveWinningRules([])).toEqual({ winners: [], multiplier: 1, conflicting: false });
  });

  it("una sola regla: gana ella, sin conflicto", () => {
    const rule = { priority: 0, multiplier: 2 };
    expect(resolveWinningRules([rule])).toEqual({ winners: [rule], multiplier: 2, conflicting: false });
  });

  it("prioridad distinta: gana la de mayor prioridad, sin importar su multiplicador", () => {
    const domingo = { priority: 1, multiplier: 2 };
    const domingoPanol = { priority: 5, multiplier: 2.5 };
    const result = resolveWinningRules([domingo, domingoPanol]);
    expect(result.winners).toEqual([domingoPanol]);
    expect(result.multiplier).toBe(2.5);
    expect(result.conflicting).toBe(false);
  });

  it("empate de prioridad: ambas quedan como ganadoras, conflicting=true, multiplicador = el mayor entre las empatadas", () => {
    const domingo = { priority: 3, multiplier: 2 };
    const feriado = { priority: 3, multiplier: 2 };
    const result = resolveWinningRules([domingo, feriado]);
    expect(result.winners).toEqual([domingo, feriado]);
    expect(result.multiplier).toBe(2);
    expect(result.conflicting).toBe(true);
  });

  it("tres reglas, dos empatan en la mayor prioridad: sólo esas dos son ganadoras/conflicto, la de menor prioridad queda fuera", () => {
    const baja = { priority: 0, multiplier: 5 }; // multiplicador alto pero prioridad baja: no debe ganar
    const domingo = { priority: 2, multiplier: 2 };
    const feriado = { priority: 2, multiplier: 3 };
    const result = resolveWinningRules([baja, domingo, feriado]);
    expect(result.winners).toEqual([domingo, feriado]);
    expect(result.multiplier).toBe(3);
    expect(result.conflicting).toBe(true);
  });
});

describe("scopesCouldOverlap", () => {
  const general: import("./doubleHourRuleMatching").ScopeShape = { companyId: null, sectorId: null, costCenterId: null, positionId: null, employeeIds: [] };

  it("dos reglas generales (sin ningún filtro) siempre podrían superponerse", () => {
    expect(scopesCouldOverlap(general, general)).toBe(true);
  });

  it("general vs. limitada por empresa: podrían superponerse (la general no restringe esa dimensión)", () => {
    const odwyer = { ...general, companyId: "odwyer" };
    expect(scopesCouldOverlap(general, odwyer)).toBe(true);
  });

  it("dos empresas distintas configuradas: mutuamente excluyentes", () => {
    const odwyer = { ...general, companyId: "odwyer" };
    const tropa = { ...general, companyId: "tropa" };
    expect(scopesCouldOverlap(odwyer, tropa)).toBe(false);
  });

  it("misma empresa, sectores distintos: mutuamente excluyentes", () => {
    const panol = { ...general, companyId: "odwyer", sectorId: "panol" };
    const otroSector = { ...general, companyId: "odwyer", sectorId: "otro" };
    expect(scopesCouldOverlap(panol, otroSector)).toBe(false);
  });

  it("misma empresa, uno sin sector configurado: podrían superponerse", () => {
    const odwyer = { ...general, companyId: "odwyer" };
    const panol = { ...general, companyId: "odwyer", sectorId: "panol" };
    expect(scopesCouldOverlap(odwyer, panol)).toBe(true);
  });

  it("ambas con empleados específicos disjuntos: mutuamente excluyentes", () => {
    const a = { ...general, employeeIds: ["juan", "pedro"] };
    const b = { ...general, employeeIds: ["carlos"] };
    expect(scopesCouldOverlap(a, b)).toBe(false);
  });

  it("ambas con empleados específicos y algún empleado en común: podrían superponerse", () => {
    const a = { ...general, employeeIds: ["juan", "pedro"] };
    const b = { ...general, employeeIds: ["pedro", "carlos"] };
    expect(scopesCouldOverlap(a, b)).toBe(true);
  });
});
