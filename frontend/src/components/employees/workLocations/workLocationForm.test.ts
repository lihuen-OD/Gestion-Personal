import { describe, expect, it } from "vitest";
import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { EmployeeWorkLocation } from "../../../types/employeeWorkLocation.types";
import {
  assignmentPayload,
  correctionPayload,
  draftFrom,
  establishmentOptions,
  establishmentSummary,
  sortWorkLocations,
  unitOptions,
  workLocationDraftError,
  zoneOptions,
  zonePath,
} from "./workLocationForm";

const node = (id: string, name: string, status: "ACTIVO" | "INACTIVO" = "ACTIVO") => ({ id, code: id.toUpperCase(), name, status });
const catalog = {
  companies: [], businessUnits: [], sectors: [], areas: [], costCenters: [],
  provinces: [node("er", "Entre Ríos"), node("ba", "Buenos Aires")],
  zones: [{ ...node("north", "Zona Norte"), provinceId: "er" }, { ...node("south", "Zona Sur"), provinceId: "ba" }, node("closed", "Zona cerrada", "INACTIVO")],
  establishments: [
    { ...node("e1", "Campo La Esperanza"), zoneId: "north" },
    { ...node("e2", "Campo El Ombú"), zoneId: "north" },
    { ...node("e3", "Campo viejo", "INACTIVO"), zoneId: "north" },
    { ...node("e4", "Planta Sur"), zoneId: "south" },
    { ...node("e5", "Establecimiento anterior"), companyId: "c1", pendingReload: true },
    { ...node("su", "La Suiza"), zoneId: "north" },
  ],
  establishmentUnits: [
    { ...node("ls", "Lote Sur"), establishmentId: "su" },
    { ...node("ln", "Lote Norte"), establishmentId: "su" },
    { ...node("lc", "Lote Cerrado", "INACTIVO"), establishmentId: "su" },
    { ...node("gp", "Galpón"), establishmentId: "e1" },
  ],
} as unknown as OrgStructureCatalog;

const full = (id: string, name: string) => ({ ...node(id, name), coverage: "ESTABLISHMENT" as const, units: [] });
const location = (overrides: Partial<EmployeeWorkLocation> = {}): EmployeeWorkLocation => ({
  id: "loc-1",
  zone: { ...node("north", "Zona Norte"), province: { id: "er", name: "Entre Ríos" } },
  establishments: [full("e1", "Campo La Esperanza")],
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  state: "CURRENT",
  reason: "Asignación inicial",
  notes: null,
  createdAt: "2026-10-07T15:00:00.000Z",
  createdByName: "RRHH",
  ...overrides,
});

describe("opciones de zona y establecimientos", () => {
  it("sólo zonas activas, ordenadas por provincia; al corregir conserva la zona inactiva actual", () => {
    expect(zoneOptions(catalog).map((zone) => zone.id)).toEqual(["south", "north"]);
    expect(zoneOptions(catalog, "closed").map((zone) => zone.id)).toEqual(["south", "north", "closed"]);
  });

  it("sólo establecimientos activos de esa zona, nunca de otra zona ni de la estructura anterior", () => {
    expect(establishmentOptions(catalog, "north").map((item) => item.id)).toEqual(["e2", "e1", "su"]);
    expect(establishmentOptions(catalog, "north", new Set(["e3"])).map((item) => item.id)).toEqual(["e2", "e1", "e3", "su"]);
    expect(establishmentOptions(catalog, "south").map((item) => item.id)).toEqual(["e4"]);
  });

  it("unidades activas de ESE establecimiento; al corregir conserva una inactiva ya asignada", () => {
    expect(unitOptions(catalog, "su").map((item) => item.id)).toEqual(["ln", "ls"]);
    expect(unitOptions(catalog, "su", new Set(["lc"])).map((item) => item.id)).toEqual(["lc", "ln", "ls"]);
    expect(unitOptions(catalog, "e4")).toEqual([]);
  });
});

describe("ruta visible", () => {
  it("provincia › zona, o sólo la zona si todavía no tiene provincia", () => {
    expect(zonePath(location().zone)).toBe("Entre Ríos › Zona Norte");
    expect(zonePath({ ...node("closed", "Zona cerrada"), province: null })).toBe("Zona cerrada");
  });

  it("establecimiento completo o con sus unidades específicas", () => {
    expect(establishmentSummary(full("e4", "Oficina Central"))).toBe("Oficina Central");
    expect(establishmentSummary({ name: "La Suiza", coverage: "UNITS", units: [node("ln", "Lote Norte"), node("ls", "Lote Sur")] })).toBe("La Suiza (Lote Norte, Lote Sur)");
  });
});

describe("draftFrom", () => {
  it("cambio: precarga zona, establecimientos con su cobertura, y propone una fecha posterior al inicio", () => {
    expect(draftFrom("change", "2026-10-07", location())).toMatchObject({
      zoneId: "north", establishments: [{ establishmentId: "e1", coverage: "ESTABLISHMENT", unitIds: [] }], effectiveFrom: "2026-10-07",
    });
    expect(draftFrom("change", "2026-10-07", location({ effectiveFrom: "2026-12-01", state: "FUTURE" })).effectiveFrom).toBe("2026-12-02");
  });

  it("corrección: precarga el registro completo (incluidas las unidades) y deja el motivo de corrección vacío", () => {
    const withUnits = location({ effectiveTo: "2026-12-31", establishments: [{ ...node("su", "La Suiza"), coverage: "UNITS", units: [node("ln", "Lote Norte")] }] });
    expect(draftFrom("correct", "2026-10-07", withUnits)).toEqual({
      zoneId: "north", establishments: [{ establishmentId: "su", coverage: "UNITS", unitIds: ["ln"] }], effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", reason: "Asignación inicial", notes: "", correctionReason: "",
    });
  });
});

