import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { roles } from "../../shared/security/roles";
import { employeeWorkLocationsRepository } from "./employeeWorkLocations.repository";
import { employeeWorkLocationsService } from "./employeeWorkLocations.service";

/**
 * A6 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §3.3): ubicaciones de
 * trabajo con vigencia. Alta, cambio con nueva vigencia (cierre en D − 1),
 * finalización y corrección; filas, historial visible y auditoría dentro de
 * la misma transacción.
 */
vi.mock("./employeeWorkLocations.repository", () => ({
  employeeWorkLocationsRepository: {
    transaction: vi.fn(),
    findEmployeeReference: vi.fn(),
    findByEmployee: vi.fn(),
    findZone: vi.fn(),
    findEstablishments: vi.fn(),
    findUnits: vi.fn(),
    createWithin: vi.fn(),
    closeWithin: vi.fn(),
    correctWithin: vi.fn(),
    createBlockHistoryWithin: vi.fn(),
    findOpenByNodesWithin: vi.fn(),
    cancelWithin: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));

const repo = employeeWorkLocationsRepository as unknown as Record<keyof typeof employeeWorkLocationsRepository, Mock>;
const registerWithin = auditService.registerWithin as unknown as Mock;
const clearCaches = clearAuditDerivedCaches as unknown as Mock;

const ZONE_NORTH = "11111111-1111-4111-8111-111111111111";
const ZONE_SOUTH = "22222222-2222-4222-8222-222222222222";
const EST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EST_S = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const zones: Record<string, { id: string; name: string; status: string }> = {
  [ZONE_NORTH]: { id: ZONE_NORTH, name: "Zona Norte", status: "ACTIVO" },
  [ZONE_SOUTH]: { id: ZONE_SOUTH, name: "Zona Sur", status: "ACTIVO" },
};
const EST_SU = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNIT_N = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const UNIT_S = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const UNIT_X = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const UNIT_OLD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04";
const UNIT_OFF = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05";
const establishments = [
  { id: EST_A, name: "Campo La Esperanza", status: "ACTIVO", zoneId: ZONE_NORTH },
  { id: EST_B, name: "Campo El Ombú", status: "ACTIVO", zoneId: ZONE_NORTH },
  { id: EST_S, name: "Planta Sur", status: "ACTIVO", zoneId: ZONE_SOUTH },
  { id: EST_SU, name: "La Suiza", status: "ACTIVO", zoneId: ZONE_NORTH },
];
// La Suiza tiene unidades; Campo La Esperanza tiene una propia (para el caso "otro establecimiento").
const units = [
  { id: UNIT_N, name: "Lote Norte", status: "ACTIVO", establishmentId: EST_SU, archivedAt: null },
  { id: UNIT_S, name: "Lote Sur", status: "ACTIVO", establishmentId: EST_SU, archivedAt: null },
  { id: UNIT_X, name: "Galpón", status: "ACTIVO", establishmentId: EST_A, archivedAt: null },
  { id: UNIT_OLD, name: "Lote Viejo", status: "ACTIVO", establishmentId: EST_SU, archivedAt: new Date("2026-09-01T00:00:00.000Z") },
  { id: UNIT_OFF, name: "Lote Cerrado", status: "INACTIVO", establishmentId: EST_SU, archivedAt: null },
];
type Selection = { establishmentId: string; coverage: "ESTABLISHMENT" | "UNITS"; unitIds: string[] };
const full = (...ids: string[]): Selection[] => ids.map((establishmentId) => ({ establishmentId, coverage: "ESTABLISHMENT", unitIds: [] }));
const only = (establishmentId: string, ...unitIds: string[]): Selection => ({ establishmentId, coverage: "UNITS", unitIds });
const tx = { marker: "tx" };
const audit = { userId: "user-rrhh" };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function row(id: string, zoneId: string, from: string, to: string | null, selections: Selection[]) {
  return {
    id,
    employeeId: "emp-1",
    zoneId,
    effectiveFrom: new Date(`${from}T00:00:00.000Z`),
    effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null,
    reason: "Asignación inicial",
    notes: null,
    createdByUserId: "user-rrhh",
    createdAt: new Date("2026-10-07T15:00:00.000Z"),
    updatedAt: new Date("2026-10-07T15:00:00.000Z"),
    zone: { ...zones[zoneId]!, code: "ZON", province: null },
    establishments: selections.map((selection) => ({
      coverage: selection.coverage,
      establishment: { ...establishments.find((item) => item.id === selection.establishmentId)!, code: "EST" },
      units: selection.unitIds.map((unitId) => ({ unit: { ...units.find((item) => item.id === unitId)!, code: "U" } })),
    })),
    createdBy: { id: "user-rrhh", name: "RRHH Prueba" },
  };
}

let rows: ReturnType<typeof row>[] = [];
const calls: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  rows = [row("loc-north", ZONE_NORTH, "2026-01-01", null, full(EST_A))];
  repo.transaction.mockImplementation((operation: (client: object) => unknown) => operation(tx));
  repo.findEmployeeReference.mockResolvedValue({ id: "emp-1", legajo: "QA-A6", firstName: "Prueba", lastName: "Ubicaciones" });
  repo.findByEmployee.mockImplementation(() => Promise.resolve(rows));
  repo.findZone.mockImplementation((_tx: object, id: string) => Promise.resolve(zones[id] ?? null));
  repo.findEstablishments.mockImplementation((_tx: object, ids: string[]) => Promise.resolve(establishments.filter((item) => ids.includes(item.id))));
  repo.findUnits.mockImplementation((_tx: object, ids: string[]) => Promise.resolve(units.filter((item) => ids.includes(item.id))));
  repo.createWithin.mockImplementation(() => { calls.push("create"); return Promise.resolve({ id: "loc-new" }); });
  repo.closeWithin.mockImplementation((_tx: object, id: string, to: string) => { calls.push(`close:${id}:${to}`); return Promise.resolve({ id }); });
  repo.correctWithin.mockImplementation(() => { calls.push("correct"); return Promise.resolve(); });
  repo.createBlockHistoryWithin.mockImplementation(() => { calls.push("history"); return Promise.resolve({ id: "hist-1" }); });
  registerWithin.mockImplementation(() => { calls.push("audit"); return Promise.resolve({ id: "audit-1" }); });
});

