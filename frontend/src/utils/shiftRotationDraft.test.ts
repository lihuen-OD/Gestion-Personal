import { describe, expect, it } from "vitest";
import { ApiError } from "../services/api/apiClient";
import type { ShiftRotationCrew, ShiftRotationVersion, ShiftRotationVersionSummary } from "../services/api/shiftRotationApiService";
import type { ShiftTemplate } from "../services/api/workforceApiService";
import {
  addDaysKey,
  cellsBeyondCycle,
  describeDraftSaveError,
  draftCellKey,
  draftFromVersion,
  draftPayload,
  draftsEqual,
  eligibleTemplates,
  emptyDraft,
  isMondayKey,
  minimumNewVersionStart,
  missingDaysByCrew,
  mondayOnOrBefore,
  resizeDraftCycle,
  setDraftCell,
  shiftDaysWithoutBlocks,
} from "./shiftRotationDraft";

const DAY = { code: "P-0719", name: "Planta día", startTime: "07:00", endTime: "19:00" };
const NIGHT = { code: "P-1907", name: "Planta noche", startTime: "19:00", endTime: "07:00" };
const crew = (id: string, status: "ACTIVO" | "INACTIVO" = "ACTIVO"): ShiftRotationCrew => ({ id, code: id.toUpperCase(), name: `Equipo ${id.toUpperCase()}`, sortOrder: 0, status, openMemberCount: 0, everHadMembers: false });

const VERSION: Pick<ShiftRotationVersion, "days" | "cycleLengthWeeks" | "anchorWeekStart" | "effectiveFrom"> = {
  effectiveFrom: "2026-11-02",
  cycleLengthWeeks: 2,
  anchorWeekStart: "2026-11-02",
  days: [
    { id: "1", crewId: "a", crew: null, cycleWeekIndex: 0, weekLabel: "A", weekday: 5, weekdayName: null, kind: "SHIFT", blocks: [{ blockIndex: 1, shiftTemplateId: "t-day", template: DAY }, { blockIndex: 0, shiftTemplateId: "t-night", template: NIGHT }] },
    { id: "2", crewId: "a", crew: null, cycleWeekIndex: 1, weekday: 0, weekLabel: "B", weekdayName: null, kind: "REST", blocks: [] },
  ],
};

describe("borrador", () => {
  it("copia una versión respetando el orden de los bloques y permite cambiar la vigencia", () => {
    const draft = draftFromVersion(VERSION, { effectiveFrom: "2026-12-07" });
    expect(draft.effectiveFrom).toBe("2026-12-07");
    expect(draft.anchorWeekStart).toBe("2026-11-02");
    const friday = draft.cells[draftCellKey("a", 0, 5)];
    expect(friday?.kind === "SHIFT" && friday.blocks.map((block) => block.template.code)).toEqual(["P-1907", "P-0719"]);
  });

  it("arma el cuerpo del contrato: bloques numerados desde 0 y descansos sin bloques", () => {
    const payload = draftPayload(draftFromVersion(VERSION));
    expect(payload).toEqual({
      effectiveFrom: "2026-11-02",
      cycleLengthWeeks: 2,
      anchorWeekStart: "2026-11-02",
      days: [
        { crewId: "a", cycleWeekIndex: 0, weekday: 5, kind: "SHIFT", blocks: [{ blockIndex: 0, shiftTemplateId: "t-night" }, { blockIndex: 1, shiftTemplateId: "t-day" }] },
        { crewId: "a", cycleWeekIndex: 1, weekday: 0, kind: "REST", blocks: [] },
      ],
    });
  });

  it("edita y borra celdas sin mutar el borrador original", () => {
    const original = draftFromVersion(VERSION);
    const rest = setDraftCell(original, draftCellKey("a", 0, 5), { kind: "REST" });
    expect(original.cells[draftCellKey("a", 0, 5)]?.kind).toBe("SHIFT");
    expect(rest.cells[draftCellKey("a", 0, 5)]).toEqual({ kind: "REST" });
    expect(draftsEqual(original, rest)).toBe(false);
    const cleared = setDraftCell(rest, draftCellKey("a", 0, 5), null);
    expect(cleared.cells[draftCellKey("a", 0, 5)]).toBeUndefined();
  });

  it("al acortar el ciclo descarta las semanas sobrantes y avisa cuántos días se pierden", () => {
    const draft = draftFromVersion(VERSION);
    expect(cellsBeyondCycle(draft, 1)).toBe(1);
    const shorter = resizeDraftCycle(draft, 1);
    expect(shorter.cycleLengthWeeks).toBe(1);
    expect(Object.keys(shorter.cells)).toEqual([draftCellKey("a", 0, 5)]);
    expect(cellsBeyondCycle(draft, 3)).toBe(0);
  });

  it("cuenta días sin configurar sólo en equipos activos", () => {
    const draft = draftFromVersion(VERSION);
    expect(missingDaysByCrew(draft, [crew("a"), crew("b"), crew("x", "INACTIVO")]).map((entry) => [entry.crew.id, entry.count])).toEqual([["a", 12], ["b", 14]]);
  });

  it("detecta un día de trabajo sin turno elegido", () => {
    const draft = setDraftCell(emptyDraft("2026-12-07"), draftCellKey("a", 0, 1), { kind: "SHIFT", blocks: [{ shiftTemplateId: "", template: DAY }] });
    expect(shiftDaysWithoutBlocks(draft)).toBe(1);
  });
});

