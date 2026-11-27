-- Rotaciones de turnos — docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §24 (R4.1).
-- Aditiva e INERTE: cinco tablas nuevas y vacías, dos enums y dos columnas
-- nullable en WorkShift sin default ni backfill. Ningún código las lee hasta
-- R4.2+, así que con las tablas vacías el comportamiento no cambia. No toca
-- ShiftAssignment, ShiftTemplate ni ShiftGroup (sólo reciben FKs entrantes).
--
-- Modelo: ShiftRotation (identidad estable) → ShiftRotationVersion (ciclo,
-- lunes ancla, vigencia; dueña de la grilla) → ShiftRotationSlot (celda
-- explícita SHIFT/REST por equipo, semana del ciclo y día). ShiftRotationCrew
-- (equipos estables) y ShiftRotationCrewMember (historia de pertenencia).
-- WorkShift.shiftTemplateSource / scheduledStartAt: NULL = jornada anterior
-- a R4 (lógica legacy); las filas existentes no se reescriben.
--
-- FKs: RESTRICT hacia ShiftGroup, ShiftTemplate, Employee, rotación y equipo
-- (nunca se borra historia por cascada); autoría SET NULL hacia User (regla
-- del repo). Única excepción: ShiftRotationSlot.versionId CASCADE — la grilla
-- es parte de su versión y sólo se podrá borrar una versión FUTURA (nunca
-- vigente), validado por el servicio en R4.5.
--
-- Al final, escritos a mano (Prisma no los modela ni los compara en
-- `migrate diff`): índices únicos sobre lower(code), CHECK de forma, de rangos
-- y de intervalo, y EXCLUDE de vigencias superpuestas (patrón de
-- 20261008090000_labor_history_periods y 20261119120000_add_shift_groups).

-- CreateEnum
CREATE TYPE "ShiftRotationCellKind" AS ENUM ('SHIFT', 'REST');

-- CreateEnum
CREATE TYPE "ShiftTemplateSource" AS ENUM ('FIXED_ASSIGNMENT', 'ROTATION', 'OVERRIDE', 'HOLIDAY_CONVOCATION');

-- AlterTable
ALTER TABLE "WorkShift" ADD COLUMN     "scheduledStartAt" TIMESTAMPTZ(3),
ADD COLUMN     "shiftTemplateSource" "ShiftTemplateSource";

-- CreateTable
CREATE TABLE "ShiftRotation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shiftGroupId" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "observation" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRotationVersion" (
    "id" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "cycleLengthWeeks" INTEGER NOT NULL,
    "anchorWeekStart" DATE NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftRotationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRotationCrew" (
    "id" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftRotationCrew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRotationCrewMember" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdByUserId" TEXT,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftRotationCrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRotationSlot" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "cycleWeekIndex" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "kind" "ShiftRotationCellKind" NOT NULL,
    "shiftTemplateId" TEXT,

    CONSTRAINT "ShiftRotationSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRotation_code_key" ON "ShiftRotation"("code");

-- CreateIndex
CREATE INDEX "ShiftRotation_shiftGroupId_status_idx" ON "ShiftRotation"("shiftGroupId", "status");

