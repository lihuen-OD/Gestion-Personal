import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { authRepository } from "./auth.repository";
import { authService } from "./auth.service";
import { auditService } from "../audit/audit.service";

vi.mock("./auth.repository", () => ({
  authRepository: {
    findByEmailWithPassword: vi.fn(),
    findActivePublicById: vi.fn(),
    findActiveWithRefreshVersionById: vi.fn(),
    incrementRefreshTokenVersion: vi.fn(),
  },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
}));

vi.mock("jsonwebtoken", () => ({
  default: { sign: vi.fn().mockReturnValue("signed-token"), verify: vi.fn() },
}));

const repo = authRepository as unknown as {
  findByEmailWithPassword: Mock;
  findActivePublicById: Mock;
  findActiveWithRefreshVersionById: Mock;
  incrementRefreshTokenVersion: Mock;
};
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
  refreshTokenVersion: 0,
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
    expect(result.user).not.toHaveProperty("refreshTokenVersion");
    const jwt = await import("jsonwebtoken");
    expect(jwt.default.sign).toHaveBeenCalledWith(
      expect.objectContaining({ tokenUse: "refresh", refreshTokenVersion: 0 }),
      expect.any(String),
      expect.any(Object),
    );
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

describe("authService.refresh", () => {
  it("valida el refresh token, exige usuario activo y rota ambos tokens", async () => {
    const jwt = await import("jsonwebtoken");
    (jwt.default.verify as Mock).mockReturnValue({ sub: storedUser.id, tokenUse: "refresh", refreshTokenVersion: 0 });
    const { passwordHash: _passwordHash, ...safeStoredUser } = storedUser;
    repo.findActiveWithRefreshVersionById.mockResolvedValue(safeStoredUser);

    const result = await authService.refresh({ refreshToken: "refresh-token-valid" });

    expect(repo.findActiveWithRefreshVersionById).toHaveBeenCalledWith(storedUser.id);
    expect(result.user).not.toHaveProperty("refreshTokenVersion");
    expect(result).toMatchObject({ accessToken: "signed-token", refreshToken: "signed-token" });
    expect(jwt.default.sign).toHaveBeenCalledTimes(2);
  });

  it("rechaza tokens que no sean refresh", async () => {
    const jwt = await import("jsonwebtoken");
    (jwt.default.verify as Mock).mockReturnValue({ sub: storedUser.id, tokenUse: "access" });

    await expect(authService.refresh({ refreshToken: "access-token-invalid" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_REFRESH_TOKEN",
    });
    expect(repo.findActiveWithRefreshVersionById).not.toHaveBeenCalled();
  });

  it("rechaza un refresh token viejo después de logout", async () => {
    const jwt = await import("jsonwebtoken");
    (jwt.default.verify as Mock).mockReturnValue({ sub: storedUser.id, tokenUse: "refresh", refreshTokenVersion: 0 });
    repo.incrementRefreshTokenVersion.mockResolvedValue({ id: storedUser.id, refreshTokenVersion: 1 });
    repo.findActiveWithRefreshVersionById.mockResolvedValue({
      ...storedUser,
      passwordHash: undefined,
      refreshTokenVersion: 1,
    });

    await authService.logout(storedUser.id);

    await expect(authService.refresh({ refreshToken: "refresh-token-old-version" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_REFRESH_TOKEN",
    });
    expect(repo.incrementRefreshTokenVersion).toHaveBeenCalledWith(storedUser.id);
  });

  it("rechaza refresh tokens anteriores que no tienen versión", async () => {
    const jwt = await import("jsonwebtoken");
    (jwt.default.verify as Mock).mockReturnValue({ sub: storedUser.id, tokenUse: "refresh" });
    repo.findActiveWithRefreshVersionById.mockResolvedValue({
      ...storedUser,
      passwordHash: undefined,
    });

    await expect(authService.refresh({ refreshToken: "legacy-refresh-token" })).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_REFRESH_TOKEN",
    });
  });
});

describe("authService.logout", () => {
  it("incrementa refreshTokenVersion y audita el cierre", async () => {
    repo.incrementRefreshTokenVersion.mockResolvedValue({ id: storedUser.id, refreshTokenVersion: 1 });

    await expect(authService.logout(storedUser.id)).resolves.toEqual({ success: true });

    expect(repo.incrementRefreshTokenVersion).toHaveBeenCalledWith(storedUser.id);
    expect(audit.register).toHaveBeenCalledWith(expect.objectContaining({
      userId: storedUser.id,
      action: "UPDATE",
      entity: "User",
      entityId: storedUser.id,
    }));
  });
});
