import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas estáticas de R4.1 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §24):
 * la migración de rotaciones es aditiva e inerte, conserva los constraints
 * escritos a mano que Prisma no modela (y que `migrate diff` no compara), y
 * su rollback no destruye datos en silencio. El comportamiento real de cada
 * constraint se validó contra PostgreSQL 18 en una base local limpia (ADR §24.18).
 */
const MIGRATION = "20261120120000_add_shift_rotations";
const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const withoutComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("--"))
    .join("\n");

const sql = withoutComments(read(`prisma/migrations/${MIGRATION}/migration.sql`));
const rollback = read(`prisma/rollbacks/${MIGRATION}.down.sql`);
const rollbackStatements = withoutComments(rollback);
const schema = read("prisma/schema.prisma");

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, "m"));
  if (!match) throw new Error(`No se encontró el modelo ${name}`);
  return match[0];
}

describe(`migración ${MIGRATION}: aditiva e inerte`, () => {
  it("no tiene sentencias de datos ni destructivas", () => {
    // ON DELETE/ON UPDATE de las FK no cuentan: se buscan sentencias.
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/im);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
  });

  it("no toca ShiftAssignment ni modifica columnas de ShiftTemplate/ShiftGroup (sólo FKs entrantes)", () => {
    expect(sql).not.toContain('"ShiftAssignment"');
    expect(sql).not.toMatch(/ALTER TABLE "(ShiftTemplate|ShiftGroup|Employee|User)"/);
  });

  it("crea los dos enums y las cinco tablas", () => {
    expect(sql).toContain(`CREATE TYPE "ShiftRotationCellKind" AS ENUM ('SHIFT', 'REST');`);
    expect(sql).toContain(`CREATE TYPE "ShiftTemplateSource" AS ENUM ('FIXED_ASSIGNMENT', 'ROTATION', 'OVERRIDE', 'HOLIDAY_CONVOCATION');`);
    for (const table of ["ShiftRotation", "ShiftRotationVersion", "ShiftRotationCrew", "ShiftRotationCrewMember", "ShiftRotationSlot"]) {
      expect(sql).toContain(`CREATE TABLE "${table}" (`);
    }
  });

  it("btree_gist sólo con IF NOT EXISTS (ya existe desde M1)", () => {
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist;");
    expect(sql).not.toMatch(/CREATE EXTENSION (?!IF NOT EXISTS)/);
  });
});

describe("ShiftRotation", () => {
  it("grupo obligatorio con FK RESTRICT e índice (shiftGroupId, status)", () => {
    expect(sql).toMatch(/"shiftGroupId" TEXT NOT NULL,/);
    expect(sql).toContain(`"ShiftRotation_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup"("id") ON DELETE RESTRICT`);
    expect(sql).toContain(`CREATE INDEX "ShiftRotation_shiftGroupId_status_idx" ON "ShiftRotation"("shiftGroupId", "status");`);
  });

  it("code único exacto, único sin mayúsculas y con CHECK de forma; name sin unicidad", () => {
    expect(sql).toContain(`CREATE UNIQUE INDEX "ShiftRotation_code_key" ON "ShiftRotation"("code");`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "ShiftRotation_code_lower_key" ON "ShiftRotation"(lower("code"));`);
    expect(sql).toContain(`"ShiftRotation_code_shape_check" CHECK ("code" ~ '\\S' AND "code" !~ '(^\\s|\\s$|\\s\\s)')`);
    expect(sql).not.toMatch(/ON "ShiftRotation"\((lower\()?"name"/);
  });
});

describe("ShiftRotationVersion", () => {
  it("ciclo 1..12 y ancla en lunes", () => {
    expect(sql).toContain(`"ShiftRotationVersion_cycle_length_check" CHECK ("cycleLengthWeeks" BETWEEN 1 AND 12)`);
    expect(sql).toContain(`"ShiftRotationVersion_anchor_monday_check" CHECK (EXTRACT(ISODOW FROM "anchorWeekStart") = 1)`);
    expect(sql).toMatch(/"anchorWeekStart" DATE NOT NULL,/);
  });

  it("vigencia DATE con intervalo válido (effectiveTo NULL = abierta)", () => {
    expect(sql).toMatch(/"effectiveFrom" DATE NOT NULL,\s+"effectiveTo" DATE,/);
    expect(sql).toContain(`"ShiftRotationVersion_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")`);
  });

  it("EXCLUDE: sin versiones superpuestas de la misma rotación (rango inclusivo)", () => {
    expect(sql).toMatch(
      /"ShiftRotationVersion_no_overlap" EXCLUDE USING gist \(\s*"rotationId" WITH =,\s*daterange\("effectiveFrom", "effectiveTo", '\[\]'\) WITH &&\s*\)/,
    );
  });

  it("FK a la rotación RESTRICT", () => {
    expect(sql).toContain(`"ShiftRotationVersion_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "ShiftRotation"("id") ON DELETE RESTRICT`);
  });
});

