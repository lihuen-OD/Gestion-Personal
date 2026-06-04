import type { Novelty } from "../types";
import { auditMockService } from "./auditMockService";
import { readStore, writeStore } from "./storage";

export const noveltyMockService = {
  getAll: () => readStore<Novelty>("novelties"),
  getByEmployee: (employeeId: string) => readStore<Novelty>("novelties").filter((n) => n.employeeId === employeeId),
  create: (value: Omit<Novelty, "id">, role: string) => {
    const novelty = { ...value, id: crypto.randomUUID() };
    writeStore("novelties", [novelty, ...readStore<Novelty>("novelties")]);
    auditMockService.create({ user: value.createdBy, role, action: "Creó novedad", entity: value.type, previous: "-", next: value.quantity, reason: "Registro de novedad" });
    return novelty;
  },
};
