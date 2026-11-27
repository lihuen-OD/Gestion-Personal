import { describe, expect, it, vi } from "vitest";
import { loadRotationConfiguration, type RotationLoaderReader } from "./rotationPlan.loader";

/** R4.3b (§25.5): cargador en lote — consultas constantes, nunca por empleado ni por día. */
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

function reader(memberships: unknown[], rotations: unknown[] = []) {
  return {
    shiftRotationCrewMember: { findMany: vi.fn().mockResolvedValue(memberships) },
    shiftRotation: { findMany: vi.fn().mockResolvedValue(rotations) },
  };
}

describe("loadRotationConfiguration", () => {
  it("sin membresías: una sola consulta y configuración vacía (camino legacy)", async () => {
    const db = reader([]);
    const config = await loadRotationConfiguration(db as unknown as RotationLoaderReader, { fromKey: "2026-11-01", toKey: "2026-11-30" });
    expect(config).toEqual({ memberships: [], rotations: [] });
    expect(db.shiftRotationCrewMember.findMany).toHaveBeenCalledTimes(1);
    expect(db.shiftRotation.findMany).not.toHaveBeenCalled();
  });

  it("lista de empleados vacía: ninguna consulta", async () => {
    const db = reader([]);
    await loadRotationConfiguration(db as unknown as RotationLoaderReader, { fromKey: "2026-11-01", toKey: "2026-11-01", employeeIds: [] });
    expect(db.shiftRotationCrewMember.findMany).not.toHaveBeenCalled();
  });

  it("filtra vigencia, empleados y estado en la consulta; dos consultas para cualquier cantidad de miembros; fechas → claves", async () => {
    const template = { id: "t1", code: "PLANTA-07-15", startTime: "07:00", endTime: "15:00", crossesMidnight: false, status: "ACTIVO" };
    const db = reader(
      [
        { employeeId: "e1", crewId: "c1", effectiveFrom: day("2026-11-02"), effectiveTo: null, crew: { rotationId: "r1" } },
        { employeeId: "e2", crewId: "c1", effectiveFrom: day("2026-11-02"), effectiveTo: day("2026-12-31"), crew: { rotationId: "r1" } },
      ],
      [
        {
          id: "r1",
          code: "PLANTA",
          status: "ACTIVO",
          crews: [{ id: "c1", code: "JOSE", status: "ACTIVO" }],
          versions: [
            {
              id: "v1",
              rotationId: "r1",
              cycleLengthWeeks: 2,
              anchorWeekStart: day("2026-11-02"),
              effectiveFrom: day("2026-11-02"),
              effectiveTo: null,
              days: [{ id: "d1", crewId: "c1", cycleWeekIndex: 0, weekday: 1, kind: "SHIFT", blocks: [{ blockIndex: 0, shiftTemplate: template }] }],
            },
          ],
        },
      ],
    );
    const config = await loadRotationConfiguration(db as unknown as RotationLoaderReader, { fromKey: "2026-11-05", toKey: "2026-11-07", employeeIds: ["e1", "e2", "e1"], activeEmployeesOnly: true });

    const memberArgs = db.shiftRotationCrewMember.findMany.mock.calls[0]![0];
    expect(memberArgs.where).toEqual({
      effectiveFrom: { lte: day("2026-11-07") },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: day("2026-11-05") } }],
      employeeId: { in: ["e1", "e2"] },
      employee: { status: "ACTIVO" },
    });
    const rotationArgs = db.shiftRotation.findMany.mock.calls[0]![0];
    expect(rotationArgs.relationLoadStrategy).toBe("join");
    expect(rotationArgs.where).toEqual({ id: { in: ["r1"] } });
    expect(rotationArgs.select.versions.where).toEqual({ effectiveFrom: { lte: day("2026-11-07") }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day("2026-11-05") } }] });

    expect(config.memberships).toEqual([
      { employeeId: "e1", rotationId: "r1", crewId: "c1", effectiveFrom: "2026-11-02", effectiveTo: null },
      { employeeId: "e2", rotationId: "r1", crewId: "c1", effectiveFrom: "2026-11-02", effectiveTo: "2026-12-31" },
    ]);
    expect(config.rotations[0]!.versions[0]).toMatchObject({ anchorWeekStart: "2026-11-02", effectiveFrom: "2026-11-02", effectiveTo: null });
    expect(config.rotations[0]!.versions[0]!.days[0]!.blocks).toEqual([{ blockIndex: 0, template }]);
    expect(db.shiftRotationCrewMember.findMany).toHaveBeenCalledTimes(1);
    expect(db.shiftRotation.findMany).toHaveBeenCalledTimes(1);
  });
});
