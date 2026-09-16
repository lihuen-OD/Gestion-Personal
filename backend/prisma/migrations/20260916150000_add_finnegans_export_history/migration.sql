-- CreateEnum
CREATE TYPE "FinnegansExportFormat" AS ENUM ('XLSX', 'CSV');

-- CreateTable
CREATE TABLE "FinnegansExportBatch" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" "FinnegansExportFormat" NOT NULL,
    "hash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousBatchId" TEXT,

    CONSTRAINT "FinnegansExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinnegansExportBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "noveltyId" TEXT,
    "employeeId" TEXT NOT NULL,
    "legajo" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "noveltyCode" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "value1" TEXT NOT NULL,
    "applicationDate" TEXT NOT NULL,
    "validFrom" TEXT NOT NULL,
    "validTo" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinnegansExportBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinnegansExportBatch_idempotencyKey_key" ON "FinnegansExportBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinnegansExportBatch_period_version_idx" ON "FinnegansExportBatch"("period", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FinnegansExportBatch_period_version_key" ON "FinnegansExportBatch"("period", "version");

-- CreateIndex
CREATE INDEX "FinnegansExportBatchItem_batchId_idx" ON "FinnegansExportBatchItem"("batchId");

-- CreateIndex
CREATE INDEX "FinnegansExportBatchItem_noveltyId_idx" ON "FinnegansExportBatchItem"("noveltyId");

-- CreateIndex
CREATE INDEX "FinnegansExportBatchItem_employeeId_idx" ON "FinnegansExportBatchItem"("employeeId");

-- AddForeignKey
ALTER TABLE "FinnegansExportBatch" ADD CONSTRAINT "FinnegansExportBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinnegansExportBatch" ADD CONSTRAINT "FinnegansExportBatch_previousBatchId_fkey" FOREIGN KEY ("previousBatchId") REFERENCES "FinnegansExportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinnegansExportBatchItem" ADD CONSTRAINT "FinnegansExportBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FinnegansExportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinnegansExportBatchItem" ADD CONSTRAINT "FinnegansExportBatchItem_noveltyId_fkey" FOREIGN KEY ("noveltyId") REFERENCES "Novelty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinnegansExportBatchItem" ADD CONSTRAINT "FinnegansExportBatchItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
