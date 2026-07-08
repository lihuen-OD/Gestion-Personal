ALTER TYPE "WorkShiftSource" ADD VALUE IF NOT EXISTS 'PUBLIC_CLOCK_PHOTO';

CREATE TYPE "FaceValidationStatus" AS ENUM (
  'VALID',
  'NO_FACE',
  'MULTIPLE_FACES',
  'LOW_LIGHT',
  'FACE_TOO_SMALL',
  'CAMERA_ERROR'
);

ALTER TABLE "AttendancePunch"
  ADD COLUMN "photoUrl" TEXT,
  ADD COLUMN "photoStoragePath" TEXT,
  ADD COLUMN "faceDetected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "faceValidationStatus" "FaceValidationStatus",
  ADD COLUMN "faceDetectionScore" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "AttendancePunch_faceValidationStatus_idx"
  ON "AttendancePunch"("faceValidationStatus");

CREATE INDEX IF NOT EXISTS "AttendancePunch_photoStoragePath_idx"
  ON "AttendancePunch"("photoStoragePath");