-- CreateIndex
CREATE INDEX "ShiftRotationVersion_rotationId_effectiveFrom_idx" ON "ShiftRotationVersion"("rotationId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRotationCrew_rotationId_code_key" ON "ShiftRotationCrew"("rotationId", "code");

-- CreateIndex
CREATE INDEX "ShiftRotationCrewMember_employeeId_effectiveFrom_idx" ON "ShiftRotationCrewMember"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShiftRotationCrewMember_crewId_idx" ON "ShiftRotationCrewMember"("crewId");

-- CreateIndex
CREATE INDEX "ShiftRotationSlot_shiftTemplateId_idx" ON "ShiftRotationSlot"("shiftTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRotationSlot_versionId_crewId_cycleWeekIndex_weekday_key" ON "ShiftRotationSlot"("versionId", "crewId", "cycleWeekIndex", "weekday");

-- AddForeignKey
ALTER TABLE "ShiftRotation" ADD CONSTRAINT "ShiftRotation_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotation" ADD CONSTRAINT "ShiftRotation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotation" ADD CONSTRAINT "ShiftRotation_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationVersion" ADD CONSTRAINT "ShiftRotationVersion_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "ShiftRotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationVersion" ADD CONSTRAINT "ShiftRotationVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationVersion" ADD CONSTRAINT "ShiftRotationVersion_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationCrew" ADD CONSTRAINT "ShiftRotationCrew_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "ShiftRotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationCrew" ADD CONSTRAINT "ShiftRotationCrew_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationCrew" ADD CONSTRAINT "ShiftRotationCrew_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationCrewMember" ADD CONSTRAINT "ShiftRotationCrewMember_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "ShiftRotationCrew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationCrewMember" ADD CONSTRAINT "ShiftRotationCrewMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationCrewMember" ADD CONSTRAINT "ShiftRotationCrewMember_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationCrewMember" ADD CONSTRAINT "ShiftRotationCrewMember_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ShiftRotationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "ShiftRotationCrew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Escrito a mano ─────────────────────────────────────────────────────────

-- Unicidad sin distinguir mayúsculas (los @unique de Prisma la distinguen):
-- código de rotación global; código de equipo dentro de su rotación. CHECK de
-- forma: al menos un carácter visible, sin espacios en los extremos ni
-- repetidos, para que variantes con espacios no esquiven el índice. Columnas
-- NOT NULL: el CHECK nunca evalúa NULL.
CREATE UNIQUE INDEX "ShiftRotation_code_lower_key" ON "ShiftRotation"(lower("code"));
CREATE UNIQUE INDEX "ShiftRotationCrew_rotationId_code_lower_key" ON "ShiftRotationCrew"("rotationId", lower("code"));
ALTER TABLE "ShiftRotation" ADD CONSTRAINT "ShiftRotation_code_shape_check" CHECK ("code" ~ '\S' AND "code" !~ '(^\s|\s$|\s\s)');
ALTER TABLE "ShiftRotationCrew" ADD CONSTRAINT "ShiftRotationCrew_code_shape_check" CHECK ("code" ~ '\S' AND "code" !~ '(^\s|\s$|\s\s)');

-- Versión: ciclo de 1 a 12 semanas; ancla en lunes (ISODOW 1 = lunes, sobre
-- DATE no depende del huso). Columnas NOT NULL.
ALTER TABLE "ShiftRotationVersion" ADD CONSTRAINT "ShiftRotationVersion_cycle_length_check" CHECK ("cycleLengthWeeks" BETWEEN 1 AND 12);
ALTER TABLE "ShiftRotationVersion" ADD CONSTRAINT "ShiftRotationVersion_anchor_monday_check" CHECK (EXTRACT(ISODOW FROM "anchorWeekStart") = 1);

-- Celda: semana del ciclo base 0 (cota global 11 por el máximo de 12
-- semanas; la cota exacta, < cycleLengthWeeks de su versión, la valida el
-- servicio) y día 0=domingo..6=sábado (convención de ShiftAssignment.weekdays).
-- SHIFT exige plantilla y REST la prohíbe ("kind" es NOT NULL).
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_cycle_week_index_check" CHECK ("cycleWeekIndex" BETWEEN 0 AND 11);
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_kind_template_check" CHECK (
  ("kind" = 'SHIFT' AND "shiftTemplateId" IS NOT NULL) OR
  ("kind" = 'REST' AND "shiftTemplateId" IS NULL)
);

-- Intervalo cerrado de días [effectiveFrom, effectiveTo]; effectiveTo NULL = abierto.
ALTER TABLE "ShiftRotationVersion" ADD CONSTRAINT "ShiftRotationVersion_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "ShiftRotationCrewMember" ADD CONSTRAINT "ShiftRotationCrewMember_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- Sin vigencias superpuestas, incluidas las futuras: una fecha resuelve a lo
-- sumo una versión por rotación y a lo sumo UNA membresía por persona en
-- TODAS las rotaciones (la exclusión es por employeeId, no por equipo ni por
-- rotación). daterange(from, NULL, '[]') es un rango sin límite superior, así
-- que una vigencia abierta se superpone con cualquier posterior. Protege
-- también ante escrituras concurrentes; el servicio validará antes con un
-- error legible. btree_gist ya existe desde M1; se repite por idempotencia.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "ShiftRotationVersion" ADD CONSTRAINT "ShiftRotationVersion_no_overlap" EXCLUDE USING gist (
  "rotationId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);
ALTER TABLE "ShiftRotationCrewMember" ADD CONSTRAINT "ShiftRotationCrewMember_no_overlap" EXCLUDE USING gist (
  "employeeId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);
