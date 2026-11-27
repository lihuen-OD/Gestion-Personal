import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { shiftExpectedPreviewRepository } from "./shiftExpectedPreview.repository";
import type { ExpectedShiftPreviewQuery } from "./shiftExpectedPreview.schemas";

vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findMany: vi.fn(), count: vi.fn() },
    shiftRotation: { findUnique: vi.fn() },
    shiftRotationCrewMember: { findMany: vi.fn() },
  },
}));

const db = prisma as unknown as {
  employee: { findMany: Mock; count: Mock };
  shiftRotation: { findUnique: Mock };
  shiftRotationCrewMember: { findMany: Mock };
};
const query: ExpectedShiftPreviewQuery = { rotationId: "11111111-1111-4111-8111-111111111111", from: "2026-12-01", to: "2026-12-31", page: 2, take: 25 };

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findMany.mockResolvedValue([]);
  db.employee.count.mockResolvedValue(0);
  db.shiftRotationCrewMember.findMany.mockResolvedValue([]);
});

describe("shiftExpectedPreviewRepository", () => {
  it("pagina empleados por membresía que intersecta el rango y combina employeeAccessWhere", async () => {
    const accessWhere = { assignments: { some: { type: "TIME_RESPONSIBLE" } } } as Prisma.EmployeeWhereInput;
    await shiftExpectedPreviewRepository.findEmployees(query, accessWhere);

    const find = db.employee.findMany.mock.calls[0]![0];
    const count = db.employee.count.mock.calls[0]![0];
    expect(find.where.AND[0]).toBe(accessWhere);
    expect(find.where.AND[1].shiftRotationMemberships.some).toMatchObject({
      crew: { rotationId: query.rotationId },
      effectiveFrom: { lte: new Date("2026-12-31T00:00:00.000Z") },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date("2026-12-01T00:00:00.000Z") } }],
    });
    expect(count.where).toEqual(find.where);
    expect(find.skip).toBe(25);
    expect(find.take).toBe(25);
    expect(find.orderBy).toEqual([{ lastName: "asc" }, { firstName: "asc" }, { legajo: "asc" }, { id: "asc" }]);
  });

  it("carga para la página todas las membresías intersectantes, incluidas futuras y cambios de equipo", async () => {
    await shiftExpectedPreviewRepository.findMemberships(query.rotationId, ["employee-1"], "2026-11-30", "2027-01-01");
    const call = db.shiftRotationCrewMember.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({
      employeeId: { in: ["employee-1"] },
      crew: { rotationId: query.rotationId },
      effectiveFrom: { lte: new Date("2027-01-01T00:00:00.000Z") },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date("2026-11-30T00:00:00.000Z") } }],
    });
  });
});
