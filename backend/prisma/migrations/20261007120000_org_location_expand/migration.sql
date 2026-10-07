-- M1 — expansión del modelo Organización / Ubicaciones
-- (docs/decisions/ORG_LOCATION_REORGANIZATION.md §7).
--
-- No modifica datos: no hay INSERT, UPDATE ni DELETE. No es sólo aditiva:
--   * agrega Zone, PositionOrgScope, EmployeeWorkLocation(+Establishment) y
--     las columnas nulas Sector.businessUnitId, Area.sectorId,
--     Establishment.zoneId y ClockDevice.establishmentId (FKs RESTRICT);
--   * relaja Establishment.companyId a NULL (su FK sigue RESTRICT);
--   * endurece DoubleHourRule.companyId/sectorId/costCenterId/positionId de
--     ON DELETE SET NULL a RESTRICT: un NULL en esas dimensiones significa
--     "sin restricción", así que la base no debe poder ampliar una regla.
-- Las columnas del modelo anterior siguen presentes y se retiran en M2.
-- Reversión: prisma/rollbacks/20261007120000_org_location_expand.down.sql.

-- CreateEnum
CREATE TYPE "OrgScopeLevel" AS ENUM ('COMPANY', 'BUSINESS_UNIT', 'SECTOR', 'AREA');

-- DropForeignKey
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_sectorId_fkey";

-- DropForeignKey
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_costCenterId_fkey";

-- DropForeignKey
ALTER TABLE "DoubleHourRule" DROP CONSTRAINT "DoubleHourRule_positionId_fkey";

-- AlterTable
ALTER TABLE "Establishment" ADD COLUMN     "zoneId" TEXT,
ALTER COLUMN "companyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Area" ADD COLUMN     "sectorId" TEXT;

-- AlterTable
ALTER TABLE "Sector" ADD COLUMN     "businessUnitId" TEXT;

-- AlterTable
ALTER TABLE "ClockDevice" ADD COLUMN     "establishmentId" TEXT;

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionOrgScope" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "level" "OrgScopeLevel" NOT NULL,
    "companyId" TEXT,
    "businessUnitId" TEXT,
    "sectorId" TEXT,
    "areaId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionOrgScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeWorkLocation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeWorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeWorkLocationEstablishment" (
    "workLocationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,

    CONSTRAINT "EmployeeWorkLocationEstablishment_pkey" PRIMARY KEY ("workLocationId","establishmentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Zone_code_key" ON "Zone"("code");

-- CreateIndex
CREATE INDEX "Zone_status_idx" ON "Zone"("status");

-- CreateIndex
CREATE INDEX "PositionOrgScope_companyId_idx" ON "PositionOrgScope"("companyId");

-- CreateIndex
CREATE INDEX "PositionOrgScope_businessUnitId_idx" ON "PositionOrgScope"("businessUnitId");

-- CreateIndex
CREATE INDEX "PositionOrgScope_sectorId_idx" ON "PositionOrgScope"("sectorId");

-- CreateIndex
CREATE INDEX "PositionOrgScope_areaId_idx" ON "PositionOrgScope"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScope_positionId_companyId_key" ON "PositionOrgScope"("positionId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScope_positionId_businessUnitId_key" ON "PositionOrgScope"("positionId", "businessUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScope_positionId_sectorId_key" ON "PositionOrgScope"("positionId", "sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScope_positionId_areaId_key" ON "PositionOrgScope"("positionId", "areaId");

-- CreateIndex
CREATE INDEX "EmployeeWorkLocation_employeeId_zoneId_idx" ON "EmployeeWorkLocation"("employeeId", "zoneId");

-- CreateIndex
CREATE INDEX "EmployeeWorkLocation_zoneId_idx" ON "EmployeeWorkLocation"("zoneId");

-- CreateIndex
CREATE INDEX "EmployeeWorkLocationEstablishment_establishmentId_idx" ON "EmployeeWorkLocationEstablishment"("establishmentId");

-- CreateIndex
CREATE INDEX "Establishment_zoneId_idx" ON "Establishment"("zoneId");

-- CreateIndex
CREATE INDEX "Area_sectorId_idx" ON "Area"("sectorId");

-- CreateIndex
CREATE INDEX "Sector_businessUnitId_idx" ON "Sector"("businessUnitId");

-- CreateIndex
CREATE INDEX "ClockDevice_establishmentId_idx" ON "ClockDevice"("establishmentId");

-- AddForeignKey
ALTER TABLE "Establishment" ADD CONSTRAINT "Establishment_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScope" ADD CONSTRAINT "PositionOrgScope_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScope" ADD CONSTRAINT "PositionOrgScope_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScope" ADD CONSTRAINT "PositionOrgScope_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScope" ADD CONSTRAINT "PositionOrgScope_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScope" ADD CONSTRAINT "PositionOrgScope_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScope" ADD CONSTRAINT "PositionOrgScope_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkLocation" ADD CONSTRAINT "EmployeeWorkLocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkLocation" ADD CONSTRAINT "EmployeeWorkLocation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkLocation" ADD CONSTRAINT "EmployeeWorkLocation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkLocationEstablishment" ADD CONSTRAINT "EmployeeWorkLocationEstablishment_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "EmployeeWorkLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkLocationEstablishment" ADD CONSTRAINT "EmployeeWorkLocationEstablishment_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockDevice" ADD CONSTRAINT "ClockDevice_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- PositionOrgScope: exactamente una FK de destino, coincidente con `level`.
ALTER TABLE "PositionOrgScope" ADD CONSTRAINT "PositionOrgScope_level_target_check" CHECK (
  ("level" = 'COMPANY'       AND "companyId" IS NOT NULL AND "businessUnitId" IS NULL     AND "sectorId" IS NULL     AND "areaId" IS NULL) OR
  ("level" = 'BUSINESS_UNIT' AND "companyId" IS NULL     AND "businessUnitId" IS NOT NULL AND "sectorId" IS NULL     AND "areaId" IS NULL) OR
  ("level" = 'SECTOR'        AND "companyId" IS NULL     AND "businessUnitId" IS NULL     AND "sectorId" IS NOT NULL AND "areaId" IS NULL) OR
  ("level" = 'AREA'          AND "companyId" IS NULL     AND "businessUnitId" IS NULL     AND "sectorId" IS NULL     AND "areaId" IS NOT NULL)
);

-- EmployeeWorkLocation: intervalo cerrado de días [effectiveFrom, effectiveTo]
-- (effectiveTo NULL = abierto) y sin superposición para la misma persona y
-- zona, incluidas las asignaciones futuras. La exclusión protege también ante
-- escrituras concurrentes; el servicio valida antes con un error legible.
ALTER TABLE "EmployeeWorkLocation" ADD CONSTRAINT "EmployeeWorkLocation_interval_check" CHECK (
  "effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"
);

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "EmployeeWorkLocation" ADD CONSTRAINT "EmployeeWorkLocation_no_overlap" EXCLUDE USING gist (
  "employeeId" WITH =,
  "zoneId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);
