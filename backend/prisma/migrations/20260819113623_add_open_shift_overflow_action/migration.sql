-- CreateEnum
CREATE TYPE "OpenShiftOverflowAction" AS ENUM ('ROLLOVER', 'ALERT_ONLY');

-- AlterTable
ALTER TABLE "WorkRegime" ADD COLUMN     "openShiftOverflowAction" "OpenShiftOverflowAction" NOT NULL DEFAULT 'ROLLOVER';
