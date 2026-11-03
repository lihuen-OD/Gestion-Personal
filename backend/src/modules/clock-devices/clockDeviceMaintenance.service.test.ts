import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashClockDeviceSecret, maintenanceCodeHash } from "../../shared/security/clockDeviceCredentials";
import { auditService } from "../audit/audit.service";
import {
  clockDeviceMaintenanceService as service,
  MAINTENANCE_CODE_MAX_FAILED_ATTEMPTS,
  MAINTENANCE_CODE_TTL_MS,
  MAINTENANCE_SESSION_TTL_MS,
} from "./clockDeviceMaintenance.service";
import { clockDevicesRepository as repository } from "./clockDevices.repository";

/**
 * Acceso de mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md): reglas
 * del servicio con el repositorio mockeado. La atomicidad del consumo, el
 * vencimiento real y las CHECK se prueban contra PostgreSQL en
 * clockDeviceMaintenance.integration.test.ts.
 */
vi.mock("./clockDevices.repository", () => ({
  clockDevicesRepository: {
    findSafeById: vi.fn(), setMaintenanceCode: vi.fn(), consumeMaintenanceCode: vi.fn(), registerFailedMaintenanceCode: vi.fn(),
    findMaintenanceSession: vi.fn(), findMaintenanceDiagnostics: vi.fn(), endMaintenanceSession: vi.fn(),
  },
}));
vi.mock("../audit/audit.service", () => ({ auditService: { register: vi.fn() } }));

const DEVICE_A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "ACTIVE" as const, name: "Pañol 01" };
const DEVICE_B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "ACTIVE" as const, name: "Recepción" };
const diagnostics = { name: "Pañol 01", status: "ACTIVE" as const, activatedAt: new Date("2026-10-20T12:00:00Z"), lastSeenAt: new Date(), lastAppVersion: "1.4.0", establishment: { name: "Planta Norte", zone: { name: "Zona Centro" } } };
const audit = { userId: null, ipAddress: "10.0.0.5", userAgent: "iPad" };
const auditCalls = () => vi.mocked(auditService.register).mock.calls.map(([input]) => input);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repository.findSafeById).mockResolvedValue({ ...DEVICE_A, establishment: null } as never);
  vi.mocked(repository.setMaintenanceCode).mockResolvedValue(true);
  vi.mocked(repository.findMaintenanceDiagnostics).mockResolvedValue(diagnostics as never);
});

