-- Reversión de 20261114120000_add_novelty_coverage_employment_and_overlap.
-- Una sola transacción, con la tabla bloqueada antes de comprobar nada.
--
-- PostgreSQL no permite quitar un valor de un enum: se recrean los dos tipos
-- sin los valores nuevos. Aborta sin cambios si alguna fila los usa: una fila
-- OUTSIDE_EMPLOYMENT o un día en revisión por turnos superpuestos o por
-- relación laboral sin resolver no tiene equivalente en el modelo anterior, y
-- una resolución manual sobre esos días no se puede re-derivar.
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que escribe estos valores y, después,
-- `prisma migrate resolve --rolled-back 20261114120000_add_novelty_coverage_employment_and_overlap`.
BEGIN;

LOCK TABLE "NoveltyDayCoverage" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  used integer;
BEGIN
  SELECT count(*) INTO used
  FROM "NoveltyDayCoverage"
  WHERE "outcome" = 'OUTSIDE_EMPLOYMENT'
     OR "scheduleReviewReason" IN ('SHIFT_ASSIGNMENTS_OVERLAP', 'EMPLOYMENT_HISTORY_UNRESOLVED');
  IF used > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % día(s) de cobertura usan los valores agregados. Recalcular o eliminar esa cobertura con su procedimiento antes de revertir.', used;
  END IF;
END $$;

-- Los CHECKs que comparan estas columnas con literales del enum quedan
-- ligados al tipo viejo: se sueltan y se recrean, idénticos, después del
-- cambio de tipo (definición de 20261113180000_add_novelty_coverage_engine).
ALTER TABLE "NoveltyDayCoverage" DROP CONSTRAINT "NoveltyDayCoverage_minutes_check";
ALTER TABLE "NoveltyDayCoverage" DROP CONSTRAINT "NoveltyDayCoverage_review_check";

ALTER TYPE "NoveltyCoverageOutcome" RENAME TO "NoveltyCoverageOutcome_old";
CREATE TYPE "NoveltyCoverageOutcome" AS ENUM ('COVERED', 'NO_COVERAGE', 'WEEKDAY_NOT_INCLUDED', 'NO_WORK_OBLIGATION', 'HOLIDAY_NOT_CONVOKED', 'HOLIDAY_EXCLUDED', 'DAY_OFF', 'SCHEDULE_UNRESOLVED');
ALTER TABLE "NoveltyDayCoverage" ALTER COLUMN "outcome" TYPE "NoveltyCoverageOutcome" USING ("outcome"::text::"NoveltyCoverageOutcome");
DROP TYPE "NoveltyCoverageOutcome_old";

ALTER TYPE "NoveltyCoverageScheduleReviewReason" RENAME TO "NoveltyCoverageScheduleReviewReason_old";
CREATE TYPE "NoveltyCoverageScheduleReviewReason" AS ENUM ('SCHEDULE_MISSING', 'FLEXIBLE_REGIME_NO_ASSIGNMENT', 'REGIME_WITHOUT_SCHEDULE', 'EXPECTED_MINUTES_UNKNOWN');
ALTER TABLE "NoveltyDayCoverage" ALTER COLUMN "scheduleReviewReason" TYPE "NoveltyCoverageScheduleReviewReason" USING ("scheduleReviewReason"::text::"NoveltyCoverageScheduleReviewReason");
DROP TYPE "NoveltyCoverageScheduleReviewReason_old";

ALTER TABLE "NoveltyDayCoverage"
ADD CONSTRAINT "NoveltyDayCoverage_minutes_check" CHECK (
  "baseMinutes" BETWEEN 0 AND 1440
  AND ("expectedMinutes" IS NULL OR "expectedMinutes" BETWEEN 0 AND 1440)
  AND "appliedMultiplier" > 0
  AND ("outcome" = 'COVERED' OR "baseMinutes" = 0)
);

ALTER TABLE "NoveltyDayCoverage"
ADD CONSTRAINT "NoveltyDayCoverage_review_check" CHECK (
  (("outcome" = 'SCHEDULE_UNRESOLVED') = ("scheduleReviewReason" IS NOT NULL))
  AND ("outcome" <> 'SCHEDULE_UNRESOLVED' OR "reviewStatus" <> 'NOT_REQUIRED')
  AND ("reviewStatus" <> 'PENDING' OR "outcome" = 'SCHEDULE_UNRESOLVED')
);

COMMIT;
