import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { usersRepository } from "./users.repository";
import { usersService } from "./users.service";
import type { CreateUserInput, UpdateUserInput } from "./users.schemas";

vi.mock("./users.repository", () => ({
  usersRepository: {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findCompany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findManyForExport: vi.fn(),
    count: vi.fn(),
    remove: vi.fn(),
    updatePassword: vi.fn(),
    setPassword: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn().mockResolvedValue(null) } }));
vi.mock("../auth/auth.service", () => ({ invalidateCurrentUserCache: vi.fn() }));

const repo = usersRepository as unknown as Record<"findById" | "findByEmail" | "findCompany" | "create" | "update", Mock>;

const createInput: CreateUserInput = {
  name: "Ana Gómez",
  email: "ana@example.com",
  password: "secreto123",
  role: "NIVEL_1_RRHH",
  status: "ACTIVO",
  companyId: "c-arch",
} as CreateUserInput;

beforeEach(() => {
  vi.clearAllMocks();
  repo.findByEmail.mockResolvedValue(null);
  repo.findCompany.mockResolvedValue(null);
});

describe("A8 §12.4 — User.companyId no puede apuntar a un registro archivado", () => {
  it("rechaza el alta con empresa archivada, sin crear ni auditar", async () => {
    repo.findCompany.mockResolvedValue({ id: "c-arch", name: "Odwyer Vieja", archivedAt: new Date("2026-10-01T00:00:00.000Z") });

    await expect(usersService.create(createInput)).rejects.toMatchObject({
      statusCode: 400,
      code: "USER_COMPANY_ARCHIVED",
      message: expect.stringContaining("Odwyer Vieja"),
    });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.findCompany).toHaveBeenCalledWith("c-arch");
  });

  it("permite el alta con empresa no archivada", async () => {
    repo.findCompany.mockResolvedValue({ id: "c-ok", name: "Odwyer", archivedAt: null });
    repo.create.mockResolvedValue({ id: "u-1", email: "ana@example.com" });

    await expect(usersService.create({ ...createInput, companyId: "c-ok" })).resolves.toMatchObject({ id: "u-1" });
    expect(repo.create).toHaveBeenCalled();
  });

  it("permite el alta sin empresa", async () => {
    repo.create.mockResolvedValue({ id: "u-2", email: "ana@example.com" });

    await expect(usersService.create({ ...createInput, companyId: null })).resolves.toMatchObject({ id: "u-2" });
    expect(repo.findCompany).not.toHaveBeenCalled();
  });

  it("rechaza en la edición cambiar a una empresa archivada, sin escribir", async () => {
    repo.findById.mockResolvedValue({ id: "u-1", email: "old@example.com", name: "Ana", role: "NIVEL_1_RRHH", status: "ACTIVO" });
    repo.findCompany.mockResolvedValue({ id: "c-arch", name: "Odwyer Vieja", archivedAt: new Date() });

    await expect(usersService.update("u-1", { companyId: "c-arch" } as UpdateUserInput)).rejects.toMatchObject({
      statusCode: 400,
      code: "USER_COMPANY_ARCHIVED",
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("una edición que no toca la empresa no consulta el chequeo de archivado", async () => {
    repo.findById.mockResolvedValue({ id: "u-1", email: "old@example.com", name: "Ana", role: "NIVEL_1_RRHH", status: "ACTIVO" });
    repo.update.mockResolvedValue({ id: "u-1", name: "Ana Renombrada" });

    await usersService.update("u-1", { name: "Ana Renombrada" } as UpdateUserInput);

    expect(repo.findCompany).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });
});
