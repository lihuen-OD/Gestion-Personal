ALTER TABLE "WorkShift"
  ADD COLUMN "hourConceptId" TEXT,
  ADD COLUMN "hourConceptName" TEXT;

UPDATE "WorkShift" AS ws
SET "hourConceptId" = source."hourConceptId",
    "hourConceptName" = source."hourConceptName"
FROM (
  SELECT DISTINCT ON ("workShiftId") "workShiftId", "hourConceptId", "hourConceptName"
  FROM "TimeSegment"
  WHERE "workShiftId" IS NOT NULL
  ORDER BY "workShiftId", "createdAt" ASC
) AS source
WHERE source."workShiftId" = ws."id";

ALTER TABLE "WorkShift"
  ADD CONSTRAINT "WorkShift_hourConceptId_fkey"
  FOREIGN KEY ("hourConceptId") REFERENCES "HourConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkShift_hourConceptId_idx" ON "WorkShift"("hourConceptId");
