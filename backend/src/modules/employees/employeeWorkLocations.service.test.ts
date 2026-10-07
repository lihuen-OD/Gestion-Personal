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
    createWithin: vi.fn(),
    closeWithin: vi.fn(),
    correctWithin: vi.fn(),
    createBlockHistoryWithin: vi.fn(),
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
const establishments = [
  { id: EST_A, name: "Campo La Esperanza", status: "ACTIVO", zoneId: ZONE_NORTH },
  { id: EST_B, name: "Campo El Ombú", status: "ACTIVO", zoneId: ZONE_NORTH },
  { id: EST_S, name: "Planta Sur", status: "ACTIVO", zoneId: ZONE_SOUTH },
];
const tx = { marker: "tx" };
const audit = { userId: "user-rrhh" };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function row(id: string, zoneId: string, from: string, to: string | null, establishmentIds: string[]) {
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
    zone: { ...zones[zoneId]!, code: "ZON" },
    establishments: establishmentIds.map((estId) => ({ establishment: { ...establishments.find((item) => item.id === estId)!, code: "EST" } })),
    createdBy: { id: "user-rrhh", name: "RRHH Prueba" },
  };
}

let rows: ReturnType<typeof row>[] = [];
const calls: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  rows = [row("loc-north", ZONE_NORTH, "2026-01-01", null, [EST_A])];
  repo.transaction.mockImplementation((operation: (client: object) => unknown) => operation(tx));
  repo.findEmployeeReference.mockResolvedValue({ id: "emp-1", legajo: "QA-A6", firstName: "Prueba", lastName: "Ubicaciones" });
  repo.findByEmployee.mockImplementation(() => Promise.resolve(rows));
  repo.findZone.mockImplementation((_tx: object, id: string) => Promise.resolve(zones[id] ?? null));
  repo.findEstablishments.mockImplementation((_tx: object, ids: string[]) => Promise.resolve(establishments.filter((item) => ids.includes(item.id))));
  repo.createWithin.mockImplementation(() => { calls.push("create"); return Promise.resolve({ id: "loc-new" }); });
  repo.closeWithin.mockImplementation((_tx: object, id: string, to: string) => { calls.push(`close:${id}:${to}`); return Promise.resolve({ id }); });
  repo.correctWithin.mockImplementation(() => { calls.push("correct"); return Promise.resolve(); });
  repo.createBlockHistoryWithin.mockImplementation(() => { calls.push("history"); return Promise.resolve({ id: "hist-1" }); });
  registerWithin.mockImplementation(() => { calls.push("audit"); return Promise.resolve({ id: "audit-1" }); });
});

describe("create — alta de una ubicación", () => {
  it("varias zonas simultáneas con varios establecimientos: fila, historial y auditoría en la misma transacción", async () => {
    await employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishmentIds: [EST_S], effectiveFrom: "2026-03-01", effectiveTo: null, reason: "Cosecha", notes: null }, audit);

    expect(repo.createWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ zoneId: ZONE_SOUTH, establishmentIds: [EST_S], effectiveFrom: "2026-03-01", effectiveTo: null }), "user-rrhh");
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
    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_NORTH, establishmentIds: [EST_B], effectiveFrom: "2027-01-01", reason: "Futura" }, audit))
      .rejects.toMatchObject({ statusCode: 409, code: "WORK_LOCATION_OVERLAP" });
    expect(calls).toEqual([]);
    expect(clearCaches).not.toHaveBeenCalled();
  });

  it("acepta una vigencia futura que empieza después de una finalizada", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-06-30", [EST_A])];

    await employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_NORTH, establishmentIds: [EST_A, EST_B], effectiveFrom: "2026-07-01", effectiveTo: "2026-12-31", reason: "Temporada" }, audit);

    expect(repo.createWithin).toHaveBeenCalled();
  });

  it("rechaza establecimientos de otra zona", async () => {
    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishmentIds: [EST_S, EST_A], effectiveFrom: "2026-03-01", reason: "Error" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_ESTABLISHMENT_ZONE_MISMATCH" });
    expect(calls).toEqual([]);
  });

  it("404 si el legajo no existe", async () => {
    repo.findEmployeeReference.mockResolvedValue(null);

    await expect(employeeWorkLocationsService.create("emp-x", { zoneId: ZONE_SOUTH, establishmentIds: [EST_S], effectiveFrom: "2026-03-01", reason: "Alta" }, audit))
      .rejects.toMatchObject({ statusCode: 404, code: "EMPLOYEE_NOT_FOUND" });
  });

  it("si la auditoría falla, la operación falla (la transacción se revierte) y no limpia cachés", async () => {
    registerWithin.mockRejectedValue(new Error("audit down"));

    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishmentIds: [EST_S], effectiveFrom: "2026-03-01", reason: "Alta" }, audit)).rejects.toThrow("audit down");
    expect(clearCaches).not.toHaveBeenCalled();
  });

  it("la exclusión de la base (escritura concurrente) se traduce al mismo error legible", async () => {
    repo.createWithin.mockRejectedValue(new Error('conflicting key value violates exclusion constraint "EmployeeWorkLocation_no_overlap"'));

    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishmentIds: [EST_S], effectiveFrom: "2026-03-01", reason: "Alta" }, audit))
      .rejects.toMatchObject({ statusCode: 409, code: "WORK_LOCATION_OVERLAP" });
  });

  it("un conflicto de serialización devuelve 409 de concurrencia", async () => {
    repo.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("serialization", { code: "P2034", clientVersion: "test" }));

    await expect(employeeWorkLocationsService.create("emp-1", { zoneId: ZONE_SOUTH, establishmentIds: [EST_S], effectiveFrom: "2026-03-01", reason: "Alta" }, audit))
      .rejects.toMatchObject({ statusCode: 409, code: "WORK_LOCATION_CONCURRENT_CHANGE" });
  });
});