describe("issueCode — RRHH genera el código", () => {
  it("6 dígitos de fuente criptográfica, vence en 5 minutos y sólo se persiste el hash ligado al dispositivo", async () => {
    const before = Date.now();
    const result = await service.issueCode(DEVICE_A.id, { userId: "rrhh-1" });

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.expiresInSeconds).toBe(MAINTENANCE_CODE_TTL_MS / 1000);
    expect(Date.parse(result.expiresAt) - before).toBeGreaterThanOrEqual(MAINTENANCE_CODE_TTL_MS - 1_000);
    const [id, hash, expiresAt] = vi.mocked(repository.setMaintenanceCode).mock.calls[0]!;
    expect(id).toBe(DEVICE_A.id);
    expect(hash).toBe(maintenanceCodeHash(DEVICE_A.id, result.code));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(result.code);
    // El mismo código en otro equipo da otro hash.
    expect(hash).not.toBe(maintenanceCodeHash(DEVICE_B.id, result.code));
    expect(expiresAt.toISOString()).toBe(result.expiresAt);
  });

  it("audita la generación con el usuario RRHH, en lenguaje humano y SIN el código", async () => {
    const result = await service.issueCode(DEVICE_A.id, { userId: "rrhh-1", ipAddress: "10.1.1.1" });
    const [entry] = auditCalls();
    expect(entry).toMatchObject({
      action: "CREATE",
      entity: "ClockDeviceMaintenance",
      entityId: DEVICE_A.id,
      userId: "rrhh-1",
      description: "Se generó un código de mantenimiento para el dispositivo de fichada “Pañol 01”. Es de un solo uso y vence en 5 minutos.",
    });
    expect(JSON.stringify(entry)).not.toContain(result.code);
  });

  it("dos códigos seguidos para el mismo equipo: el repositorio reemplaza el anterior (misma columna) con otro hash", async () => {
    const first = await service.issueCode(DEVICE_A.id);
    let second = await service.issueCode(DEVICE_A.id);
    while (second.code === first.code) second = await service.issueCode(DEVICE_A.id);
    const hashes = vi.mocked(repository.setMaintenanceCode).mock.calls.map(([, hash]) => hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it.each(["PENDING", "REVOKED"] as const)("%s → 409 CLOCK_MAINTENANCE_DEVICE_NOT_ACTIVE sin guardar ni auditar", async (status) => {
    vi.mocked(repository.findSafeById).mockResolvedValue({ ...DEVICE_A, status } as never);
    await expect(service.issueCode(DEVICE_A.id)).rejects.toMatchObject({ statusCode: 409, code: "CLOCK_MAINTENANCE_DEVICE_NOT_ACTIVE" });
    expect(repository.setMaintenanceCode).not.toHaveBeenCalled();
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("revocado entre la lectura y la escritura → 409, sin auditar", async () => {
    vi.mocked(repository.setMaintenanceCode).mockResolvedValue(false);
    await expect(service.issueCode(DEVICE_A.id)).rejects.toMatchObject({ code: "CLOCK_MAINTENANCE_DEVICE_NOT_ACTIVE" });
    expect(auditService.register).not.toHaveBeenCalled();
  });

  it("inexistente → 404 CLOCK_DEVICE_NOT_FOUND", async () => {
    vi.mocked(repository.findSafeById).mockResolvedValue(null);
    await expect(service.issueCode(DEVICE_A.id)).rejects.toMatchObject({ statusCode: 404, code: "CLOCK_DEVICE_NOT_FOUND" });
  });
});

describe("openSession — el fichador canjea el código", () => {
  it("código válido: consume con el hash del dispositivo autenticado y abre una sesión de 10 min guardando sólo el hash del token", async () => {
    vi.mocked(repository.consumeMaintenanceCode).mockResolvedValue(true);
    const result = await service.openSession(DEVICE_A, "482731", audit);

    const [id, codeHash, session, now, max] = vi.mocked(repository.consumeMaintenanceCode).mock.calls[0]!;
    expect(id).toBe(DEVICE_A.id);
    expect(codeHash).toBe(maintenanceCodeHash(DEVICE_A.id, "482731"));
    expect(max).toBe(MAINTENANCE_CODE_MAX_FAILED_ATTEMPTS);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.hash).toBe(hashClockDeviceSecret(result.token));
    expect(session.hash).not.toContain(result.token);
    expect(session.expiresAt.getTime() - now.getTime()).toBe(MAINTENANCE_SESSION_TTL_MS);
    expect(result.expiresInSeconds).toBe(MAINTENANCE_SESSION_TTL_MS / 1000);
    expect(result.device).toEqual({ ...diagnostics, connectivity: "ONLINE" });
    expect(result.device).not.toHaveProperty("id");
  });

  it("audita el ingreso con el dispositivo como actor técnico, sin código ni token", async () => {
    vi.mocked(repository.consumeMaintenanceCode).mockResolvedValue(true);
    const result = await service.openSession(DEVICE_A, "482731", audit);
    const [entry] = auditCalls();
    expect(entry).toMatchObject({
      action: "LOGIN",
      entity: "ClockDeviceMaintenance",
      entityId: DEVICE_A.id,
      userId: null,
      description: "Se ingresó al modo mantenimiento del dispositivo de fichada “Pañol 01” con un código de RRHH.",
      after: { actorClockDeviceId: DEVICE_A.id },
    });
    expect(JSON.stringify(entry)).not.toContain("482731");
    expect(JSON.stringify(entry)).not.toContain(result.token);
  });

  it("código incorrecto con uno vigente: 401 genérico y REJECT auditado (sin el código probado)", async () => {
    vi.mocked(repository.consumeMaintenanceCode).mockResolvedValue(false);
    vi.mocked(repository.registerFailedMaintenanceCode).mockResolvedValue({ failedAttempts: 1, burned: false });

    await expect(service.openSession(DEVICE_A, "000000", audit)).rejects.toMatchObject({ statusCode: 401, code: "CLOCK_MAINTENANCE_CODE_INVALID", message: "El código no es válido o ya venció." });
    const [entry] = auditCalls();
    expect(entry).toMatchObject({ action: "REJECT", entity: "ClockDeviceMaintenance", description: "Se rechazó un código de mantenimiento en el dispositivo de fichada “Pañol 01”." });
    expect(JSON.stringify(entry)).not.toContain("000000");
  });

  it("el intento que llega al máximo anula el código y lo deja dicho en la auditoría", async () => {
    vi.mocked(repository.consumeMaintenanceCode).mockResolvedValue(false);
    vi.mocked(repository.registerFailedMaintenanceCode).mockResolvedValue({ failedAttempts: MAINTENANCE_CODE_MAX_FAILED_ATTEMPTS, burned: true });

    await expect(service.openSession(DEVICE_A, "000000", audit)).rejects.toMatchObject({ code: "CLOCK_MAINTENANCE_CODE_INVALID" });
    expect(auditCalls()[0]).toMatchObject({ action: "REJECT", description: expect.stringContaining("quedó anulado por exceso de intentos"), after: { codeRevoked: true } });
  });

  it("sin código vigente (nunca generado, vencido, usado o de otro equipo): el MISMO 401 y sin AuditLog (no hay spam posible)", async () => {
    vi.mocked(repository.consumeMaintenanceCode).mockResolvedValue(false);
    vi.mocked(repository.registerFailedMaintenanceCode).mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failure = await service.openSession(DEVICE_B, "482731", audit).catch((error: unknown) => error);
    expect(failure).toMatchObject({ statusCode: 401, code: "CLOCK_MAINTENANCE_CODE_INVALID", message: "El código no es válido o ya venció." });
    expect(auditService.register).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("CLOCK_MAINTENANCE_CODE_REJECTED", { deviceId: DEVICE_B.id, reason: "NO_ACTIVE_CODE" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("482731");
    warn.mockRestore();
  });
});

describe("getSession / endSession — sesión de mantenimiento", () => {
  const TOKEN = "t".repeat(43);

  it("vigente → segundos restantes según el reloj del servidor y diagnóstico con conectividad", async () => {
    const expiresAt = new Date(Date.now() + 4 * 60_000);
    vi.mocked(repository.findMaintenanceSession).mockResolvedValue({ ...diagnostics, maintenanceSessionExpiresAt: expiresAt } as never);

    const result = await service.getSession(DEVICE_A, TOKEN);

    expect(repository.findMaintenanceSession).toHaveBeenCalledWith(DEVICE_A.id, hashClockDeviceSecret(TOKEN), expect.any(Date));
    expect(result.expiresInSeconds).toBeGreaterThan(235);
    expect(result.expiresInSeconds).toBeLessThanOrEqual(240);
    expect(result.device).toEqual({ ...diagnostics, connectivity: "ONLINE" });
    expect(result).not.toHaveProperty("device.maintenanceSessionExpiresAt");
  });

  it("vencida, cerrada o de otra sesión (el repositorio no la encuentra) → 401 CLOCK_MAINTENANCE_SESSION_INVALID", async () => {
    vi.mocked(repository.findMaintenanceSession).mockResolvedValue(null);
    await expect(service.getSession(DEVICE_A, TOKEN)).rejects.toMatchObject({ statusCode: 401, code: "CLOCK_MAINTENANCE_SESSION_INVALID" });
  });

  it.each([undefined, "", "corto", `${"t".repeat(42)}!`])("token ausente o mal formado (%s) → 401 sin consultar la base", async (token) => {
    await expect(service.getSession(DEVICE_A, token)).rejects.toMatchObject({ code: "CLOCK_MAINTENANCE_SESSION_INVALID" });
    expect(repository.findMaintenanceSession).not.toHaveBeenCalled();
  });

  it("salida manual: borra sólo la sesión de ESE token; un token mal formado no toca nada", async () => {
    await service.endSession(DEVICE_A, TOKEN);
    expect(repository.endMaintenanceSession).toHaveBeenCalledWith(DEVICE_A.id, hashClockDeviceSecret(TOKEN));
    vi.mocked(repository.endMaintenanceSession).mockClear();
    await service.endSession(DEVICE_A, "no-es-un-token");
    expect(repository.endMaintenanceSession).not.toHaveBeenCalled();
  });
});
