import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { invalidatePositionsCache, positionsRepository, type PositionRemovalOutcome } from "./positions.repository";
import { positionsService } from "./positions.service";

// Baja de puestos (docs/decisions/ORG_LOCATION_REORGANIZATION.md §6): un
// puesto referenciado por una regla de horas especiales no se borra (su NULL
// ampliaría la regla). El repositorio se mockea y ejecuta `onDone` con un
// cliente ficticio, como haría la transacción real.
const tx = { marker: "tx" };
let outcome: PositionRemovalOutcome;

vi.mock("./positions.repository", () => ({
  positionsRepository: {
    removeOrInactivate: vi.fn(async (_id: string, onDone: (client: unknown, result: PositionRemovalOutcome) => Promise<unknown>) => {
      if (outcome.kind !== "NOT_FOUND") await onDone(tx, outcome);
      return outcome;
    }),
    findById: vi.fn(),
  },
  invalidatePositionsCache: vi.fn(),
}));
vi.mock("../audit/audit.service", () => ({ auditService: { registerWithin: vi.fn(), register: vi.fn() }, clearAuditDerivedCaches: vi.fn() }));

const registerWithin = auditService.registerWithin as unknown as Mock;
const position = { id: "pos-1", code: "PUE-1", name: "Parrillero", status: "ACTIVO" };

beforeEach(() => {
  vi.clearAllMocks();
  (positionsRepository.findById as unknown as Mock).mockResolvedValue({ ...position, status: "INACTIVO" });
});

describe("positionsService.remove", () => {
  it("un puesto referenciado por reglas de horas especiales se inactiva, no se borra, y se audita en la transacción", async () => {
    outcome = { kind: "INACTIVATED", position, employees: 0, doubleHourRules: 2 };

    const result = await positionsService.remove("pos-1", { userId: "u1" });

    expect(result).toMatchObject({ id: "pos-1", status: "INACTIVO" });
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "UPDATE",
      entity: "Position",
      description: "Se inactivó puesto PUE-1 - Parrillero en lugar de eliminarlo (tiene 2 reglas de horas especiales).",
      after: expect.objectContaining({ status: "INACTIVO" }),
    }));
    expect(invalidatePositionsCache).toHaveBeenCalled();
    expect(clearAuditDerivedCaches).toHaveBeenCalled();
  });

  it("con personas y reglas, el motivo menciona ambas", async () => {
    outcome = { kind: "INACTIVATED", position, employees: 1, doubleHourRules: 1 };
    await positionsService.remove("pos-1");
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ description: expect.stringContaining("1 persona asignada y 1 regla de horas especiales") }));
  });

  it("sin dependencias se elimina y se audita como DELETE", async () => {
    outcome = { kind: "DELETED", position };
    await expect(positionsService.remove("pos-1")).resolves.toBeNull();
    expect(registerWithin).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "DELETE" }));
  });

  it("puesto inexistente → 404 y sin auditoría", async () => {
    outcome = { kind: "NOT_FOUND" };
    await expect(positionsService.remove("nope")).rejects.toMatchObject({ statusCode: 404, code: "POSITION_NOT_FOUND" });
    expect(registerWithin).not.toHaveBeenCalled();
    expect(invalidatePositionsCache).not.toHaveBeenCalled();
  });

  it("si la auditoría falla, el error se propaga (la transacción se revierte) y no se limpian cachés", async () => {
    outcome = { kind: "DELETED", position };
    registerWithin.mockRejectedValueOnce(new Error("audit down"));
    await expect(positionsService.remove("pos-1")).rejects.toThrow("audit down");
    expect(clearAuditDerivedCaches).not.toHaveBeenCalled();
  });
});
