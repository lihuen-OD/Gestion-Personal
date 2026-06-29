import type { Novelty, User } from "../types";
import { auditMockService } from "./auditMockService";
import { noveltyTypeMockService } from "./noveltyTypeMockService";
import { readStore, writeStore } from "./storage";

function canApproveNovelty(novelty: Novelty, user: User) {
  if (user.role === "Nivel 1 - RRHH") return true;
  const type = novelty.noveltyTypeId ? noveltyTypeMockService.getById(novelty.noveltyTypeId) : noveltyTypeMockService.getByName(novelty.type);
  return Boolean(type?.approvalRoles.includes(user.role));
}

function updateStatus(id: string, status: "Aprobado" | "Rechazado", user: User, reason = "Circuito de aprobacion de novedades") {
  const all = readStore<Novelty>("novelties");
  const current = all.find((novelty) => novelty.id === id);
  if (!current || !canApproveNovelty(current, user)) return undefined;
  const updated = { ...current, status };
  writeStore("novelties", all.map((novelty) => novelty.id === id ? updated : novelty));
  auditMockService.create({
    user: user.name,
    role: user.role,
    action: status === "Aprobado" ? "Aprobó novedad" : "Rechazó novedad",
    entity: current.type,
    previous: current.status,
    next: status,
    reason: "Circuito de aprobación de novedades",
  });
  return updated;
}

export const noveltyMockService = {
  getAll: () => readStore<Novelty>("novelties"),
  getByEmployee: (employeeId: string) => readStore<Novelty>("novelties").filter((n) => n.employeeId === employeeId),
  canApprove: canApproveNovelty,
  create: (value: Omit<Novelty, "id">, role: string) => {
    const novelty = { ...value, id: crypto.randomUUID() };
    writeStore("novelties", [novelty, ...readStore<Novelty>("novelties")]);
    auditMockService.create({ user: value.createdBy, role, action: "Creó novedad", entity: value.type, previous: "-", next: value.quantity, reason: "Registro de novedad" });
    return novelty;
  },
  approve: (id: string, user: User) => updateStatus(id, "Aprobado", user),
  reject: (id: string, user: User, reason?: string) => updateStatus(id, "Rechazado", user, reason),
};
