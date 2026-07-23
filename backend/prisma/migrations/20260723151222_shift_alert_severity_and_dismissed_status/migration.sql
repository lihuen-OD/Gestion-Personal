-- CreateEnum
CREATE TYPE "ShiftAlertSeverity" AS ENUM ('INFO', 'ADVERTENCIA', 'CRITICA');

-- AlterEnum
ALTER TYPE "ShiftAlertStatus" ADD VALUE 'DESCARTADA';

-- AlterTable
ALTER TABLE "ShiftAlert" ADD COLUMN     "severity" "ShiftAlertSeverity" NOT NULL DEFAULT 'INFO';

-- CreateIndex
CREATE INDEX "ShiftAlert_severity_status_idx" ON "ShiftAlert"("severity", "status");
