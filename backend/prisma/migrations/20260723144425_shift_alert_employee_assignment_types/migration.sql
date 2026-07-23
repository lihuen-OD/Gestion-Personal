-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShiftAlertType" ADD VALUE 'SHIFT_NOT_ENABLED_FOR_EMPLOYEE';
ALTER TYPE "ShiftAlertType" ADD VALUE 'POSSIBLE_SHIFT_CONFIGURATION_MISSING';