describe("create — alta de una ubicación", () => {
  it("varias zonas simultáneas con varios establecimientos: fila, historial y auditoría en la misma transacción", async () => {
    await employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-03-01", effectiveTo: null, reason: "Cosecha", notes: null }, audit);

    expect(repo.createWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-03-01", effectiveTo: null }), "user-rrhh");
    expect(calls).toEqual(["create", "history", "audit"]);
    expect(repo.createBlockHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ oldValue: null, newValue: "Alta · Zona Sur: Planta Sur · desde el 01/03/2026, sin fecha de fin", effectiveFrom: "2026-03-01", reason: "Cosecha" }), "user-rrhh");
    const auditInput = registerWithin.mock.calls[0]![1];
    expect(registerWithin.mock.calls[0]![0]).toBe(tx);
    expect(auditInput).toMatchObject({ action: "CREATE", entity: "EmployeeWorkLocation", entityId: "emp-1", userId: "user-rrhh" });
    expect(auditInput.description).toBe("Se asignó la ubicación de trabajo Zona Sur: Planta Sur · desde el 01/03/2026, sin fecha de fin a Ubicaciones, Prueba · Legajo QA-A6.");
    expect(auditInput.description).not.toMatch(UUID);
    expect(clearCaches).toHaveBeenCalledTimes(1);
  });

  it("rechaza un período futuro superpuesto en la misma zona sin escribir nada", async () => {
    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_NORTH, establishments: full(EST_B), effectiveFrom: "2027-01-01", reason: "Futura" }, audit))
      .rejects.toMatchObject({ statusCode: 409, code: "WORK_LOCATION_OVERLAP" });
    expect(calls).toEqual([]);
    expect(clearCaches).not.toHaveBeenCalled();
  });

  it("acepta una vigencia futura que empieza después de una finalizada", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-06-30", full(EST_A))];

    await employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_NORTH, establishments: full(EST_A, EST_B), effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31", reason: "Temporada" }, audit);

    expect(repo.createWithin).toHaveBeenCalled();
  });

  it("rechaza establecimientos de otra zona", async () => {
    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishments: full(EST_S, EST_A), effectiveFrom: "2026-03-01", reason: "Error" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_ESTABLISHMENT_ZONE_MISMATCH" });
    expect(calls).toEqual([]);
  });

  it("404 si el legajo no existe", async () => {
    repo.findEmployeeReference.mockResolvedValue(null);

    await expect(employeeWorkLocationsService.create("emp-x", { zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-03-01", reason: "Alta" }, audit))
      .rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND" });
  });

  it("si la auditoría falla, la operación falla (la transacción se revierte) y no limpia cachés", async () => {
    registerWithin.mockRejectedValue(new Error("audit down"));

    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-03-01", reason: "Alta" }, audit)).rejects.toThrow("audit down");
    expect(clearCaches).not.toHaveBeenCalled();
  });

  it("la exclusión de la base (escritura concurrente) se traduce al mismo error legible", async () => {
    repo.createWithin.mockRejectedValue(new Error('conflicting key value violates exclusion constraint "EmployeeWorkLocation_no_overlap"'));

    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-03-01", reason: "Alta" }, audit))
      .rejects.toMatchObject({ statusCode: 409, code: "WORK_LOCATION_OVERLAP" });
  });

  it("un conflicto de serialización devuelve 409 de concurrencia", async () => {
    repo.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("serialization", { code: "P2034", clientVersion: "test" }));

    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-03-01", reason: "Alta" }, audit))
      .rejects.toMatchObject({ statusCode: 409, code: "WORK_LOCATION_CONCURRENT_CHANGE" });
  });
});

