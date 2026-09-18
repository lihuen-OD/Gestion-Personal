-- CreateTable
CREATE TABLE "JobCheckpoint" (
    "key" TEXT NOT NULL,
    "lastProcessedDate" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobCheckpoint_pkey" PRIMARY KEY ("key")
);
