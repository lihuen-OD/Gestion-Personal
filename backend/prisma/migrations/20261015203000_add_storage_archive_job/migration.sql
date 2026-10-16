CREATE TYPE "StorageArchiveJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "StorageArchiveJob" (
    "id" TEXT NOT NULL,
    "sourceStorageFileId" TEXT NOT NULL,
    "targetProvider" "StorageProvider" NOT NULL,
    "status" "StorageArchiveJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "targetStorageKey" TEXT,
    "leaseExpiresAt" TIMESTAMP(3) WITH TIME ZONE,
    "startedAt" TIMESTAMP(3) WITH TIME ZONE,
    "completedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "StorageArchiveJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorageArchiveJob_sourceStorageFileId_targetProvider_key"
ON "StorageArchiveJob"("sourceStorageFileId", "targetProvider");

CREATE INDEX "StorageArchiveJob_status_nextAttemptAt_idx"
ON "StorageArchiveJob"("status", "nextAttemptAt");

CREATE INDEX "StorageArchiveJob_status_leaseExpiresAt_idx"
ON "StorageArchiveJob"("status", "leaseExpiresAt");

ALTER TABLE "StorageArchiveJob"
ADD CONSTRAINT "StorageArchiveJob_sourceStorageFileId_fkey"
FOREIGN KEY ("sourceStorageFileId") REFERENCES "StorageFile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
