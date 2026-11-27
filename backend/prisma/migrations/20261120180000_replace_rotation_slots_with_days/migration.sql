-- Rotaciones — R4.1A (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.2).
-- La especificación real de Planta (§25) tiene días con DOS bloques
-- independientes (José, viernes A: 07:00–11:00 y 19:00–07:00), que
-- ShiftRotationSlot (R4.1: una fila por versión/equipo/semana/día con una sola
-- plantilla) no puede representar. Se reemplaza por:
--   ShiftRotationDay   — un día de la grilla: REST (descanso explícito) o
--                        SHIFT (1..N bloques). Sin fila = MISSING
--                        (configuración incompleta, nunca descanso).
--   ShiftRotationBlock — un bloque laboral de un día SHIFT, en orden
--                        explícito (blockIndex), con su plantilla.
-- La FK compuesta (dayId, dayKind) → ShiftRotationDay(id, kind) con
-- dayKind = 'SHIFT' impide en la base que un día REST tenga bloques, y su
-- ON UPDATE RESTRICT impide pasar a REST un día que los tiene. Que un día
-- SHIFT tenga al menos un bloque lo valida el servicio (sin triggers).
--
-- Inerte: ShiftRotationSlot estaba vacía (verificado en development el
-- 2026-11-20; no existe en producción) y ningún código lee estas tablas. La
-- guarda de abajo aborta ANTES de cualquier DROP si tuviera alguna fila. No
-- toca ShiftRotation, ShiftRotationVersion, ShiftRotationCrew,
-- ShiftRotationCrewMember, WorkShift ni ShiftTemplate (sólo reciben FKs
-- entrantes). La migración 20261120120000_add_shift_rotations no se edita.

-- Precondición: ShiftRotationSlot vacía.
LOCK TABLE "ShiftRotationSlot" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  slots integer;
BEGIN
  SELECT count(*) INTO slots FROM "ShiftRotationSlot";
  IF slots > 0 THEN
    RAISE EXCEPTION 'Migración abortada: ShiftRotationSlot tiene % fila(s). No se reemplaza una grilla con datos; migrarla por un procedimiento explícito antes.', slots;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "ShiftRotationSlot" DROP CONSTRAINT "ShiftRotationSlot_versionId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftRotationSlot" DROP CONSTRAINT "ShiftRotationSlot_crewId_fkey";

-- DropForeignKey
ALTER TABLE "ShiftRotationSlot" DROP CONSTRAINT "ShiftRotationSlot_shiftTemplateId_fkey";

-- DropTable
DROP TABLE "ShiftRotationSlot";

-- CreateTable
CREATE TABLE "ShiftRotationDay" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "cycleWeekIndex" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "kind" "ShiftRotationCellKind" NOT NULL,

    CONSTRAINT "ShiftRotationDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRotationBlock" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "dayKind" "ShiftRotationCellKind" NOT NULL DEFAULT 'SHIFT',
    "blockIndex" INTEGER NOT NULL,
    "shiftTemplateId" TEXT NOT NULL,

    CONSTRAINT "ShiftRotationBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRotationDay_versionId_crewId_cycleWeekIndex_weekday_key" ON "ShiftRotationDay"("versionId", "crewId", "cycleWeekIndex", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRotationDay_id_kind_key" ON "ShiftRotationDay"("id", "kind");

-- CreateIndex
CREATE INDEX "ShiftRotationBlock_shiftTemplateId_idx" ON "ShiftRotationBlock"("shiftTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRotationBlock_dayId_blockIndex_key" ON "ShiftRotationBlock"("dayId", "blockIndex");

-- AddForeignKey
ALTER TABLE "ShiftRotationDay" ADD CONSTRAINT "ShiftRotationDay_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ShiftRotationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationDay" ADD CONSTRAINT "ShiftRotationDay_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "ShiftRotationCrew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRotationBlock" ADD CONSTRAINT "ShiftRotationBlock_dayId_dayKind_fkey" FOREIGN KEY ("dayId", "dayKind") REFERENCES "ShiftRotationDay"("id", "kind") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ShiftRotationBlock" ADD CONSTRAINT "ShiftRotationBlock_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Escrito a mano (Prisma no modela CHECK) ────────────────────────────────

-- Día: semana del ciclo base 0 (cota global 11 por el máximo de 12 semanas;
-- la cota exacta, < cycleLengthWeeks de su versión, la valida el servicio) y
-- día 0=domingo..6=sábado (convención de ShiftAssignment.weekdays). Columnas
-- NOT NULL.
ALTER TABLE "ShiftRotationDay" ADD CONSTRAINT "ShiftRotationDay_cycle_week_index_check" CHECK ("cycleWeekIndex" BETWEEN 0 AND 11);
ALTER TABLE "ShiftRotationDay" ADD CONSTRAINT "ShiftRotationDay_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6);

-- Bloque: sólo cuelga de días SHIFT (con la FK compuesta) y orden no negativo.
-- Columnas NOT NULL.
ALTER TABLE "ShiftRotationBlock" ADD CONSTRAINT "ShiftRotationBlock_day_kind_check" CHECK ("dayKind" = 'SHIFT');
ALTER TABLE "ShiftRotationBlock" ADD CONSTRAINT "ShiftRotationBlock_block_index_check" CHECK ("blockIndex" >= 0);
