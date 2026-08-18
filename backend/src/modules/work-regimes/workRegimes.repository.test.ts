import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { findActiveEmployeeWorkRegime } from "./workRegimes.repository";

/**
 * Regla de vigencia (etapa de logica de Regimen de Trabajo, 2026-08-18):
 * vigente si effectiveFrom <= fecha y (effectiveTo es null o effectiveTo >= fecha).
 * Si hay mas de una fila vigente, gana la de effectiveFrom mas reciente. Estos
 * tests verifican que el repository le pida exactamente esa forma a Prisma
 * (el desempate por "mas reciente" lo resuelve la base via orderBy + take
 * implicito de findFirst, no logica en memoria).
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employeeWorkRegime: { findFirst: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as { employeeWorkRegime: { findFirst: Mock } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findActiveEmployeeWorkRegime", () => {
  it("filtra por effectiveFrom <= fecha y effectiveTo null o >= fecha", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);
    const referenceDate = new Date("2026-08-18T00:00:00.000Z");

    await findActiveEmployeeWorkRegime("employee-1", referenceDate);

    expect(mockedPrisma.employeeWorkRegime.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employeeId: "employee-1",
          effectiveFrom: { lte: referenceDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: referenceDate } }],
        },
        orderBy: { effectiveFrom: "desc" },
      }),
    );
  });

  it("pide la fila mas reciente (orderBy effectiveFrom desc) para desambiguar dos vigentes", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    await findActiveEmployeeWorkRegime("employee-1", new Date("2026-08-18T00:00:00.000Z"));

    const call = mockedPrisma.employeeWorkRegime.findFirst.mock.calls.at(0)?.[0];
    expect(call?.orderBy).toEqual({ effectiveFrom: "desc" });
  });

  it("si no hay ninguna fila vigente para la fecha, devuelve null", async () => {
    mockedPrisma.employeeWorkRegime.findFirst.mockResolvedValue(null);

    const result = await findActiveEmployeeWorkRegime("employee-1", new Date("2026-08-18T00:00:00.000Z"));

    expect(result).toBeNull();
  });
});