describe("fechas", () => {
  it("lunes y desplazamientos sin husos horarios", () => {
    expect(isMondayKey("2026-11-30")).toBe(true);
    expect(isMondayKey("2026-12-01")).toBe(false);
    expect(mondayOnOrBefore("2026-12-03")).toBe("2026-11-30");
    expect(mondayOnOrBefore("2026-11-30")).toBe("2026-11-30");
    expect(mondayOnOrBefore("2026-12-06")).toBe("2026-11-30");
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(emptyDraft("2026-12-03").anchorWeekStart).toBe("2026-11-30");
  });

  it("primer día válido de una versión nueva: hoy (inactiva) o mañana (activa), y después de la última versión", () => {
    const summary = (effectiveFrom: string) => ({ id: effectiveFrom, effectiveFrom } as ShiftRotationVersionSummary);
    expect(minimumNewVersionStart("INACTIVO", [], "2026-11-24")).toBe("2026-11-24");
    expect(minimumNewVersionStart("ACTIVO", [summary("2026-11-02")], "2026-11-24")).toBe("2026-11-25");
    expect(minimumNewVersionStart("ACTIVO", [summary("2026-11-02"), summary("2026-12-07")], "2026-11-24")).toBe("2026-12-08");
  });
});

describe("errores del guardado", () => {
  const crews = [crew("a"), crew("b")];

  it("grilla inválida (422): lista los problemas, resume los faltantes y ubica las celdas", () => {
    const error = new ApiError("La grilla tiene errores o está incompleta: cada equipo activo necesita los 7 días de cada semana del ciclo, sin superposiciones.", "ROTATION_GRID_INVALID", 422, {
      error: { code: "ROTATION_GRID_INVALID", details: { issues: [
        { code: "BLOCKS_OVERLAP", severity: "ERROR", crewId: "a", cycleWeekIndex: 0, weekday: 5, message: "en el viernes de la semana A el bloque P-1907 se superpone con el bloque P-0719." },
        { code: "DAY_MISSING", severity: "WARNING", crewId: "b", cycleWeekIndex: 0, weekday: 1, message: "Falta" },
      ] } },
    });
    const result = describeDraftSaveError(error, crews);
    expect(result.message).toMatch(/^La grilla tiene errores/);
    expect(result.details).toEqual(["En el viernes de la semana A el bloque P-1907 se superpone con el bloque P-0719.", "Equipo B (equipo B): 1 día sin configurar."]);
    expect(result.cellIssues).toHaveLength(2);
    expect(result.stale).toBe(false);
  });

  it("superposición en el cambio de versión (409): nombra a la persona y los turnos", () => {
    const error = new ApiError("El cambio de versión del 07/12/2026 superpone el último turno de la versión anterior con el primero de la nueva.", "ROTATION_TRANSITION_OVERLAP", 409, {
      error: { code: "ROTATION_TRANSITION_OVERLAP", details: { overlaps: [{ employeeId: "e1", employee: "Pérez, Ana · Legajo 19", outgoing: "P-1907 19:00–07:00 del 2026-12-06", incoming: "P-0719 07:00–19:00 del 2026-12-07" }] } },
    });
    expect(describeDraftSaveError(error, crews).details).toEqual(["Pérez, Ana · Legajo 19: P-1907 19:00–07:00 del 06/12/2026 se superpone con P-0719 07:00–19:00 del 07/12/2026."]);
  });

  it("versión modificada por otra persona: marca el conflicto", () => {
    const error = new ApiError("Otra persona modificó esta versión mientras la editabas. Recargala y volvé a aplicar tus cambios.", "ROTATION_VERSION_STALE", 409, { error: { code: "ROTATION_VERSION_STALE" } });
    expect(describeDraftSaveError(error, crews)).toMatchObject({ stale: true, details: [], cellIssues: [] });
  });

  it("un error inesperado conserva un mensaje claro, sin detalles técnicos", () => {
    expect(describeDraftSaveError(new Error("socket hang up"), crews).message).toBe("No pudimos guardar la versión. Tus cambios siguen en pantalla.");
  });
});

describe("turnos elegibles", () => {
  it("sólo activos del grupo de la rotación, ordenados por horario", () => {
    const template = (id: string, status: string, shiftGroupId: string | null, startTime: string) => ({ id, code: id, name: id, status, shiftGroupId, startTime, endTime: "07:00" }) as ShiftTemplate;
    expect(eligibleTemplates([template("night", "ACTIVO", "g", "19:00"), template("off", "INACTIVO", "g", "08:00"), template("other", "ACTIVO", "h", "06:00"), template("none", "ACTIVO", null, "05:00"), template("day", "ACTIVO", "g", "07:00")], "g").map((item) => item.id)).toEqual(["day", "night"]);
  });
});
