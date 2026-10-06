import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261006150000_add_clock_device/migration.sql", "utf8");

function block(start: string, next: string) {
  const from = schema.indexOf(start);
  const to = schema.indexOf(next, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return schema.slice(from, to);
}

function publicTransportFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return publicTransportFiles(path);
    return /\.(schemas|controller|routes)\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("F4 ClockDevice — contrato estructural", () => {
  const clockDevice = block("model ClockDevice {", "model ClockPunchAttempt {");
  const attendancePunch = block("model AttendancePunch {", "model ClockDevice {");
  const clockPunchAttempt = block("model ClockPunchAttempt {", "model JobCheckpoint {");

  it("mantiene el ciclo de vida exacto PENDING / ACTIVE / REVOKED", () => {
    const status = block("enum ClockDeviceStatus {", "enum StorageProvider {");
    const values = [...status.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*$/gm)].map((match) => match[1]);
    expect(values).toEqual(["PENDING", "ACTIVE", "REVOKED"]);
  });

  it("persiste sólo hashes únicos y nunca un secreto de dispositivo en claro", () => {
    expect(clockDevice).toMatch(/^\s*tokenHash\s+String\s+@unique\s*$/m);
    expect(clockDevice).toMatch(/^\s*pairingCodeHash\s+String\?\s+@unique\s*$/m);
    expect(clockDevice).toMatch(/^\s*pairingExpiresAt\s+DateTime\?/m);
    expect(clockDevice).not.toMatch(/^\s*(?:deviceSecret|tokenSecret|secret|pairingCode)\s+/m);
  });

  it("no expone pairingCodeHash en DTOs ni handlers públicos", () => {
    const exposures = publicTransportFiles("src")
      .filter((path) => readFileSync(path, "utf8").includes("pairingCodeHash"));
    expect(exposures).toEqual([]);
  });

  it("mantiene deviceId nullable en fichadas e intentos y conserva kioskId", () => {
    expect(attendancePunch).toMatch(/^\s*deviceId\s+String\?\s*$/m);
    expect(attendancePunch).toMatch(/^\s*kioskId\s+String\?\s*$/m);
    expect(clockPunchAttempt).toMatch(/^\s*deviceId\s+String\?\s*$/m);
  });

  it("usa Restrict para historia y SetNull para Sector y autoría", () => {
    expect(attendancePunch).toMatch(/device\s+ClockDevice\?.*onDelete: Restrict/);
    expect(clockPunchAttempt).toMatch(/device\s+ClockDevice\?.*onDelete: Restrict/);
    expect(clockDevice).toMatch(/sector\s+Sector\?.*onDelete: SetNull/);
    expect(clockDevice).toMatch(/activatedBy\s+User\?.*onDelete: SetNull/);
    expect(clockDevice).toMatch(/revokedBy\s+User\?.*onDelete: SetNull/);
  });

  it("agrega los índices de trazabilidad por dispositivo", () => {
    expect(attendancePunch).toContain("@@index([deviceId, timestamp])");
    expect(clockPunchAttempt).toContain("@@index([deviceId, startedAt])");
  });
});

describe("F4 ClockDevice — migración aditiva", () => {
  it("aborta ante deviceId o kioskId históricos antes de crear estructura", () => {
    const guardEnd = migration.indexOf("-- CreateEnum");
    const guard = migration.slice(0, guardEnd);
    expect(guard).toContain('WHERE "deviceId" IS NOT NULL');
    expect(guard).toContain('WHERE "kioskId" IS NOT NULL');
    expect(guard).toContain("IF with_device > 0 OR with_kiosk > 0");
    expect(guard).toContain("no se crean dispositivos históricos");
  });

  it("crea columnas, índices y FKs con las políticas aprobadas", () => {
    expect(migration).toContain('ALTER TABLE "ClockPunchAttempt" ADD COLUMN "deviceId" TEXT');
    expect(migration).toContain('CREATE INDEX "AttendancePunch_deviceId_timestamp_idx"');
    expect(migration).toContain('CREATE INDEX "ClockPunchAttempt_deviceId_startedAt_idx"');
    expect(migration).toMatch(/AttendancePunch_deviceId_fkey[\s\S]*ON DELETE RESTRICT/);
    expect(migration).toMatch(/ClockPunchAttempt_deviceId_fkey[\s\S]*ON DELETE RESTRICT/);
    expect(migration).toMatch(/ClockDevice_sectorId_fkey[\s\S]*ON DELETE SET NULL/);
    expect(migration).toMatch(/ClockDevice_activatedByUserId_fkey[\s\S]*ON DELETE SET NULL/);
    expect(migration).toMatch(/ClockDevice_revokedByUserId_fkey[\s\S]*ON DELETE SET NULL/);
  });

  it("no inventa dispositivos, no hace backfill ni cambia source", () => {
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+"?(?:AttendancePunch|ClockPunchAttempt|ClockDevice)"?\b/i);
    expect(migration).not.toMatch(/(?:DROP\s+COLUMN|RENAME\s+COLUMN)[\s\S]*"kioskId"/i);
    expect(migration).not.toMatch(/"source"\s*=/i);
  });
});