describe("change — cambio con nueva vigencia", () => {
  it("cierra la vigente en D − 1 y abre la nueva en D, en ese orden, conservando el historial", async () => {
    await employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishmentIds: [EST_A, EST_B], effectiveFrom: "2026-10-01", effectiveTo: null, reason: "Suma El Ombú" }, audit);

    expect(calls).toEqual(["close:loc-north:2026-09-30", "create", "history", "audit"]);
    expect(repo.createWithin).toHaveBeenCalledWith(tx, "emp-1", expect.objectContaining({ effectiveFrom: "2026-10-01", establishmentIds: [EST_A, EST_B] }), "user-rrhh");
    const auditInput = registerWithin.mock.calls[0]![1];
    expect(auditInput.action).toBe("UPDATE");
    expect(auditInput.after.closed.effectiveTo).toBe("2026-09-30");
    expect(auditInput.description).toContain("desde el 01/10/2026");
    expect(auditInput.description).not.toMatch(UUID);
  });

  it("permite cambiar de zona desde una fecha", async () => {
    await employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_SOUTH, establishmentIds: [EST_S], effectiveFrom: "2026-10-01", reason: "Traslado" }, audit);

    expect(calls[0]).toBe("close:loc-north:2026-09-30");
  });

  it("rechaza un cambio que empieza el mismo día o antes que la vigente: eso es una corrección", async () => {
    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishmentIds: [EST_B], effectiveFrom: "2026-01-01", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_CHANGE_DATE_INVALID" });
    expect(calls).toEqual([]);
  });

  it("rechaza un cambio posterior al fin de una vigencia finalizada", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-03-31", [EST_A])];

    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishmentIds: [EST_B], effectiveFrom: "2026-05-01", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_CHANGE_OUTSIDE_PERIOD" });
  });

  it("rechaza un cambio sin diferencias", async () => {
    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishmentIds: [EST_A], effectiveFrom: "2026-05-01", reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_CHANGE_EMPTY" });
  });

  it("rechaza si la nueva vigencia pisa una futura ya cargada en la misma zona", async () => {
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-06-30", [EST_A]), row("loc-future", ZONE_NORTH, "2026-07-01", null, [EST_B])];

    await expect(employeeWorkLocationsService.change("emp-1", "loc-north", { zoneId: ZONE_NORTH, establishmentIds: [EST_A, EST_B], effectiveFrom: "2026-05-01", effectiveTo: null, reason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_OVERLAP" });
    expect(calls).toEqual([]);
  });

  it("404 si la ubicación no es de ese legajo", async () => {
    await expect(employeeWorkLocationsService.change("emp-1", "loc-ajena", { zoneId: ZONE_NORTH, establishmentIds: [EST_B], effectiveFrom: "2026-05-01", reason: "X" }, audit))
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
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-03-31", [EST_A])];

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
    await employeeWorkLocationsService.correct("emp-1", "loc-north", { establishmentIds: [EST_B], effectiveFrom: "2026-02-01", correctionReason: "Se cargó el campo equivocado" }, audit);

    expect(repo.correctWithin).toHaveBeenCalledWith(tx, "loc-north", expect.objectContaining({ zoneId: ZONE_NORTH, establishmentIds: [EST_B], effectiveFrom: "2026-02-01", effectiveTo: null, reason: "Asignación inicial" }), true);
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
    rows = [row("loc-north", ZONE_NORTH, "2026-01-01", "2026-06-30", [EST_A]), row("loc-later", ZONE_NORTH, "2026-07-01", null, [EST_B])];

    await expect(employeeWorkLocationsService.correct("emp-1", "loc-north", { effectiveTo: "2026-07-15", correctionReason: "X" }, audit))
      .rejects.toMatchObject({ code: "WORK_LOCATION_OVERLAP" });
  });
});

describe("list — lectura", () => {
  it("aplica el alcance de Supervisión y devuelve fechas como claves de calendario con estado", async () => {
    rows = [row("loc-ended", ZONE_NORTH, "2025-01-01", "2025-12-31", [EST_A]), row("loc-future", ZONE_SOUTH, "2099-01-01", null, [EST_S])];

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
