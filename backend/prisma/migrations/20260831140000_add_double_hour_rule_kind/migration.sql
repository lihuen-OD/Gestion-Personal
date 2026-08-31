-- CreateEnum
CREATE TYPE "DoubleHourRuleKind" AS ENUM ('FERIADO', 'DOMINGO', 'JORNADA_ESPECIAL', 'OTRO');

-- AlterTable
ALTER TABLE "DoubleHourRule" ADD COLUMN     "kind" "DoubleHourRuleKind" NOT NULL DEFAULT 'OTRO';
