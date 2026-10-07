import { describe, expect, it } from "vitest";
import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { EmployeeWorkLocation } from "../../../types/employeeWorkLocation.types";
import { correctionPayload, draftFrom, establishmentOptions, sortWorkLocations, workLocationDraftError, zoneOptions } from "./workLocationForm";

const node = (id: string, name: string, status: "ACTIVO" | "INACTIVO" = "ACTIVO") => ({ id, code: id.toUpperCase(), name, status });
const catalog = {
  companies: [], businessUnits: [], sectors: [], areas: [], costCenters: [],
  zones: [node("north", "Zona Norte"), node("south", "Zona Sur"), node("closed", "Zona cerrada", "INACTIVO")],
  establishments: [
    { ...node("e1", "Campo La Esperanza"), zoneId: "north" },
    { ...node("e2", "Campo El Ombú"), zoneId: "north" },
    { ...node("e3", "Campo viejo", "INACTIVO"), zoneId: "north" },
    { ...node("e4", "Planta Sur"), zoneId: "south" },
    { ...node("e5", "Establecimiento anterior"), companyId: "c1", pendingReload: true },
  ],
} as unknown as OrgStructureCatalog;

const location = (overrides: Partial<EmployeeWorkLocation> = {}): EmployeeWorkLocation => ({
  id: "loc-1",
  zone: node("north", "Zona Norte"),
  establishments: [node("e1", "Campo La Esperanza")],
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
  it("sólo zonas activas; al corregir conserva la zona inactiva actual", () => {
    expect(zoneOptions(catalog).map((zone) => zone.id)).toEqual(["north", "south"]);
    expect(zoneOptions(catalog, "closed").map((zone) => zone.id)).toEqual(["closed", "north", "south"]);
  });

  it("sólo establecimientos activos de esa zona, nunca de otra zona ni de la estructura anterior", () => {
    expect(establishmentOptions(catalog, "north").map((item) => item.id)).toEqual(["e2", "e1"]);
    expect(establishmentOptions(catalog, "north", new Set(["e3"])).map((item) => item.id)).toEqual(["e2", "e1", "e3"]);
    expect(establishmentOptions(catalog, "south").map((item) => item.id)).toEqual(["e4"]);
  });
});

describe("draftFrom", () => {
  it("cambio: precarga zona y establecimientos, y propone una fecha posterior al inicio", () => {
    expect(draftFrom("change", "2026-10-07", location())).toMatchObject({ zoneId: "north", establishmentIds: ["e1"], effectiveFrom: "2026-10-07" });
    expect(draftFrom("change", "2026-10-07", location({ effectiveFrom: "2026-12-01", state: "FUTURE" })).effectiveFrom).toBe("2026-12-02");
  });

  it("corrección: precarga el registro completo y deja el motivo de corrección vacío", () => {
    expect(draftFrom("correct", "2026-10-07", location({ effectiveTo: "2026-12-31" }))).toEqual({
      zoneId: "north", establishmentIds: ["e1"], effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", reason: "Asignación inicial", notes: "", correctionReason: "",
    });
  });
});

describe("workLocationDraftError", () => {
  const draft = { zoneId: "north", establishmentIds: ["e1"], effectiveFrom: "2026-10-01", effectiveTo: "", reason: "Cosecha", notes: "", correctionReason: "" };

  it("una zona sin establecimientos no se guarda (no existe zona completa)", () => {
    expect(workLocationDraftError("create", { ...draft, establishmentIds: [] })).toContain("zona completa");
  });

  it("valida intervalo, motivo y motivo de corrección", () => {
    expect(workLocationDraftError("create", draft)).toBe("");
    expect(workLocationDraftError("create", { ...draft, effectiveTo: "2026-09-30" })).toContain("no puede ser anterior");
    expect(workLocationDraftError("create", { ...draft, reason: " " })).toContain("motivo");
    expect(workLocationDraftError("correct", draft)).toContain("corrección");
    expect(workLocationDraftError("end", { ...draft, effectiveTo: "2026-09-30" })).toContain("anterior al inicio");
  });
});

describe("correctionPayload", () => {
  it("envía sólo lo que cambió más el motivo de la corrección", () => {
    const current = location();
    const payload = correctionPayload(current, { ...draftFrom("correct", "2026-10-07", current), establishmentIds: ["e1", "e2"], correctionReason: "Faltaba El Ombú" });
    expect(payload).toEqual({ establishmentIds: ["e1", "e2"], correctionReason: "Faltaba El Ombú" });
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
