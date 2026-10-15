-- Ubicaciones: Provincia → Zona → Establecimiento → Unidad del establecimiento.
-- Migración ADITIVA: no borra ni recrea tablas ni columnas y no modifica datos.
--   * Province + Zone.provinceId (nulo): las zonas existentes quedan sin
--     provincia, pendientes de recarga; no se inventa ninguna provincia.
--   * EstablishmentUnit: unidad opcional de un establecimiento.
--   * EmployeeWorkLocationEstablishment.coverage con DEFAULT 'ESTABLISHMENT':
--     toda asignación existente queda como "establecimiento completo".
--   * EmployeeWorkLocationUnit: unidades específicas; la FK compuesta
--     (unitId, establishmentId) garantiza en la base que la unidad pertenece al
--     establecimiento asignado. Todas las FKs nuevas son ON DELETE RESTRICT;
--     las de EmployeeWorkLocationUnit además ON UPDATE RESTRICT (una unidad
--     asignada no cambia de establecimiento por arrastre).

-- CreateEnum
CREATE TYPE "WorkLocationCoverage" AS ENUM ('ESTABLISHMENT', 'UNITS');

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "provinceId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeWorkLocationEstablishment" ADD COLUMN     "coverage" "WorkLocationCoverage" NOT NULL DEFAULT 'ESTABLISHMENT';

-- CreateTable
CREATE TABLE "Province" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Province_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstablishmentUnit" (
    "id" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EstablishmentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeWorkLocationUnit" (
    "workLocationId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "EmployeeWorkLocationUnit_pkey" PRIMARY KEY ("workLocationId","unitId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Province_code_key" ON "Province"("code");

-- CreateIndex
CREATE INDEX "Province_status_idx" ON "Province"("status");

-- CreateIndex
CREATE INDEX "EstablishmentUnit_status_idx" ON "EstablishmentUnit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EstablishmentUnit_establishmentId_code_key" ON "EstablishmentUnit"("establishmentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EstablishmentUnit_id_establishmentId_key" ON "EstablishmentUnit"("id", "establishmentId");

-- CreateIndex
CREATE INDEX "EmployeeWorkLocationUnit_workLocationId_establishmentId_idx" ON "EmployeeWorkLocationUnit"("workLocationId", "establishmentId");

-- CreateIndex
CREATE INDEX "EmployeeWorkLocationUnit_unitId_establishmentId_idx" ON "EmployeeWorkLocationUnit"("unitId", "establishmentId");

-- CreateIndex
CREATE INDEX "Zone_provinceId_idx" ON "Zone"("provinceId");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentUnit" ADD CONSTRAINT "EstablishmentUnit_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeWorkLocationUnit" ADD CONSTRAINT "EmployeeWorkLocationUnit_workLocationId_establishmentId_fkey" FOREIGN KEY ("workLocationId", "establishmentId") REFERENCES "EmployeeWorkLocationEstablishment"("workLocationId", "establishmentId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EmployeeWorkLocationUnit" ADD CONSTRAINT "EmployeeWorkLocationUnit_unitId_establishmentId_fkey" FOREIGN KEY ("unitId", "establishmentId") REFERENCES "EstablishmentUnit"("id", "establishmentId") ON DELETE RESTRICT ON UPDATE RESTRICT;

