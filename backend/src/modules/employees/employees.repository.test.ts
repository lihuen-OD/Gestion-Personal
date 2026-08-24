import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { prisma } from "../../shared/prisma/client";
import { employeesRepository, resolveLaborStatus } from "./employees.repository";
import { EmployeeStatus } from "@prisma/client";

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

describe("resolveLaborStatus", () => {
  it("no adelanta una baja del día UTC siguiente mientras todavía es el día anterior en Argentina", () => {
    const reference = new Date("2026-08-15T01:30:00.000Z"); // 14/08 22:30 en Argentina
    const movements = [
      { type: "ALTA" as const, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") },
      { type: "BAJA" as const, effectiveFrom: new Date("2026-08-15T00:00:00.000Z") },
    ];

    expect(resolveLaborStatus(movements, reference)).toBe(EmployeeStatus.ACTIVO);
  });

  it("mantiene inactiva un alta futura hasta que comienza el día calendario Argentina", () => {
    const reference = new Date("2026-08-15T01:30:00.000Z"); // 14/08 22:30 en Argentina
    const movements = [{ type: "ALTA" as const, effectiveFrom: new Date("2026-08-15T00:00:00.000Z") }];

    expect(resolveLaborStatus(movements, reference)).toBe(EmployeeStatus.INACTIVO);
  });
});
