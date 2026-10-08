-- D-5 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §19): historia temporal,
-- consultable por fecha, de las entradas mutables del motor de horas
-- especiales. Migración ADITIVA: sólo crea tablas, índices, FKs y
-- restricciones nuevas; no modifica columnas ni datos existentes. No
-- inicializa historia de legajos ni puestos existentes (§19.4).
-- Generada con `prisma migrate diff` sin conexión y completada a mano con los
-- CHECK y exclusiones del final (Prisma no los modela).

-- CreateTable
CREATE TABLE "EmployeePositionPeriod" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "positionId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeePositionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCostCenterPeriod" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeCostCenterPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLegacySectorPeriod" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sectorId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeLegacySectorPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeEmployerPeriod" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeEmployerPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeEmployerPeriodCompany" (
    "periodId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "EmployeeEmployerPeriodCompany_pkey" PRIMARY KEY ("periodId","companyId")
);

-- CreateTable
CREATE TABLE "PositionOrgScopePeriod" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PositionOrgScopePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionOrgScopePeriodNode" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "level" "OrgScopeLevel" NOT NULL,
    "companyId" TEXT,
    "businessUnitId" TEXT,
    "sectorId" TEXT,
    "areaId" TEXT,
    "areaSectorId" TEXT,

    CONSTRAINT "PositionOrgScopePeriodNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeePositionPeriod_employeeId_effectiveFrom_idx" ON "EmployeePositionPeriod"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeePositionPeriod_positionId_effectiveFrom_idx" ON "EmployeePositionPeriod"("positionId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeCostCenterPeriod_employeeId_effectiveFrom_idx" ON "EmployeeCostCenterPeriod"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeCostCenterPeriod_costCenterId_idx" ON "EmployeeCostCenterPeriod"("costCenterId");

-- CreateIndex
CREATE INDEX "EmployeeLegacySectorPeriod_employeeId_effectiveFrom_idx" ON "EmployeeLegacySectorPeriod"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeLegacySectorPeriod_sectorId_idx" ON "EmployeeLegacySectorPeriod"("sectorId");

-- CreateIndex
CREATE INDEX "EmployeeEmployerPeriod_employeeId_effectiveFrom_idx" ON "EmployeeEmployerPeriod"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeEmployerPeriodCompany_companyId_idx" ON "EmployeeEmployerPeriodCompany"("companyId");

