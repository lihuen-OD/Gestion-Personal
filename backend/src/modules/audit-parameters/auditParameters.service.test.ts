import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { auditParametersRepository } from "./auditParameters.repository";
import { auditParametersService } from "./auditParameters.service";
import { auditService } from "../audit/audit.service";

/**
 * Trazabilidad de autoria (2026-08-18): el servicio debe pasar el usuario
 * autenticado completo (id + name) al repositorio, para que createdByUserId/
 * createdByUserName (y sus equivalentes de updated) puedan escribirse juntos.
 */
vi.mock("./auditParameters.repository", () => ({
  auditParametersRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const repo = auditParametersRepository as unknown as { create: Mock; update: Mock; findById: Mock };
const user = { id: "user-1", name: "Ana Gomez", role: "Nivel 1 - RRHH" } as unknown as Express.AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auditParametersService.create", () => {
  it("pasa el usuario autenticado completo al repositorio", async () => {
    repo.create.mockResolvedValue({ id: "param-1", code: "AUD-100", name: "Test" });

    await auditParametersService.create({ code: "AUD-100" } as never, user);

    expect(repo.create).toHaveBeenCalledWith({ code: "AUD-100" }, user);
    expect(auditService.register).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATE", entity: "AuditParameter" }));
  });
});

describe("auditParametersService.update", () => {
  it("pasa el usuario autenticado completo al repositorio", async () => {
    repo.findById.mockResolvedValue({ id: "param-1", code: "AUD-100", name: "Viejo" });
    repo.update.mockResolvedValue({ id: "param-1", code: "AUD-100", name: "Nuevo" });

    await auditParametersService.update("param-1", { name: "Nuevo" } as never, user);

    expect(repo.update).toHaveBeenCalledWith("param-1", { name: "Nuevo" }, user);
  });
});
