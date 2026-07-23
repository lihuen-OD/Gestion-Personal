ALTER TABLE "ShiftTemplate"
  ADD COLUMN "entryToleranceBeforeMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "entryToleranceAfterMinutes" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "exitToleranceBeforeMinutes" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "exitToleranceAfterMinutes" INTEGER NOT NULL DEFAULT 20;

UPDATE "ShiftTemplate"
SET "entryToleranceBeforeMinutes" = "entryToleranceMinutes",
    "entryToleranceAfterMinutes" = "entryToleranceMinutes",
    "exitToleranceBeforeMinutes" = "exitToleranceMinutes",
    "exitToleranceAfterMinutes" = "exitToleranceMinutes";

ALTER TABLE "ShiftTemplate"
  DROP COLUMN "entryToleranceMinutes",
  DROP COLUMN "exitToleranceMinutes",
  DROP COLUMN "detectionWindowMinutes";