describe("workLocationDraftError", () => {
  const draft = { zoneId: "north", establishments: [{ establishmentId: "e1", coverage: "ESTABLISHMENT" as const, unitIds: [] }], effectiveFrom: "2026-10-01", effectiveTo: "", reason: "Cosecha", notes: "", correctionReason: "" };

  it("una zona sin establecimientos no se guarda (no existe zona completa)", () => {
    expect(workLocationDraftError("create", { ...draft, establishments: [] })).toContain("zona completa");
  });

  it("“Unidades específicas” sin ninguna unidad no se guarda: la selección vacía no significa “todas”", () => {
    expect(workLocationDraftError("create", { ...draft, establishments: [{ establishmentId: "su", coverage: "UNITS", unitIds: [] }] })).toContain("al menos una unidad");
    expect(workLocationDraftError("create", { ...draft, establishments: [{ establishmentId: "su", coverage: "UNITS", unitIds: ["ln"] }] })).toBe("");
  });

  it("valida intervalo, motivo y motivo de corrección", () => {
    expect(workLocationDraftError("create", draft)).toBe("");
    expect(workLocationDraftError("create", { ...draft, effectiveTo: "2026-09-30" })).toContain("no puede ser anterior");
    expect(workLocationDraftError("create", { ...draft, reason: " " })).toContain("motivo");
    expect(workLocationDraftError("correct", draft)).toContain("corrección");
    expect(workLocationDraftError("end", { ...draft, effectiveTo: "2026-09-30" })).toContain("anterior al inicio");
  });
});

describe("assignmentPayload", () => {
  it("envía la cobertura explícita y nunca unidades con establecimiento completo", () => {
    const payload = assignmentPayload({
      zoneId: "north",
      establishments: [{ establishmentId: "e1", coverage: "ESTABLISHMENT", unitIds: ["gp"] }, { establishmentId: "su", coverage: "UNITS", unitIds: ["ln", "ls"] }],
      effectiveFrom: "2026-10-01", effectiveTo: "", reason: " Campaña ", notes: "", correctionReason: "",
    });
    expect(payload).toEqual({
      zoneId: "north",
      establishments: [{ establishmentId: "e1", coverage: "ESTABLISHMENT", unitIds: [] }, { establishmentId: "su", coverage: "UNITS", unitIds: ["ln", "ls"] }],
      effectiveFrom: "2026-10-01", effectiveTo: null, reason: "Campaña", notes: null,
    });
  });
});

describe("correctionPayload", () => {
  it("envía sólo lo que cambió más el motivo de la corrección", () => {
    const current = location();
    const payload = correctionPayload(current, {
      ...draftFrom("correct", "2026-10-07", current),
      establishments: [{ establishmentId: "e1", coverage: "ESTABLISHMENT", unitIds: [] }, { establishmentId: "e2", coverage: "ESTABLISHMENT", unitIds: [] }],
      correctionReason: "Faltaba El Ombú",
    });
    expect(payload).toEqual({
      establishments: [{ establishmentId: "e1", coverage: "ESTABLISHMENT", unitIds: [] }, { establishmentId: "e2", coverage: "ESTABLISHMENT", unitIds: [] }],
      correctionReason: "Faltaba El Ombú",
    });
  });

  it("las mismas unidades en otro orden no son una corrección de establecimientos", () => {
    const current = location({ establishments: [{ ...node("su", "La Suiza"), coverage: "UNITS", units: [node("ln", "Lote Norte"), node("ls", "Lote Sur")] }] });
    const payload = correctionPayload(current, { ...draftFrom("correct", "2026-10-07", current), establishments: [{ establishmentId: "su", coverage: "UNITS", unitIds: ["ls", "ln"] }], notes: "Aclaración", correctionReason: "Nota" });
    expect(payload).toEqual({ notes: "Aclaración", correctionReason: "Nota" });
  });

  it("pasar de unidades específicas a establecimiento completo es una corrección de establecimientos", () => {
    const current = location({ establishments: [{ ...node("su", "La Suiza"), coverage: "UNITS", units: [node("ln", "Lote Norte")] }] });
    const payload = correctionPayload(current, { ...draftFrom("correct", "2026-10-07", current), establishments: [{ establishmentId: "su", coverage: "ESTABLISHMENT", unitIds: [] }], correctionReason: "Era todo el campo" });
    expect(payload).toEqual({ establishments: [{ establishmentId: "su", coverage: "ESTABLISHMENT", unitIds: [] }], correctionReason: "Era todo el campo" });
  });

  it("permite reabrir una vigencia (hasta → null)", () => {
    const current = location({ effectiveTo: "2026-12-31" });
    expect(correctionPayload(current, { ...draftFrom("correct", "2026-10-07", current), effectiveTo: "", correctionReason: "Fin cargado por error" })).toEqual({ effectiveTo: null, correctionReason: "Fin cargado por error" });
  });
});

describe("sortWorkLocations", () => {
  it("vigentes, futuras y finalizadas", () => {
    const rows = [location({ id: "ended", state: "ENDED" }), location({ id: "future", state: "FUTURE" }), location({ id: "current" })];
    expect(sortWorkLocations(rows).map((row) => row.id)).toEqual(["current", "future", "ended"]);
  });
});
