-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShiftAlertType" ADD VALUE 'JORNADA_INSUFICIENTE';
ALTER TYPE "ShiftAlertType" ADD VALUE 'JORNADA_EXTENDIDA';
ALTER TYPE "ShiftAlertType" ADD VALUE 'DESCANSO_INSUFICIENTE';
ALTER TYPE "ShiftAlertType" ADD VALUE 'POSIBLE_OLVIDO_SALIDA';
