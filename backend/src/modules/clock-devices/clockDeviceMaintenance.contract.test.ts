import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Acceso de mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md):
 * contrato estructural del schema, la migración y las rutas.
 */
const read = (path: string) => readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20261026120000_add_clock_device_maintenance_access/migration.sql");
const routes = read("src/modules/clock-devices/clockDevices.routes.ts");

function publicTransportFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return publicTransportFiles(path);
    return /\.(schemas|controller|routes)\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("Mantenimiento — persistencia", () => {
  const clockDevice = schema.slice(schema.indexOf("model ClockDevice {"), schema.indexOf("model ClockPunchAttempt {"));

  it("guarda sólo hashes y vencimientos (TIMESTAMPTZ), nunca el código ni el token", () => {
    expect(clockDevice).toMatch(/^\s*maintenanceCodeHash\s+String\?\s*$/m);
    expect(clockDevice).toMatch(/^\s*maintenanceCodeExpiresAt\s+DateTime\?\s+@db\.Timestamptz\(3\)\s*$/m);
    expect(clockDevice).toMatch(/^\s*maintenanceCodeFailedAttempts\s+Int\s+@default\(0\)\s*$/m);
    expect(clockDevice).toMatch(/^\s*maintenanceSessionHash\s+String\?\s*$/m);
    expect(clockDevice).toMatch(/^\s*maintenanceSessionExpiresAt\s+DateTime\?\s+@db\.Timestamptz\(3\)\s*$/m);
    expect(clockDevice).not.toMatch(/^\s*(?:maintenanceCode|maintenanceToken|maintenanceSessionToken|maintenancePin)\s+/m);
  });

  it("la migración es aditiva y agrega las CHECK de forma y de sólo-ACTIVE", () => {
    const statements = migration.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/);
    expect(migration).toContain('"ClockDevice_maintenance_code_shape_check"');
    expect(migration).toContain('"ClockDevice_maintenance_session_shape_check"');
    expect(migration).toContain(`CHECK ("status" = 'ACTIVE' OR ("maintenanceCodeHash" IS NULL AND "maintenanceSessionHash" IS NULL))`);
  });

  it("ningún schema, controller ni ruta menciona los hashes de mantenimiento (no salen en DTOs)", () => {
    const exposures = publicTransportFiles("src").filter((path) => /maintenanceCodeHash|maintenanceSessionHash/.test(read(path)));
    expect(exposures).toEqual([]);
    const repository = read("src/modules/clock-devices/clockDevices.repository.ts");
    const publicSelect = repository.slice(repository.indexOf("export const clockDevicePublicSelect"), repository.indexOf("const clockDeviceSelfSelect"));
    expect(publicSelect).not.toMatch(/maintenance/);
  });
});

describe("Mantenimiento — rutas", () => {
  const segment = (from: string, to: string) => routes.slice(routes.indexOf(from), routes.indexOf(to, routes.indexOf(from)));

  it("canje del código: IP antes de autenticar, sólo ACTIVE, cupo propio por dispositivo y body validado, en ese orden", () => {
    const post = segment('"/maintenance/session",', "clockDevicesController.openMaintenanceSession");
    const ip = post.indexOf("maintenanceIpLimiter");
    const auth = post.indexOf("requireClockDevice()");
    const perDevice = post.indexOf("`clock-maintenance-code:${authenticatedClockDevice(req).id}`");
    const body = post.indexOf("validateBody(openMaintenanceSessionSchema)");
    expect(ip).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(ip);
    expect(perDevice).toBeGreaterThan(auth);
    expect(body).toBeGreaterThan(perDevice);
    expect(routes).toMatch(/MAINTENANCE_CODE_MAX_PER_DEVICE = 10;/);
  });

  it("lectura y cierre de sesión: sólo ACTIVE con su propio cupo por dispositivo", () => {
    const guards = segment("const maintenanceSessionGuards", "];");
    expect(guards.indexOf("requireClockDevice()")).toBeGreaterThan(guards.indexOf("maintenanceIpLimiter"));
    expect(guards).toContain("`clock-maintenance-session:${authenticatedClockDevice(req).id}`");
    expect(routes).toContain('clockDevicePublicRouter.get("/maintenance/session", ...maintenanceSessionGuards');
    expect(routes).toContain('clockDevicePublicRouter.delete("/maintenance/session", ...maintenanceSessionGuards');
  });

  it("la emisión del código es una ruta RRHH (después de requireAuth + Nivel 1) con cupo por usuario", () => {
    const adminGuard = routes.indexOf("clockDevicesAdminRouter.use(requireAuth, requireAnyRole(adminRoles))");
    const issue = routes.indexOf('clockDevicesAdminRouter.post("/:id/maintenance-code"');
    expect(issue).toBeGreaterThan(adminGuard);
    expect(routes).toContain("`clock-maintenance-issue:${req.user!.id}`");
  });
});
