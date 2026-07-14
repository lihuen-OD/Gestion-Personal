CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'CLOUDINARY', 'GOOGLE_DRIVE');
CREATE TYPE "StorageModule" AS ENUM ('FICHADAS', 'LEGAJOS', 'NOVEDADES', 'TRANSPORTE', 'AUDITORIA', 'DOCUMENTACION_GENERAL');
CREATE TYPE "StorageEntityType" AS ENUM ('ATTENDANCE_PUNCH', 'EMPLOYEE', 'EMPLOYEE_DOCUMENT', 'ABSENCE', 'TRANSPORT', 'AUDIT_EVENT', 'GENERAL_DOCUMENT');
CREATE TYPE "StorageVisibility" AS ENUM ('PRIVATE', 'RRHH_ONLY', 'SUPERVISOR_ALLOWED', 'SYSTEM_ONLY');
CREATE TYPE "StorageFileStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED', 'ERROR');

CREATE TABLE "StorageFile" (
  "id" TEXT NOT NULL,
  "storageProvider" "StorageProvider" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "driveFileId" TEXT,
  "driveFolderId" TEXT,
  "driveWebViewLink" TEXT,
  "driveWebContentLink" TEXT,
  "fileName" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "module" "StorageModule" NOT NULL,
  "entityType" "StorageEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "employeeId" TEXT,
  "attendancePunchId" TEXT,
  "documentType" TEXT,
  "isThumbnail" BOOLEAN NOT NULL DEFAULT false,
  "thumbnailFileId" TEXT,
  "originalFileId" TEXT,
  "visibility" "StorageVisibility" NOT NULL DEFAULT 'PRIVATE',
  "status" "StorageFileStatus" NOT NULL DEFAULT 'ACTIVE',
  "uploadedByUserId" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedByUserId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "checksum" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageFile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AttendancePunch"
  ADD COLUMN "photoFileId" TEXT,
  ADD COLUMN "thumbnailFileId" TEXT;

ALTER TABLE "EmployeeDocument"
  ADD COLUMN "storageFileId" TEXT;

CREATE INDEX "StorageFile_storageProvider_idx" ON "StorageFile"("storageProvider");
CREATE INDEX "StorageFile_storageKey_idx" ON "StorageFile"("storageKey");
CREATE INDEX "StorageFile_driveFileId_idx" ON "StorageFile"("driveFileId");
CREATE INDEX "StorageFile_module_entityType_entityId_idx" ON "StorageFile"("module", "entityType", "entityId");
CREATE INDEX "StorageFile_employeeId_module_idx" ON "StorageFile"("employeeId", "module");
CREATE INDEX "StorageFile_attendancePunchId_idx" ON "StorageFile"("attendancePunchId");
CREATE INDEX "StorageFile_status_uploadedAt_idx" ON "StorageFile"("status", "uploadedAt");
CREATE INDEX "AttendancePunch_photoFileId_idx" ON "AttendancePunch"("photoFileId");
CREATE INDEX "AttendancePunch_thumbnailFileId_idx" ON "AttendancePunch"("thumbnailFileId");
CREATE INDEX "EmployeeDocument_storageFileId_idx" ON "EmployeeDocument"("storageFileId");

ALTER TABLE "StorageFile"
  ADD CONSTRAINT "StorageFile_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StorageFile"
  ADD CONSTRAINT "StorageFile_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StorageFile"
  ADD CONSTRAINT "StorageFile_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AttendancePunch"
  ADD CONSTRAINT "AttendancePunch_photoFileId_fkey"
  FOREIGN KEY ("photoFileId") REFERENCES "StorageFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AttendancePunch"
  ADD CONSTRAINT "AttendancePunch_thumbnailFileId_fkey"
  FOREIGN KEY ("thumbnailFileId") REFERENCES "StorageFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmployeeDocument"
  ADD CONSTRAINT "EmployeeDocument_storageFileId_fkey"
  FOREIGN KEY ("storageFileId") REFERENCES "StorageFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
