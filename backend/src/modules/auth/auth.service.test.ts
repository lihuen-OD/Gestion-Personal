import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { authRepository } from "./auth.repository";
import { authService } from "./auth.service";
import { auditService } from "../audit/audit.service";

vi.mock("./auth.repository", () => ({
  authRepository: {
    findByEmailWithPassword: vi.fn(),
    findActivePublicById: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
}));

vi.mock("jsonwebtoken", () => ({
  default: { sign: vi.fn().mockReturnValue("signed-token") },
}));

const repo = authRepository as unknown as { findByEmailWithPassword: Mock; findActivePublicById: Mock };
const audit = auditService as unknown as { register: Mock };

const storedUser = {
  id: "user-1",
  name: "Ana Gomez",
  email: "ana@example.com",
  role: "NIVEL_1_RRHH",
  status: "ACTIVO",
  companyId: null,
  sectorId: null,
  passwordHash: "hashed",
};

beforeEach(async () => {
  vi.clearAllMocks();
  const bcrypt = await import("bcryptjs");
  (bcrypt.default.compare as Mock).mockResolvedValue(true);
});

describe("authService.login", () => {
  it("en un login exitoso audita LOGIN con el userId correcto y nunca expone passwordHash", async () => {
    repo.findByEmailWithPassword.mockResolvedValue(storedUser);

    const result = await authService.login({ email: "ana@example.com", password: "correcta" });

    expect(result.user).not.toHaveProperty("passwordHash");
    expect(audit.register).toHaveBeenCalledWith(
      expect.objectContaining({ userId: storedUser.id, action: "LOGIN", entity: "User", entityId: storedUser.id }),
    );
  });

  it("si el usuario no existe, audita el intento fallido y lanza INVALID_CREDENTIALS", async () => {
    repo.findByEmailWithPassword.mockResolvedValue(null);

    await expect(authService.login({ email: "nadie@example.com", password: "x" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
    });
    expect(audit.register).toHaveBeenCalledWith(expect.objectContaining({ action: "LOGIN", userId: null }));
  });

  it("si el usuario esta inactivo, audita el intento fallido y lanza INVALID_CREDENTIALS", async () => {
    repo.findByEmailWithPassword.mockResolvedValue({ ...storedUser, status: "INACTIVO" });

    await expect(authService.login({ email: storedUser.email, password: "correcta" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
    });
    expect(audit.register).toHaveBeenCalledWith(expect.objectContaining({ action: "LOGIN", userId: null }));
  });

  it("si la contrasena es incorrecta, audita el intento fallido (con el userId conocido) y lanza INVALID_CREDENTIALS", async () => {
    repo.findByEmailWithPassword.mockResolvedValue(storedUser);
    const bcrypt = await import("bcryptjs");
    (bcrypt.default.compare as Mock).mockResolvedValue(false);

    await expect(authService.login({ email: storedUser.email, password: "incorrecta" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
    });
    expect(audit.register).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN", userId: null, entityId: storedUser.id }),
    );
  });
});
