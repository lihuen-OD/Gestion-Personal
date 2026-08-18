import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { noveltiesRepository } from "./novelties.repository";
import { noveltiesService } from "./novelties.service";
import { roles } from "../../shared/security/roles";

vi.mock("./novelties.repository", () => ({
  noveltiesRepository: {
    findById: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

vi.mock("../workforce-management/workforce.service", () => ({
  notifyRrhh: vi.fn().mockResolvedValue(undefined),
}));

const repo = noveltiesRepository as unknown as { findById: Mock; approve: Mock; reject: Mock };

const rrhhUser = { id: "user-rrhh", role: roles.rrhh } as unknown as Express.AuthUser;
const supervisionUser = { id: "user-sup", role: roles.supervision } as unknown as Express.AuthUser;

function novelty(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "novelty-1",
    status: "PENDIENTE",
    noveltyType: { code: "VAC", name: "Vacaciones", approvalRoles: [] },
    employee: { legajo: "100" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("noveltiesService.approve", () => {
  it("aprueba una novedad PENDIENTE", async () => {
    repo.findById.mockResolvedValue(novelty());
    repo.approve.mockResolvedValue(novelty({ status: "APROBADO" }));

    const result = await noveltiesService.approve("novelty-1", rrhhUser);

    expect(result.status).toBe("APROBADO");
    expect(repo.approve).toHaveBeenCalledWith("novelty-1", rrhhUser.id);
  });

  it("impide aprobar una novedad ya aprobada (regresion: la guarda ya existia, se protege con test)", async () => {
    repo.findById.mockResolvedValue(novelty({ status: "APROBADO" }));

    await expect(noveltiesService.approve("novelty-1", rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_STATUS_NOT_APPROVABLE",
    });
    expect(repo.approve).not.toHaveBeenCalled();
  });

  it("impide que un rol sin permiso de aprobacion para ese tipo de novedad apruebe", async () => {
    repo.findById.mockResolvedValue(novelty({ noveltyType: { code: "VAC", name: "Vacaciones", approvalRoles: [] } }));

    await expect(noveltiesService.approve("novelty-1", supervisionUser)).rejects.toMatchObject({
      statusCode: 403,
      code: "NOVELTY_APPROVAL_FORBIDDEN",
    });
    expect(repo.approve).not.toHaveBeenCalled();
  });
});

describe("noveltiesService.reject", () => {
  it("rechaza una novedad PENDIENTE con motivo", async () => {
    repo.findById.mockResolvedValue(novelty());
    repo.reject.mockResolvedValue(novelty({ status: "RECHAZADO" }));

    const result = await noveltiesService.reject("novelty-1", { reason: "Datos incompletos" }, rrhhUser);

    expect(result.status).toBe("RECHAZADO");
  });

  it("impide rechazar dos veces la misma novedad (regresion)", async () => {
    repo.findById.mockResolvedValue(novelty({ status: "RECHAZADO" }));

    await expect(noveltiesService.reject("novelty-1", { reason: "otra vez" }, rrhhUser)).rejects.toMatchObject({
      statusCode: 400,
      code: "NOVELTY_STATUS_NOT_REJECTABLE",
    });
    expect(repo.reject).not.toHaveBeenCalled();
  });
});