-- CreateIndex
CREATE INDEX "PositionOrgScopePeriod_positionId_effectiveFrom_idx" ON "PositionOrgScopePeriod"("positionId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PositionOrgScopePeriodNode_companyId_idx" ON "PositionOrgScopePeriodNode"("companyId");

-- CreateIndex
CREATE INDEX "PositionOrgScopePeriodNode_businessUnitId_idx" ON "PositionOrgScopePeriodNode"("businessUnitId");

-- CreateIndex
CREATE INDEX "PositionOrgScopePeriodNode_sectorId_idx" ON "PositionOrgScopePeriodNode"("sectorId");

-- CreateIndex
CREATE INDEX "PositionOrgScopePeriodNode_areaId_idx" ON "PositionOrgScopePeriodNode"("areaId");

-- CreateIndex
CREATE INDEX "PositionOrgScopePeriodNode_areaSectorId_idx" ON "PositionOrgScopePeriodNode"("areaSectorId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScopePeriodNode_periodId_companyId_key" ON "PositionOrgScopePeriodNode"("periodId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScopePeriodNode_periodId_businessUnitId_key" ON "PositionOrgScopePeriodNode"("periodId", "businessUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScopePeriodNode_periodId_sectorId_key" ON "PositionOrgScopePeriodNode"("periodId", "sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionOrgScopePeriodNode_periodId_areaId_key" ON "PositionOrgScopePeriodNode"("periodId", "areaId");

-- AddForeignKey
ALTER TABLE "EmployeePositionPeriod" ADD CONSTRAINT "EmployeePositionPeriod_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePositionPeriod" ADD CONSTRAINT "EmployeePositionPeriod_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePositionPeriod" ADD CONSTRAINT "EmployeePositionPeriod_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCostCenterPeriod" ADD CONSTRAINT "EmployeeCostCenterPeriod_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCostCenterPeriod" ADD CONSTRAINT "EmployeeCostCenterPeriod_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCostCenterPeriod" ADD CONSTRAINT "EmployeeCostCenterPeriod_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLegacySectorPeriod" ADD CONSTRAINT "EmployeeLegacySectorPeriod_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLegacySectorPeriod" ADD CONSTRAINT "EmployeeLegacySectorPeriod_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLegacySectorPeriod" ADD CONSTRAINT "EmployeeLegacySectorPeriod_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEmployerPeriod" ADD CONSTRAINT "EmployeeEmployerPeriod_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEmployerPeriod" ADD CONSTRAINT "EmployeeEmployerPeriod_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEmployerPeriodCompany" ADD CONSTRAINT "EmployeeEmployerPeriodCompany_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "EmployeeEmployerPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEmployerPeriodCompany" ADD CONSTRAINT "EmployeeEmployerPeriodCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriod" ADD CONSTRAINT "PositionOrgScopePeriod_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriod" ADD CONSTRAINT "PositionOrgScopePeriod_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriodNode" ADD CONSTRAINT "PositionOrgScopePeriodNode_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PositionOrgScopePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriodNode" ADD CONSTRAINT "PositionOrgScopePeriodNode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriodNode" ADD CONSTRAINT "PositionOrgScopePeriodNode_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriodNode" ADD CONSTRAINT "PositionOrgScopePeriodNode_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriodNode" ADD CONSTRAINT "PositionOrgScopePeriodNode_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionOrgScopePeriodNode" ADD CONSTRAINT "PositionOrgScopePeriodNode_areaSectorId_fkey" FOREIGN KEY ("areaSectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Intervalo cerrado de días [effectiveFrom, effectiveTo]; effectiveTo NULL = abierto.
ALTER TABLE "EmployeePositionPeriod" ADD CONSTRAINT "EmployeePositionPeriod_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "EmployeeCostCenterPeriod" ADD CONSTRAINT "EmployeeCostCenterPeriod_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "EmployeeLegacySectorPeriod" ADD CONSTRAINT "EmployeeLegacySectorPeriod_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "EmployeeEmployerPeriod" ADD CONSTRAINT "EmployeeEmployerPeriod_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "PositionOrgScopePeriod" ADD CONSTRAINT "PositionOrgScopePeriod_interval_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- Sin vigencias superpuestas del mismo legajo (o puesto) en cada dimensión,
-- incluidas las futuras: una fecha resuelve a lo sumo una vigencia. Protege
-- también ante escrituras concurrentes; el servicio valida antes con un error
-- legible. btree_gist ya existe desde M1; se repite por idempotencia.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "EmployeePositionPeriod" ADD CONSTRAINT "EmployeePositionPeriod_no_overlap" EXCLUDE USING gist (
  "employeeId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);
ALTER TABLE "EmployeeCostCenterPeriod" ADD CONSTRAINT "EmployeeCostCenterPeriod_no_overlap" EXCLUDE USING gist (
  "employeeId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);
ALTER TABLE "EmployeeLegacySectorPeriod" ADD CONSTRAINT "EmployeeLegacySectorPeriod_no_overlap" EXCLUDE USING gist (
  "employeeId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);
ALTER TABLE "EmployeeEmployerPeriod" ADD CONSTRAINT "EmployeeEmployerPeriod_no_overlap" EXCLUDE USING gist (
  "employeeId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);
ALTER TABLE "PositionOrgScopePeriod" ADD CONSTRAINT "PositionOrgScopePeriod_no_overlap" EXCLUDE USING gist (
  "positionId" WITH =,
  daterange("effectiveFrom", "effectiveTo", '[]') WITH &&
);

-- Nodo de alcance histórico: exactamente una FK de destino coincidente con
-- `level` (igual que PositionOrgScope) y el sector padre del área sólo en AREA.
ALTER TABLE "PositionOrgScopePeriodNode" ADD CONSTRAINT "PositionOrgScopePeriodNode_level_target_check" CHECK (
  ("level" = 'COMPANY'       AND "companyId" IS NOT NULL AND "businessUnitId" IS NULL     AND "sectorId" IS NULL     AND "areaId" IS NULL     AND "areaSectorId" IS NULL) OR
  ("level" = 'BUSINESS_UNIT' AND "companyId" IS NULL     AND "businessUnitId" IS NOT NULL AND "sectorId" IS NULL     AND "areaId" IS NULL     AND "areaSectorId" IS NULL) OR
  ("level" = 'SECTOR'        AND "companyId" IS NULL     AND "businessUnitId" IS NULL     AND "sectorId" IS NOT NULL AND "areaId" IS NULL     AND "areaSectorId" IS NULL) OR
  ("level" = 'AREA'          AND "companyId" IS NULL     AND "businessUnitId" IS NULL     AND "sectorId" IS NULL     AND "areaId" IS NOT NULL AND "areaSectorId" IS NOT NULL)
);
