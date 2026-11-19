import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createShiftGroupSchema, listShiftGroupsQuerySchema, normalizeShiftGroupText, updateShiftGroupSchema } from "./shiftGroup.schemas";
import { shiftTemplateSchema, updateShiftTemplateSchema } from "../workforce-management/workforce.schemas";

describe("normalización de código y nombre", () => {
  it("recorta extremos y colapsa espacios internos", () => {
    expect(normalizeShiftGroupText("  Medio    Ambiente ")).toBe("Medio Ambiente");
    expect(createShiftGroupSchema.parse({ code: " MA ", name: " Medio   Ambiente " })).toEqual({ code: "MA", name: "Medio Ambiente", sortOrder: 0 });
  });

  it("rechaza vacíos o demasiado cortos después de normalizar", () => {
    expect(createShiftGroupSchema.safeParse({ code: "   ", name: "Planta" }).success).toBe(false);
    expect(createShiftGroupSchema.safeParse({ code: "PL", name: " P " }).success).toBe(false);
  });

  it("sortOrder: entero entre 0 y 9999, default 0", () => {
    expect(createShiftGroupSchema.parse({ code: "PL", name: "Planta", sortOrder: "20" }).sortOrder).toBe(20);
    expect(createShiftGroupSchema.safeParse({ code: "PL", name: "Planta", sortOrder: -1 }).success).toBe(false);
    expect(createShiftGroupSchema.safeParse({ code: "PL", name: "Planta", sortOrder: 1.5 }).success).toBe(false);
  });
});

describe("edición", () => {
  it("acepta cambios parciales y estado; exige al menos un dato", () => {
    expect(updateShiftGroupSchema.parse({ status: "INACTIVO" })).toEqual({ status: "INACTIVO" });
    expect(updateShiftGroupSchema.parse({ name: " Granja " })).toEqual({ name: "Granja" });
    expect(updateShiftGroupSchema.safeParse({}).success).toBe(false);
    expect(updateShiftGroupSchema.safeParse({ status: "BORRADO" }).success).toBe(false);
  });

  it("listado: filtro de estado opcional", () => {
    expect(listShiftGroupsQuerySchema.parse({})).toEqual({});
    expect(listShiftGroupsQuerySchema.safeParse({ status: "OTRO" }).success).toBe(false);
  });
});

describe("plantillas: shiftGroupId opcional", () => {
  const base = { code: "OF-01", name: "Oficina 01", startTime: "06:30", endTime: "15:00", entryToleranceBeforeMinutes: 15, entryToleranceAfterMinutes: 15, exitToleranceBeforeMinutes: 15, exitToleranceAfterMinutes: 15 };

  it("alta sin grupo, con grupo (uuid) o con null", () => {
    expect(shiftTemplateSchema.parse(base).shiftGroupId).toBeUndefined();
    expect(shiftTemplateSchema.parse({ ...base, shiftGroupId: null }).shiftGroupId).toBeNull();
    expect(shiftTemplateSchema.parse({ ...base, shiftGroupId: "0b6f3f8e-8c1a-4a77-9d3b-2d6f2f1b9a10" }).shiftGroupId).toBe("0b6f3f8e-8c1a-4a77-9d3b-2d6f2f1b9a10");
    expect(shiftTemplateSchema.safeParse({ ...base, shiftGroupId: "planta" }).success).toBe(false);
  });

  it("edición: null desasigna; ausente no toca el grupo", () => {
    expect(updateShiftTemplateSchema.parse({ shiftGroupId: null })).toEqual({ shiftGroupId: null });
    expect(updateShiftTemplateSchema.parse({ name: "Oficina 1" })).not.toHaveProperty("shiftGroupId");
  });
});

// Guarda de la primera migración del rediseño (R3.1): puramente aditiva.
describe("migración 20261119120000_add_shift_groups", () => {
  const root = path.resolve(__dirname, "../../..");
  const sql = readFileSync(path.join(root, "prisma/migrations/20261119120000_add_shift_groups/migration.sql"), "utf8");
  const statements = sql.split("\n").filter((line) => line.trim() && !line.trim().startsWith("--")).join("\n");

  it("crea la tabla, agrega la columna nullable sin default, índices y FK RESTRICT", () => {
    expect(statements).toContain('CREATE TABLE "ShiftGroup"');
    expect(statements).toMatch(/ALTER TABLE "ShiftTemplate" ADD COLUMN\s+"shiftGroupId" TEXT;/);
    expect(statements).toContain('CREATE INDEX "ShiftGroup_status_sortOrder_idx" ON "ShiftGroup"("status", "sortOrder")');
    expect(statements).toContain('CREATE INDEX "ShiftTemplate_shiftGroupId_idx" ON "ShiftTemplate"("shiftGroupId")');
    expect(statements).toMatch(/"ShiftTemplate_shiftGroupId_fkey" FOREIGN KEY \("shiftGroupId"\) REFERENCES "ShiftGroup"\("id"\) ON DELETE RESTRICT/);
  });

  it("no reescribe ni borra datos y no toca categoryName ni ShiftAssignment", () => {
    // Ninguna sentencia de datos ni destructiva (ON DELETE/ON UPDATE de las FK no cuentan).
    expect(statements).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/im);
    expect(statements).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)\b/i);
    expect(statements).not.toContain("categoryName");
    expect(statements).not.toContain("ShiftAssignment");
    expect(statements).not.toMatch(/"shiftGroupId" TEXT NOT NULL|"shiftGroupId" TEXT DEFAULT/);
  });

  it("schema.prisma: relación opcional con onDelete Restrict", () => {
    const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/shiftGroupId\s+String\?/);
    expect(schema).toMatch(/shiftGroup\s+ShiftGroup\?\s+@relation\(fields: \[shiftGroupId\], references: \[id\], onDelete: Restrict\)/);
  });
});
