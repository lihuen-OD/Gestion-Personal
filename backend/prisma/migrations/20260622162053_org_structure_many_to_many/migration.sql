-- CreateTable
CREATE TABLE "BusinessUnitCompany" (
    "businessUnitId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "BusinessUnitCompany_pkey" PRIMARY KEY ("businessUnitId","companyId")
);

-- CreateTable
CREATE TABLE "EstablishmentCompany" (
    "establishmentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "EstablishmentCompany_pkey" PRIMARY KEY ("establishmentId","companyId")
);

-- CreateTable
CREATE TABLE "EstablishmentBusinessUnit" (
    "establishmentId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,

    CONSTRAINT "EstablishmentBusinessUnit_pkey" PRIMARY KEY ("establishmentId","businessUnitId")
);

-- CreateTable
CREATE TABLE "AreaBusinessUnit" (
    "areaId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,

    CONSTRAINT "AreaBusinessUnit_pkey" PRIMARY KEY ("areaId","businessUnitId")
);

-- CreateTable
CREATE TABLE "AreaEstablishment" (
    "areaId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,

    CONSTRAINT "AreaEstablishment_pkey" PRIMARY KEY ("areaId","establishmentId")
);

-- CreateTable
CREATE TABLE "SectorArea" (
    "sectorId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,

    CONSTRAINT "SectorArea_pkey" PRIMARY KEY ("sectorId","areaId")
);

-- CreateTable
CREATE TABLE "SectorEstablishment" (
    "sectorId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,

    CONSTRAINT "SectorEstablishment_pkey" PRIMARY KEY ("sectorId","establishmentId")
);

-- CreateTable
CREATE TABLE "CostCenterCompany" (
    "costCenterId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "CostCenterCompany_pkey" PRIMARY KEY ("costCenterId","companyId")
);

-- CreateTable
CREATE TABLE "CostCenterBusinessUnit" (
    "costCenterId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,

    CONSTRAINT "CostCenterBusinessUnit_pkey" PRIMARY KEY ("costCenterId","businessUnitId")
);

-- CreateTable
CREATE TABLE "CostCenterEstablishment" (
    "costCenterId" TEXT NOT NULL,
    "establishmentId" TEXT NOT NULL,

    CONSTRAINT "CostCenterEstablishment_pkey" PRIMARY KEY ("costCenterId","establishmentId")
);

-- CreateTable
CREATE TABLE "CostCenterArea" (
    "costCenterId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,

    CONSTRAINT "CostCenterArea_pkey" PRIMARY KEY ("costCenterId","areaId")
);

-- CreateTable
CREATE TABLE "CostCenterSector" (
    "costCenterId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "CostCenterSector_pkey" PRIMARY KEY ("costCenterId","sectorId")
);

-- CreateIndex
CREATE INDEX "BusinessUnitCompany_companyId_idx" ON "BusinessUnitCompany"("companyId");

-- CreateIndex
CREATE INDEX "EstablishmentCompany_companyId_idx" ON "EstablishmentCompany"("companyId");

-- CreateIndex
CREATE INDEX "EstablishmentBusinessUnit_businessUnitId_idx" ON "EstablishmentBusinessUnit"("businessUnitId");

-- CreateIndex
CREATE INDEX "AreaBusinessUnit_businessUnitId_idx" ON "AreaBusinessUnit"("businessUnitId");

-- CreateIndex
CREATE INDEX "AreaEstablishment_establishmentId_idx" ON "AreaEstablishment"("establishmentId");

-- CreateIndex
CREATE INDEX "SectorArea_areaId_idx" ON "SectorArea"("areaId");

-- CreateIndex
CREATE INDEX "SectorEstablishment_establishmentId_idx" ON "SectorEstablishment"("establishmentId");

-- CreateIndex
CREATE INDEX "CostCenterCompany_companyId_idx" ON "CostCenterCompany"("companyId");

-- CreateIndex
CREATE INDEX "CostCenterBusinessUnit_businessUnitId_idx" ON "CostCenterBusinessUnit"("businessUnitId");

-- CreateIndex
CREATE INDEX "CostCenterEstablishment_establishmentId_idx" ON "CostCenterEstablishment"("establishmentId");

-- CreateIndex
CREATE INDEX "CostCenterArea_areaId_idx" ON "CostCenterArea"("areaId");

-- CreateIndex
CREATE INDEX "CostCenterSector_sectorId_idx" ON "CostCenterSector"("sectorId");

-- AddForeignKey
ALTER TABLE "BusinessUnitCompany" ADD CONSTRAINT "BusinessUnitCompany_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUnitCompany" ADD CONSTRAINT "BusinessUnitCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentCompany" ADD CONSTRAINT "EstablishmentCompany_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentCompany" ADD CONSTRAINT "EstablishmentCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentBusinessUnit" ADD CONSTRAINT "EstablishmentBusinessUnit_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstablishmentBusinessUnit" ADD CONSTRAINT "EstablishmentBusinessUnit_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaBusinessUnit" ADD CONSTRAINT "AreaBusinessUnit_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaBusinessUnit" ADD CONSTRAINT "AreaBusinessUnit_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaEstablishment" ADD CONSTRAINT "AreaEstablishment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaEstablishment" ADD CONSTRAINT "AreaEstablishment_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorArea" ADD CONSTRAINT "SectorArea_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorArea" ADD CONSTRAINT "SectorArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorEstablishment" ADD CONSTRAINT "SectorEstablishment_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorEstablishment" ADD CONSTRAINT "SectorEstablishment_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterCompany" ADD CONSTRAINT "CostCenterCompany_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterCompany" ADD CONSTRAINT "CostCenterCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterBusinessUnit" ADD CONSTRAINT "CostCenterBusinessUnit_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterBusinessUnit" ADD CONSTRAINT "CostCenterBusinessUnit_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterEstablishment" ADD CONSTRAINT "CostCenterEstablishment_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterEstablishment" ADD CONSTRAINT "CostCenterEstablishment_establishmentId_fkey" FOREIGN KEY ("establishmentId") REFERENCES "Establishment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterArea" ADD CONSTRAINT "CostCenterArea_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterArea" ADD CONSTRAINT "CostCenterArea_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterSector" ADD CONSTRAINT "CostCenterSector_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterSector" ADD CONSTRAINT "CostCenterSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
