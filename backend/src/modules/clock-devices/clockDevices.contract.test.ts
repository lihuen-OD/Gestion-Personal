import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const moduleFile = (name: string) => readFileSync(join(__dirname, name), "utf8");

describe("F5 — contrato de enrolamiento de ClockDevice", () => {
  it("mantiene separados los endpoints públicos y administrativos con límites propios", () => {
    const routes = moduleFile("clockDevices.routes.ts");
    expect(routes).toContain('"/device/register"');
    expect(routes).toContain('"/device/status"');
    expect(routes).toContain('"/device/pairing-code/refresh"');
    expect(routes).toContain('"/resolve-pairing"');
    expect(routes).toContain('"/:id/activate"');
    expect(routes).toContain('"/:id/revoke"');
    expect(routes).toContain("requireAuth, requireAnyRole(adminRoles)");
    // F5: register, status, pairing refresh, resolve-pairing. F9: heartbeat por IP y por dispositivo.
    expect(routes.match(/createRateLimiter\(\{/g)).toHaveLength(6);
  });

  it("F9: el heartbeat exige ACTIVE, tiene limitadores propios (IP antes, dispositivo después) y no audita", () => {
    const routes = moduleFile("clockDevices.routes.ts");
    const heartbeat = routes.slice(routes.indexOf('"/heartbeat"'), routes.indexOf("clockDevicesController.heartbeat"));
    const ipLimiter = heartbeat.indexOf("CLOCK_IP_RATE_LIMIT_MAX");
    const auth = heartbeat.indexOf("requireClockDevice()");
    const deviceLimiter = heartbeat.indexOf("`clock-heartbeat:${authenticatedClockDevice(req).id}`");
    expect(ipLimiter).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(ipLimiter);
    expect(deviceLimiter).toBeGreaterThan(auth);
    const service = moduleFile("clockDevices.service.ts");
    const heartbeatService = service.slice(service.indexOf("async heartbeat"), service.indexOf("async refreshPairing"));
    expect(heartbeatService).not.toContain("auditService");
    expect(routes).toContain('clockDevicesAdminRouter.patch("/:id", validateBody(updateClockDeviceSchema)');
  });

  it("ningún DTO público selecciona hashes ni secretos persistidos", () => {
    const repository = moduleFile("clockDevices.repository.ts");
    const select = repository.slice(repository.indexOf("clockDevicePublicSelect"), repository.indexOf("function whereFor"));
    expect(select).not.toMatch(/tokenHash|pairingCodeHash/);
    const schemas = moduleFile("clockDevices.schemas.ts");
    expect(schemas).not.toMatch(/tokenHash|pairingCodeHash|secret/);
  });

  it("la activación consume el código, es atómica y no toca fichadas", () => {
    const repository = moduleFile("clockDevices.repository.ts");
    expect(repository).toContain("pairingCodeHash: null");
    expect(repository).toContain("pairingExpiresAt: null");
    expect(repository).toContain('status: "ACTIVE"');
    expect(repository).not.toMatch(/attendancePunch\.(create|update|delete)/);
    expect(repository).not.toMatch(/clockPunchAttempt\.(create|update|delete)/);
  });

  it("no audita el registro público y las acciones RRHH usan texto humano", () => {
    const service = moduleFile("clockDevices.service.ts");
    const registration = service.slice(service.indexOf("async register"), service.indexOf("async status"));
    expect(registration).not.toContain("auditService");
    expect(service).toContain("Se aprobó el dispositivo de fichada");
    expect(service).toContain("Se revocó el dispositivo de fichada");
    expect(service).toContain("Se eliminó una solicitud pendiente");
  });
});
