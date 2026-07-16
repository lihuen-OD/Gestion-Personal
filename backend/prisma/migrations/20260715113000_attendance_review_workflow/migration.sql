CREATE TYPE "AttendanceReviewStatus" AS ENUM ('PENDIENTE', 'RESUELTA', 'DESCARTADA');

ALTER TABLE "WorkShift"
  ADD COLUMN "reviewStatus" "AttendanceReviewStatus" NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "AttendancePunch"
  ADD COLUMN "reviewStatus" "AttendanceReviewStatus" NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "reviewNote" TEXT;

CREATE INDEX "WorkShift_reviewStatus_startAt_idx" ON "WorkShift"("reviewStatus", "startAt");
CREATE INDEX "AttendancePunch_reviewStatus_timestamp_idx" ON "AttendancePunch"("reviewStatus", "timestamp");
