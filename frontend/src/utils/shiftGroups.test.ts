import { describe, expect, it } from "vitest";
import type { ShiftGroup, ShiftGroupSummary } from "../services/api/shiftGroupApiService";
import type { ShiftTemplate } from "../services/api/workforceApiService";
import { buildShiftGroupSections, matchesShiftGroupFilter, shiftGroupLabel, shiftGroupSelectOptions, UNGROUPED_FILTER } from "./shiftGroups";

const group = (id: string, name: string, sortOrder: number, status: "ACTIVO" | "INACTIVO" = "ACTIVO"): ShiftGroup => ({
  id,
  code: name.toUpperCase(),
  name,
  sortOrder,
  status,
  templateCount: 0,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
});
const summary = ({ id, code, name, sortOrder, status }: ShiftGroup): ShiftGroupSummary => ({ id, code, name, sortOrder, status });

function template(id: string, name: string, owner: ShiftGroup | null = null, categoryName: string | null = null): ShiftTemplate {
  return {
    id,
    code: id,
    name,
    categoryName,
    shiftGroupId: owner?.id ?? null,
    shiftGroup: owner ? summary(owner) : null,
    startTime: "07:00",
    endTime: "15:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 10,
    exitToleranceAfterMinutes: 10,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
  };
}

const OFICINA = group("g-of", "Oficina", 10);
const PLANTA = group("g-pl", "Planta", 20);
const GRANJA = group("g-gr", "Granja", 20);
const TALLER = group("g-ta", "Taller", 5, "INACTIVO");

// Las 15 plantillas reales de development, sin grupo (estado actual).
const DEVELOPMENT = ["01 Obra", "02Prueba", "Granja-01", "Granja-02", "Granja-03", "MA-01", "Oficina-01", "Oficina-02", "Planta-01", "Planta-02", "Prueba", "Sereno-01", "Sereno-02", "Taller-01", "Taller-02"].map((code) => template(code, code));

describe("buildShiftGroupSections", () => {
  it("0 grupos + 15 turnos: una única sección «Sin grupo» con todos, en el orden del catálogo", () => {
    const sections = buildShiftGroupSections(DEVELOPMENT, [], { includeEmptyGroups: true });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: UNGROUPED_FILTER, title: "Sin grupo", group: null, inactive: false });
    expect(sections[0]!.templates.map((item) => item.code)).toEqual(DEVELOPMENT.map((item) => item.code));
  });

  it("grupos activos por sortOrder y desempate por nombre; después «Sin grupo»; al final los inactivos", () => {
    const templates = [template("p1", "Planta 01", PLANTA), template("s1", "Sereno 01"), template("o1", "Oficina 01", OFICINA), template("g1", "Granja 01", GRANJA), template("t1", "Taller 01", TALLER), template("o2", "Oficina 02", OFICINA)];
    const sections = buildShiftGroupSections(templates, [PLANTA, TALLER, GRANJA, OFICINA], { includeEmptyGroups: true });
    expect(sections.map((section) => section.title)).toEqual(["Oficina", "Granja", "Planta", "Sin grupo", "Taller"]);
    expect(sections.find((section) => section.title === "Oficina")!.templates.map((item) => item.id)).toEqual(["o1", "o2"]);
    expect(sections.at(-1)).toMatchObject({ inactive: true });
  });

  it("grupos sin turnos: visibles sólo sin filtros; «Sin grupo» sólo si tiene turnos", () => {
    const templates = [template("o1", "Oficina 01", OFICINA)];
    expect(buildShiftGroupSections(templates, [OFICINA, PLANTA], { includeEmptyGroups: true }).map((section) => [section.title, section.templates.length])).toEqual([["Oficina", 1], ["Planta", 0]]);
    expect(buildShiftGroupSections(templates, [OFICINA, PLANTA], { includeEmptyGroups: false }).map((section) => section.title)).toEqual(["Oficina"]);
  });

  it("sin catálogo de grupos (error de carga): agrupa con el grupo que trae cada turno", () => {
    const templates = [template("p1", "Planta 01", PLANTA), template("s1", "Sereno 01"), template("o1", "Oficina 01", OFICINA)];
    expect(buildShiftGroupSections(templates, null, { includeEmptyGroups: false }).map((section) => section.title)).toEqual(["Oficina", "Planta", "Sin grupo"]);
  });

  it("un turno con grupo que ya no figura en el catálogo usa el grupo embebido (nunca se pierde)", () => {
    const sections = buildShiftGroupSections([template("p1", "Planta 01", PLANTA)], [OFICINA], { includeEmptyGroups: false });
    expect(sections.map((section) => section.title)).toEqual(["Planta"]);
  });
});

describe("filtro y etiquetas", () => {
  it("filtro por grupo, por «Sin grupo» o todos", () => {
    const withGroup = template("p1", "Planta 01", PLANTA);
    const without = template("s1", "Sereno 01");
    expect(matchesShiftGroupFilter(withGroup, "")).toBe(true);
    expect(matchesShiftGroupFilter(withGroup, PLANTA.id)).toBe(true);
    expect(matchesShiftGroupFilter(withGroup, UNGROUPED_FILTER)).toBe(false);
    expect(matchesShiftGroupFilter(without, UNGROUPED_FILTER)).toBe(true);
    expect(matchesShiftGroupFilter(without, PLANTA.id)).toBe(false);
  });

  it("etiqueta: nombre del grupo o «Sin grupo», nunca null ni id", () => {
    expect(shiftGroupLabel(summary(PLANTA))).toBe("Planta");
    expect(shiftGroupLabel(null)).toBe("Sin grupo");
    expect(shiftGroupLabel(undefined)).toBe("Sin grupo");
  });
});

describe("shiftGroupSelectOptions (selector del formulario)", () => {
  it("«Sin grupo» + grupos ACTIVOS ordenados; los inactivos no son destino", () => {
    expect(shiftGroupSelectOptions([PLANTA, TALLER, OFICINA], null)).toEqual([
      { value: "", label: "Sin grupo" },
      { value: OFICINA.id, label: "Oficina" },
      { value: PLANTA.id, label: "Planta" },
    ]);
  });

  it("el grupo inactivo actual se puede conservar y se marca", () => {
    expect(shiftGroupSelectOptions([PLANTA, TALLER], summary(TALLER)).at(-1)).toEqual({ value: TALLER.id, label: "Taller (inactivo)" });
  });

  it("sin catálogo: sólo conservar el actual o quitarlo", () => {
    expect(shiftGroupSelectOptions(null, summary(PLANTA))).toEqual([{ value: "", label: "Sin grupo" }, { value: PLANTA.id, label: "Planta" }]);
    expect(shiftGroupSelectOptions(null, null)).toEqual([{ value: "", label: "Sin grupo" }]);
  });
});