describe("change — cambio con nueva vigencia", () => {
  it("cierra la vigente en D − 1 y abre la nueva en D, en ese orden, conservando el historial", async () => {
    await employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishments: full(EST_A, EST_B), effectiveFrom: "2026-10-01", effectiveTo: null, reason: "Suma El Ombú" }, audit);

    expect(calls).toEqual(["close:loc-north:2026-09-30", "create", "history", "audit"]);
    expect(repo.createWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ effectiveFrom: "2026-10-01", establishments: full(EST_A, EST_B) }), "user-rrhh");
    const auditInput = registerWithin.mock.calls[0]![1];
    expect(auditInput.action).toBe("UPDATE");
    expect(auditInput.after.closed.effectiveTo).toBe("2026-09-30");
    expect(auditInput.description).toContain("desde el 01/10/2026");
    expect(auditInput.description).not.toMatch(UUID);
  });

  it("permite cambiar de zona desde una fecha", async () => {
    await employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-10-01", reason: "Traslado" }, audit);

    expect(calls[0]).toBe("close:loc-north:2026-09-30");
  });

  it("rechaza un cambio que empieza el mismo día o antes que la vigente: eso es una corrección", async () => {
    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishments: full(EST_B), effectiveFrom: "2026-01-01", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_CHANGE_DATE_INVALID" });
    expect(calls).toEqual([]);
  });

  it("rechaza un cambio posterior al fin de una vigencia finalizada", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-03-31", full(EST_A))];

    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishments: full(EST_B), effectiveFrom: "2026-05-01", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_CHANGE_OUTSIDE_PERIOD" });
  });

  it("rechaza un cambio sin diferencias", async () => {
    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishments: full(EST_A), effectiveFrom: "2026-05-01", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_CHANGE_EMPTY" });
  });

  it("rechaza si la nueva vigencia pisa una futura ya cargada en la misma zona", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-06-30", full(EST_A)), row("loc-future", ZONE_NORTH, "2026-07-01", null, full(EST_B))];

    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishments: full(EST_A, EST_B), effectiveFrom: "2026-05-01", effectiveTo: null, reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_OVERLAP" });
    expect(calls).toEqual([]);
  });

  it("404 si la ubicación no es de ese legajo", async () => {
    await expect(employeeWorkLocationsService.change("emp-1", "loc-ajena", { zoneId: ZONE_NORTH, establishments: full(EST_B), effectiveFrom: "2026-05-01", reason: "X" }, audit))
      .rejects.toMatchObject({ statusCode: 404, code: "WORK_LOCATION_NOT_FOUND" });
  });
});

