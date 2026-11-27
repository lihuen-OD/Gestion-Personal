-- Administrative approval states are test-only legacy data. Active records become
-- effective immediately; rejected records remain rejected for historical fidelity.
UPDATE "Novelty"
SET "status" = 'APROBADO'
WHERE "status" IN ('BORRADOR', 'PENDIENTE', 'EN_REVISION', 'DEVUELTO', 'CERRADO');

UPDATE "TimeEntry"
SET "status" = 'APROBADO'
WHERE "status" IN ('BORRADOR', 'PENDIENTE', 'EN_REVISION', 'DEVUELTO', 'CERRADO');

UPDATE "HourConceptBreakdown"
SET "status" = 'APROBADO'
WHERE "status" IN ('BORRADOR', 'PENDIENTE', 'EN_REVISION', 'DEVUELTO', 'CERRADO');

ALTER TABLE "Novelty" ALTER COLUMN "status" SET DEFAULT 'APROBADO';
ALTER TABLE "TimeEntry" ALTER COLUMN "status" SET DEFAULT 'APROBADO';
ALTER TABLE "HourConceptBreakdown" ALTER COLUMN "status" SET DEFAULT 'APROBADO';

-- The administrative correction request circuit is no longer part of the
-- production model. Current environments contain test data only.
DROP TABLE "TimeCorrectionRequest";
DROP TYPE "CorrectionRequestStatus";

-- Rename authorship columns before replacing the closure state enum.
ALTER TABLE "MonthlyTimeClosure" RENAME COLUMN "submittedByUserId" TO "closedByUserId";
ALTER TABLE "MonthlyTimeClosure" RENAME COLUMN "submittedAt" TO "closedAt";
ALTER TABLE "MonthlyTimeClosure" RENAME COLUMN "reviewedByUserId" TO "reopenedByUserId";
ALTER TABLE "MonthlyTimeClosure" RENAME COLUMN "reviewedAt" TO "reopenedAt";
ALTER TABLE "MonthlyTimeClosure" RENAME COLUMN "reviewNote" TO "reopenReason";

ALTER TABLE "MonthlyTimeClosure" RENAME CONSTRAINT "MonthlyTimeClosure_submittedByUserId_fkey" TO "MonthlyTimeClosure_closedByUserId_fkey";
ALTER TABLE "MonthlyTimeClosure" RENAME CONSTRAINT "MonthlyTimeClosure_reviewedByUserId_fkey" TO "MonthlyTimeClosure_reopenedByUserId_fkey";

CREATE TYPE "MonthlyClosureStatus_new" AS ENUM ('ABIERTO', 'CERRADO');
ALTER TABLE "MonthlyTimeClosure" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MonthlyTimeClosure"
  ALTER COLUMN "status" TYPE "MonthlyClosureStatus_new"
  USING (
    CASE
      WHEN "status"::text IN ('ENVIADO', 'APROBADO') THEN 'CERRADO'
      ELSE 'ABIERTO'
    END
  )::"MonthlyClosureStatus_new";
DROP TYPE "MonthlyClosureStatus";
ALTER TYPE "MonthlyClosureStatus_new" RENAME TO "MonthlyClosureStatus";
ALTER TABLE "MonthlyTimeClosure" ALTER COLUMN "status" SET DEFAULT 'ABIERTO';

-- The former review columns now mean "reopened". A converted CERRADO period
-- was never reopened: clear the reviewer/approval note carried by the rename.
UPDATE "MonthlyTimeClosure"
SET "reopenedByUserId" = NULL, "reopenedAt" = NULL, "reopenReason" = NULL
WHERE "status" = 'CERRADO';

-- Approval configuration belonged to the retired administrative circuit.
ALTER TABLE "NoveltyType" DROP COLUMN "requiresApproval";
ALTER TABLE "NoveltyType" DROP COLUMN "approvalRoles";
