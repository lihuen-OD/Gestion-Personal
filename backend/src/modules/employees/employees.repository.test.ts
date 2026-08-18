import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { employeesRepository } from "./employees.repository";

/**
 * Regresion de la simplificacion de jerarquia organizacional (2026-08-14):
 * findById resuelve el legajo -> sector -> area -> establecimiento -> unidad
 * de negocio usando unicamente el FK legado anidado (nunca las tablas M:N
 * eliminadas). Esta cadena no se tocó durante la migración; el test confirma
 * que sigue pidiendo y devolviendo exactamente esa forma.
 */
vi.mock("../../shared/prisma/client", () => ({
  prisma: {
    employee: { findFirst: vi.fn() },
  },
}));

describe("employeesRepository.findById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resuelve la cadena sector -> area -> establecimiento -> unidad de negocio via FK anidado", async () => {
    const resolvedChain = {
      id: "emp-1",
      sector: {
        id: "sec-1",
        name: "Sector 1",
        code: "SEC-1",
        area: {
          id: "area-1",
          name: "Area 1",
          establishment: {
            id: "est-1",
            name: "Establecimiento 1",
            businessUnit: { id: "bu-1", name: "Unidad 1" },
          },
        },
      },
    };
    (prisma.employee.findFirst as Mock).mockResolvedValue(resolvedChain);

    const result = await employeesRepository.findById("emp-1");

    expect(result).toEqual(resolvedChain);
    const findFirstMock = prisma.employee.findFirst as Mock;
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "emp-1" }, {}] } }));
    const call = findFirstMock.mock.calls.at(0)?.[0];
    expect(call?.select?.sector?.select?.area?.select?.establishment?.select?.businessUnit).toEqual({
      select: { id: true, name: true },
    });
  });

  it("respeta el accessWhere adicional sin alterar la forma de la cadena", async () => {
    (prisma.employee.findFirst as Mock).mockResolvedValue(null);

    await employeesRepository.findById("emp-2", { sectorId: { in: ["sec-1"] } });

    expect(prisma.employee.findFirst as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ id: "emp-2" }, { sectorId: { in: ["sec-1"] } }] } }),
    );
  });
});
