-- Franco por empleado y fecha (docs/decisions/EMPLOYEE_DAY_OFF.md).
-- Migración ADITIVA: enum y tabla nuevos, un valor nuevo en "ShiftAlertType".
-- Sin backfill: no toca fichadas, jornadas, horas, alertas ni auditoría
-- existentes. Rollback manual en ROLLBACK.md (misma carpeta).
--
-- `ALTER TYPE ... ADD VALUE` no puede usarse en la misma transacción en la que
-- se agrega; esta migración no lo usa.

-- CreateEnum
CREATE TYPE "EmployeeDayOffStatus" AS ENUM ('ACTIVO', 'CANCELADO');

-- AlterEnum
ALTER TYPE "ShiftAlertType" ADD VALUE 'ACTIVIDAD_EN_FRANCO';

-- CreateTable
CREATE TABLE "EmployeeDayOff" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "EmployeeDayOffStatus" NOT NULL DEFAULT 'ACTIVO',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeDayOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDayOff_date_status_idx" ON "EmployeeDayOff"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDayOff_employeeId_date_key" ON "EmployeeDayOff"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "EmployeeDayOff" ADD CONSTRAINT "EmployeeDayOff_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDayOff" ADD CONSTRAINT "EmployeeDayOff_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDayOff" ADD CONSTRAINT "EmployeeDayOff_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

