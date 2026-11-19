-- Grupos de turnos (lugar / ámbito operativo principal: Planta, Granja,
-- Oficina, Taller…) — docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23 (R3.1).
-- Aditiva e inerte: tabla nueva y vacía, y una columna nullable en
-- ShiftTemplate sin default ni backfill. Ninguna plantilla se reescribe:
-- shiftGroupId = NULL significa "todavía no clasificada", nunca "inválida".
-- categoryName y ShiftAssignment no se tocan. La clasificación de las
-- plantillas existentes es una operación posterior y explícita (R3.3).
-- RESTRICT hacia ShiftGroup: borrar un grupo nunca desclasifica plantillas en
-- silencio (la aplicación lo rechaza antes; la FK es la segunda defensa).

-- AlterTable
ALTER TABLE "ShiftTemplate" ADD COLUMN     "shiftGroupId" TEXT;

-- CreateTable
CREATE TABLE "ShiftGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ShiftGroup_code_name_not_blank_check" CHECK (btrim("code") <> '' AND btrim("name") <> '')
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftGroup_code_key" ON "ShiftGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftGroup_name_key" ON "ShiftGroup"("name");

-- CreateIndex
CREATE INDEX "ShiftGroup_status_sortOrder_idx" ON "ShiftGroup"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "ShiftTemplate_shiftGroupId_idx" ON "ShiftTemplate"("shiftGroupId");

-- AddForeignKey
ALTER TABLE "ShiftGroup" ADD CONSTRAINT "ShiftGroup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftGroup" ADD CONSTRAINT "ShiftGroup_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