describe("end — finalización", () => {
  it("fija la fecha de fin con motivo en historial y auditoría", async () => {
    await employeeWorkLocationsService.end("emp-1", "loc-north", { effectiveTo: "2026-12-31", reason: "Fin de temporada" }, audit);

    expect(calls).toEqual(["close:loc-north:2026-12-31", "history", "audit"]);
    expect(repo.createBlockHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ effectiveFrom: "2026-12-31", reason: "Fin de temporada" }), "user-rrhh");
  });

  it("rechaza una ubicación que ya tiene fecha de fin (usar corrección)", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-03-31", full(EST_A))];

    await expect(employeeWorkLocationsService.end("emp-1", "loc-north", { effectiveTo: "2026-02-28", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_ALREADY_ENDED" });
  });

  it("rechaza un fin anterior al inicio", async () => {
    await expect(employeeWorkLocationsService.end("emp-1", "loc-north", { effectiveTo: "2025-12-31", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_INVALID_INTERVAL" });
  });
});

describe("correct — corrección de un registro", () => {
  it("modifica el mismo registro (sin vigencia nueva) con antes/después y motivo de corrección auditados", async () => {
    await employeeWorkLocationsService.correct("emp-1", "loc-north", { establishments: full(EST_B), effectiveFrom: "2026-02-01", correctionReason: "Se cargó el campo equivocado" }, audit);

    expect(repo.correctWithin).toHaveBeenCalledWith(tx, "loc-north", expect.objectContaining({ zoneId: ZONE_NORTH, establishments: full(EST_B), effectiveFrom: "2026-02-01", effectiveTo: null, reason: "Asignación inicial" }), true);
    expect(repo.createWithin).not.toHaveBeenCalled();
    expect(repo.closeWithin).not.toHaveBeenCalled();
    const auditInput = registerWithin.mock.calls[0]![1];
    expect(auditInput.before).toMatchObject({ effectiveFrom: "2026-01-01", establishments: ["Campo La Esperanza"] });
    expect(auditInput.after).toMatchObject({ effectiveFrom: "2026-02-01", establishments: ["Campo El Ombú"], correctionReason: "Se cargó el campo equivocado" });
    expect(auditInput.description).toContain("Motivo: Se cargó el campo equivocado");
    expect(repo.createBlockHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ newValue: expect.stringMatching(/^Corrección · /), reason: "Se cargó el campo equivocado" }), "user-rrhh");
  });

  it("corregir sólo fechas no reemplaza establecimientos", async () => {
    await employeeWorkLocationsService.correct("emp-1", "loc-north", { effectiveTo: "2026-12-31", correctionReason: "Fin mal omitido" }, audit);

    expect(repo.correctWithin).toHaveBeenCalledWith(tx, "loc-north", expect.objectContaining({ effectiveTo: "2026-12-31" }), false);
  });

  it("rechaza una corrección sin cambios", async () => {
    await expect(employeeWorkLocationsService.correct("emp-1", "loc-north", { effectiveFrom: "2026-01-01", correctionReason: "Nada" }, audit))
      .rejects.toMatchObject({ statusCode: 400, code: "WORK_LOCATION_CORRECTION_EMPTY" });
  });

  it("rechaza una corrección que superpone otra vigencia de la misma zona", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-06-30", full(EST_A)), row("loc-later", ZONE_NORTH, "2026-07-01", null, full(EST_B))];

    await expect(employeeWorkLocationsService.correct("emp-1", "loc-north", { effectiveTo: "2026-07-15", correctionReason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_OVERLAP" });
  });
});

describe("list — lectura", () => {
  it("aplica el alcance de Supervisión y devuelve fechas como claves de calendario con estado", async () => {
    rows = [row("loc-ended", ZONE_NORTH, "2025-01-01", "2025-12-31", full(EST_A)), row("loc-future", ZONE_SOUTH, "2099-01-01", null, full(EST_S))];

    const result = await employeeWorkLocationsService.list("emp-1", { id: "user-sup", role: roles.supervision } as Express.AuthUser);

    expect(repo.findEmployeeReference.mock.calls[0]![1]).toHaveProperty("assignments");
    expect(result.map((item) => [item.id, item.effectiveFrom, item.effectiveTo, item.state])).toEqual([
      ["loc-ended", "2025-01-01", "2025-12-31", "ENDED"],
      ["loc-future", "2099-01-01", null, "FUTURE"],
    ]);
  });

  it("404 si el legajo está fuera del alcance", async () => {
    repo.findEmployeeReference.mockResolvedValue(null);

    await expect(employeeWorkLocationsService.list("emp-1", { id: "user-sup", role: roles.supervision } as Express.AuthUser))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("unidades del establecimiento — cobertura explícita", () => {
  it("asigna unidades específicas de un establecimiento junto a otro completo; el historial muestra la ruta", async () => {
    rows = [];

    await employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_NORTH, establishments: [...full(EST_B), only(EST_SU, UNIT_S, UNIT_N)], effectiveFrom: "2026-03-01", reason: "Campaña" }, audit);

    expect(repo.createWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ establishments: [...full(EST_B), only(EST_SU, UNIT_S, UNIT_N)] }), "user-rrhh");
    expect(repo.createBlockHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ newValue: "Alta · Zona Norte: Campo El Ombú, La Suiza (Lote Norte, Lote Sur) · desde el 01/03/2026, sin fecha de fin" }), "user-rrhh");
  });

  it("una oficina sin unidades se asigna completa", async () => {
    rows = [];
    await employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishments: full(EST_S), effectiveFrom: "2026-03-01", reason: "Oficina" }, audit);

    expect(repo.findUnits).toHaveBeenCalledWith(tx, []);
    expect(repo.createWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ establishments: [{ establishmentId: EST_S, coverage: "ESTABLISHMENT", unitIds: [] }] }), "user-rrhh");
  });

  it.each([
    ["unidad de otro establecimiento", [only(EST_SU, UNIT_X)], 409, "WORK_LOCATION_UNIT_ESTABLISHMENT_MISMATCH"],
    ["unidades específicas sin ninguna unidad", [only(EST_SU)], 400, "WORK_LOCATION_UNITS_REQUIRED"],
    ["establecimiento completo con unidades", [{ establishmentId: EST_SU, coverage: "ESTABLISHMENT" as const, unitIds: [UNIT_N] }], 400, "WORK_LOCATION_UNITS_NOT_ALLOWED"],
    ["unidad repetida", [only(EST_SU, UNIT_N, UNIT_N)], 409, "WORK_LOCATION_UNIT_DUPLICATE"],
    ["unidad archivada", [only(EST_SU, UNIT_OLD)], 400, "WORK_LOCATION_UNIT_ARCHIVED"],
    ["unidad inactiva", [only(EST_SU, UNIT_OFF)], 409, "WORK_LOCATION_UNIT_INACTIVE"],
    ["unidad inexistente", [only(EST_SU, "ffffffff-ffff-4fff-8fff-ffffffffffff")], 400, "WORK_LOCATION_UNIT_INVALID"],
  ])("rechaza %s sin escribir nada", async (_label, selections, statusCode, code) => {
    rows = [];
    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_NORTH, establishments: selections, effectiveFrom: "2026-03-01", reason: "Alta" }, audit))
      .rejects.toMatchObject({ statusCode, code });
    expect(calls).toEqual([]);
  });

  it("pasar de establecimiento completo a unidades específicas es un cambio válido", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", null, full(EST_SU))];

    await employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishments: [only(EST_SU, UNIT_N)], effectiveFrom: "2026-10-01", reason: "Sólo Lote Norte" }, audit);

    expect(calls).toEqual(["close:loc-north:2026-09-30", "create", "history", "audit"]);
    expect(registerWithin.mock.calls[0]![1].description).toContain("Zona Norte: La Suiza · desde el 01/01/2026, sin fecha de fin → Zona Norte: La Suiza (Lote Norte)");
  });

  it("las mismas unidades en otro orden no son un cambio", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", null, [only(EST_SU, UNIT_N, UNIT_S)])];

    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishments: [only(EST_SU, UNIT_S, UNIT_N)], effectiveFrom: "2026-10-01", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_CHANGE_EMPTY" });
  });

  it("al corregir se conserva una unidad que se inactivó después de asignarla", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", null, [only(EST_SU, UNIT_OFF)])];

    await employeeWorkLocationsService.correct("emp-1", "loc-north", { establishments: [only(EST_SU, UNIT_OFF, UNIT_N)], correctionReason: "Faltaba Lote Norte" }, audit);

    expect(repo.correctWithin).toHaveBeenCalledWith(tx, "loc-north", expect.objectContaining({ establishments: [only(EST_SU, UNIT_OFF, UNIT_N)] }), true);
  });

  it("una asignación anterior a las unidades se lee como establecimiento completo, con zona y unidades en el detalle", async () => {
    rows = [row("loc-old", ZONE_NORTH, "2026-01-01", null, full(EST_A, EST_SU)), row("loc-units", ZONE_SOUTH, "2026-01-01", null, full(EST_S))];
    rows[1]!.zone = { ...rows[1]!.zone, province: { id: "prov-er", name: "Entre Ríos" } } as never;

    const result = await employeeWorkLocationsService.list("emp-1", { id: "user-rrhh", role: roles.rrhh } as Express.AuthUser);

    expect(result[0]!.establishments.map((item) => [item.name, item.coverage, item.units])).toEqual([["Campo La Esperanza", "ESTABLISHMENT", []], ["La Suiza", "ESTABLISHMENT", []]]);
    expect(result[1]!.zone).toMatchObject({ name: "Zona Sur", province: { name: "Entre Ríos" } });
  });
});

