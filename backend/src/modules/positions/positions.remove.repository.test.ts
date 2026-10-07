import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { positionsRepository } from "./positions.repository";

// removeOrInactivate: borrado explícito y en orden, sin depender de CASCADE;
// inactivación cuando hay personas o reglas de horas especiales. Prisma se
// mockea: el test nunca toca una base real.
const { tx, prismaMock } = vi.hoisted(() => {
  const tx = {
    position: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    positionOrgScope: { deleteMany: vi.fn() },
    positionSalaryCategory: { deleteMany: vi.fn() },
  };
  return { tx, prismaMock: { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } };
});
vi.mock("../../shared/prisma/client", () => ({ prisma: prismaMock }));

const row = (counts: { employees: number; doubleHourRules: number }) => ({ id: "pos-1", code: "PUE-1", name: "Parrillero", status: "ACTIVO", _count: counts });

beforeEach(() => vi.clearAllMocks());

describe("positionsRepository.removeOrInactivate", () => {
  it("referenciado por una regla de horas especiales: inactiva y no borra nada", async () => {
    tx.position.findUnique.mockResolvedValue(row({ employees: 0, doubleHourRules: 1 }));
    const onDone = vi.fn();

    const outcome = await positionsRepository.removeOrInactivate("pos-1", onDone);

    expect(outcome).toMatchObject({ kind: "INACTIVATED", doubleHourRules: 1 });
    expect(tx.position.update).toHaveBeenCalledWith({ where: { id: "pos-1" }, data: { status: "INACTIVO" } });
    expect(tx.position.delete).not.toHaveBeenCalled();
    expect(tx.positionSalaryCategory.deleteMany).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(tx, outcome);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it("sin dependencias: borra alcances y categorías explícitamente antes del puesto", async () => {
    tx.position.findUnique.mockResolvedValue(row({ employees: 0, doubleHourRules: 0 }));
    const order: string[] = [];
    tx.positionOrgScope.deleteMany.mockImplementation(async () => order.push("scopes"));
    tx.positionSalaryCategory.deleteMany.mockImplementation(async () => order.push("categories"));
    tx.position.delete.mockImplementation(async () => order.push("position"));

    await positionsRepository.removeOrInactivate("pos-1", vi.fn());

    expect(order).toEqual(["scopes", "categories", "position"]);
    expect(tx.position.update).not.toHaveBeenCalled();
  });

  it("inexistente: no escribe ni audita", async () => {
    tx.position.findUnique.mockResolvedValue(null);
    const onDone = vi.fn();
    await expect(positionsRepository.removeOrInactivate("nope", onDone)).resolves.toEqual({ kind: "NOT_FOUND" });
    expect(onDone).not.toHaveBeenCalled();
    expect(tx.position.delete).not.toHaveBeenCalled();
  });
});