describe("ShiftRotationCrew", () => {
  it("único dentro de la rotación, exacto y sin mayúsculas; nunca global", () => {
    expect(sql).toContain(`CREATE UNIQUE INDEX "ShiftRotationCrew_rotationId_code_key" ON "ShiftRotationCrew"("rotationId", "code");`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "ShiftRotationCrew_rotationId_code_lower_key" ON "ShiftRotationCrew"("rotationId", lower("code"));`);
    expect(sql).not.toMatch(/ON "ShiftRotationCrew"\((lower\()?"code"/);
    expect(sql).toContain(`"ShiftRotationCrew_code_shape_check" CHECK (`);
  });

  it("FK a la rotación RESTRICT", () => {
    expect(sql).toContain(`"ShiftRotationCrew_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "ShiftRotation"("id") ON DELETE RESTRICT`);
  });
});

describe("ShiftRotationCrewMember", () => {
  it("vigencia DATE con intervalo válido", () => {
    expect(sql).toContain(`"ShiftRotationCrewMember_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")`);
  });

  it("EXCLUDE GLOBAL por employeeId (no por equipo ni por rotación)", () => {
    expect(sql).toMatch(
      /"ShiftRotationCrewMember_no_overlap" EXCLUDE USING gist \(\s*"employeeId" WITH =,\s*daterange\("effectiveFrom", "effectiveTo", '\[\]'\) WITH &&\s*\)/,
    );
  });

  it("FKs a Employee y al equipo RESTRICT (nunca cascada sobre historia); autoría SET NULL", () => {
    expect(sql).toContain(`"ShiftRotationCrewMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT`);
    expect(sql).toContain(`"ShiftRotationCrewMember_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "ShiftRotationCrew"("id") ON DELETE RESTRICT`);
    expect(sql).toContain(`"ShiftRotationCrewMember_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL`);
    expect(sql).toContain(`CREATE INDEX "ShiftRotationCrewMember_employeeId_effectiveFrom_idx"`);
    expect(sql).toContain(`CREATE INDEX "ShiftRotationCrewMember_crewId_idx"`);
  });
});

describe("ShiftRotationSlot", () => {
  it("semana del ciclo >= 0 (cota global 11) y día 0..6", () => {
    expect(sql).toContain(`"ShiftRotationSlot_cycle_week_index_check" CHECK ("cycleWeekIndex" BETWEEN 0 AND 11)`);
    expect(sql).toContain(`"ShiftRotationSlot_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6)`);
  });

  it("una celda por versión/equipo/semana/día", () => {
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "ShiftRotationSlot_versionId_crewId_cycleWeekIndex_weekday_key" ON "ShiftRotationSlot"("versionId", "crewId", "cycleWeekIndex", "weekday");`,
    );
  });

  it("SHIFT exige plantilla y REST la prohíbe; kind NOT NULL", () => {
    expect(sql).toMatch(/"kind" "ShiftRotationCellKind" NOT NULL,/);
    expect(sql).toMatch(
      /"ShiftRotationSlot_kind_template_check" CHECK \(\s*\("kind" = 'SHIFT' AND "shiftTemplateId" IS NOT NULL\) OR\s*\("kind" = 'REST' AND "shiftTemplateId" IS NULL\)\s*\)/,
    );
  });

  it("versión CASCADE (grilla de la versión); equipo y plantilla RESTRICT", () => {
    expect(sql).toContain(`"ShiftRotationSlot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ShiftRotationVersion"("id") ON DELETE CASCADE`);
    expect(sql).toContain(`"ShiftRotationSlot_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "ShiftRotationCrew"("id") ON DELETE RESTRICT`);
    expect(sql).toContain(`"ShiftRotationSlot_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT`);
    expect(sql).toContain(`CREATE INDEX "ShiftRotationSlot_shiftTemplateId_idx" ON "ShiftRotationSlot"("shiftTemplateId");`);
  });

  it("la única cascada de la migración es la de la grilla", () => {
    expect(sql.match(/ON DELETE CASCADE/g)).toHaveLength(1);
  });
});

describe("WorkShift: dos columnas nullable, sin default ni backfill", () => {
  it("migración", () => {
    expect(sql).toMatch(/ALTER TABLE "WorkShift" ADD COLUMN\s+"scheduledStartAt" TIMESTAMPTZ\(3\),\s+ADD COLUMN\s+"shiftTemplateSource" "ShiftTemplateSource";/);
    expect(sql).not.toMatch(/"(scheduledStartAt|shiftTemplateSource)"[^,\n;]*(NOT NULL|DEFAULT)/);
  });

  it("schema.prisma", () => {
    const workShift = modelBlock("WorkShift");
    expect(workShift).toMatch(/shiftTemplateSource\s+ShiftTemplateSource\?/);
    expect(workShift).toMatch(/scheduledStartAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  });
});

describe("schema.prisma: relaciones y onDelete", () => {
  it("rotación: grupo obligatorio RESTRICT", () => {
    expect(modelBlock("ShiftRotation")).toMatch(/shiftGroup\s+ShiftGroup\s+@relation\(fields: \[shiftGroupId\], references: \[id\], onDelete: Restrict\)/);
  });

  it("membresía: empleado y equipo RESTRICT", () => {
    const member = modelBlock("ShiftRotationCrewMember");
    expect(member).toMatch(/employee\s+Employee\s+@relation\(fields: \[employeeId\], references: \[id\], onDelete: Restrict\)/);
    expect(member).toMatch(/crew\s+ShiftRotationCrew\s+@relation\(fields: \[crewId\], references: \[id\], onDelete: Restrict\)/);
  });

  it("celda: versión Cascade; equipo y plantilla Restrict", () => {
    const slot = modelBlock("ShiftRotationSlot");
    expect(slot).toMatch(/version\s+ShiftRotationVersion\s+@relation\(fields: \[versionId\], references: \[id\], onDelete: Cascade\)/);
    expect(slot).toMatch(/crew\s+ShiftRotationCrew\s+@relation\(fields: \[crewId\], references: \[id\], onDelete: Restrict\)/);
    expect(slot).toMatch(/shiftTemplate\s+ShiftTemplate\?\s+@relation\(fields: \[shiftTemplateId\], references: \[id\], onDelete: Restrict\)/);
  });

  it("autoría siempre SET NULL hacia User, nunca Cascade", () => {
    for (const model of ["ShiftRotation", "ShiftRotationVersion", "ShiftRotationCrew", "ShiftRotationCrewMember"]) {
      const userRelations = modelBlock(model).match(/User\?\s+@relation\([^)]*\)/g) ?? [];
      expect(userRelations.length).toBeGreaterThan(0);
      for (const relation of userRelations) expect(relation).toContain("onDelete: SetNull");
    }
  });
});

describe(`rollback ${MIGRATION}`, () => {
  it("una transacción que bloquea las tablas antes de comprobar", () => {
    expect(rollbackStatements).toMatch(/^BEGIN;/m);
    expect(rollbackStatements).toMatch(/COMMIT;\s*$/);
    expect(rollbackStatements).toContain(
      `LOCK TABLE "ShiftRotationSlot", "ShiftRotationCrewMember", "ShiftRotationCrew", "ShiftRotationVersion", "ShiftRotation", "WorkShift" IN ACCESS EXCLUSIVE MODE;`,
    );
    expect(rollbackStatements.indexOf("LOCK TABLE")).toBeLessThan(rollbackStatements.indexOf("RAISE EXCEPTION"));
  });

  it("aborta si hay cualquier dato de rotaciones o jornadas con fuente/inicio programado", () => {
    for (const table of ["ShiftRotation", "ShiftRotationVersion", "ShiftRotationCrew", "ShiftRotationCrewMember", "ShiftRotationSlot"]) {
      expect(rollbackStatements).toContain(`FROM "${table}";`);
    }
    expect(rollbackStatements).toContain(`FROM "WorkShift" WHERE "shiftTemplateSource" IS NOT NULL;`);
    expect(rollbackStatements).toContain(`FROM "WorkShift" WHERE "scheduledStartAt" IS NOT NULL;`);
  });

  it("toda destrucción ocurre después de las guardas, y nunca borra datos fila a fila ni la extensión", () => {
    const guard = rollbackStatements.indexOf("END $$;");
    const firstDrop = rollbackStatements.search(/\bDROP\b/);
    expect(guard).toBeGreaterThan(0);
    expect(firstDrop).toBeGreaterThan(guard);
    expect(rollbackStatements).not.toMatch(/^\s*(DELETE|UPDATE|TRUNCATE)\b/im);
    expect(rollbackStatements).not.toMatch(/DROP EXTENSION/i);
    expect(rollbackStatements).not.toMatch(/CASCADE/i);
  });
});