describe("detachNodesWithin — eliminación controlada de nodos de Ubicaciones", () => {
  const withEmployee = (value: ReturnType<typeof row>) => ({ ...value, employee: { id: "emp-1", legajo: "QA-A6", firstName: "Prueba", lastName: "Ubicaciones" } });
  const context = { todayKey: "2026-10-13", reason: "Eliminación de la unidad del establecimiento “Lote Norte”", audit };

  it("cierra ayer la vigente y sigue desde hoy sólo con lo que queda; cancela la futura que se queda sin nada; historial y auditoría por fila", async () => {
    repo.cancelWithin.mockImplementation(() => { calls.push("cancel"); return Promise.resolve(); });
    repo.findOpenByNodesWithin.mockResolvedValue([
      withEmployee(row("loc-cur", ZONE_NORTH, "2026-01-01", null, [only(EST_SU, UNIT_N, UNIT_S)])),
      withEmployee(row("loc-fut", ZONE_NORTH, "2027-01-01", null, [only(EST_SU, UNIT_N)])),
      withEmployee(row("loc-full", ZONE_NORTH, "2026-01-01", null, full(EST_SU))),
    ]);

    const count = await employeeWorkLocationsService.detachNodesWithin(tx as never, { zoneIds: [], establishmentIds: [], unitIds: [UNIT_N] }, context);

    // La asignación de establecimiento completo no cambia porque se elimine un lote.
    expect(count).toBe(2);
    expect(calls).toEqual(["close:loc-cur:2026-10-12", "create", "history", "audit", "cancel", "history", "audit"]);
    expect(repo.createWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ zoneId: ZONE_NORTH, establishments: [only(EST_SU, UNIT_S)], effectiveFrom: "2026-10-13", effectiveTo: null, reason: context.reason }), "user-rrhh");
    expect(repo.cancelWithin).toHaveBeenCalledWith(tx, "loc-fut");
    expect(repo.createBlockHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ newValue: "Cambio · Zona Norte: La Suiza (Lote Sur) · desde el 13/10/2026, sin fecha de fin", reason: context.reason }), "user-rrhh");
    expect(registerWithin.mock.calls.map(([, input]) => input.action)).toEqual(["UPDATE", "DELETE"]);
  });

  it("zona eliminada: la vigente termina ayer sin continuar (la persona queda sin ubicación en esa zona)", async () => {
    repo.findOpenByNodesWithin.mockResolvedValue([withEmployee(row("loc-cur", ZONE_NORTH, "2026-01-01", null, full(EST_A, EST_B)))]);

    await employeeWorkLocationsService.detachNodesWithin(tx as never, { zoneIds: [ZONE_NORTH], establishmentIds: [EST_A, EST_B], unitIds: [] }, context);

    expect(calls).toEqual(["close:loc-cur:2026-10-12", "history", "audit"]);
    expect(repo.createWithin).not.toHaveBeenCalled();
    expect(repo.createBlockHistoryWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ newValue: "Finalización · Zona Norte: Campo La Esperanza, Campo El Ombú · del 01/01/2026 al 12/10/2026", effectiveFrom: "2026-10-12" }), "user-rrhh");
  });
});
