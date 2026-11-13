-- Reversión de 20261113180000_add_novelty_coverage_engine. Una sola
-- transacción, con las tablas afectadas bloqueadas antes de comprobar nada.
--
-- Aborta sin cambios si quitar las columnas/tabla perdería información que el
-- código anterior no puede volver a derivar:
--   * cualquier resolución humana de un día de cobertura (decisión manual);
--   * cualquier tipo cuya configuración de cobertura difiera de lo que la
--     migración derivó (NONE, o MANUAL_MINUTES no sumable para
--     allowsHours = true sin rango) o que exija observación;
--   * cualquier novedad cuya cantidad en minutos no sea la derivada de
--     quantityHours (cantidad que sólo existe en minutos).
-- Las filas de NoveltyDayCoverage sin resolución son derivadas: se recalculan
-- con el motor y pueden descartarse.
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que usa estos campos y, después,
-- `prisma migrate resolve --rolled-back 20261113180000_add_novelty_coverage_engine`.
BEGIN;

LOCK TABLE "NoveltyType", "Novelty", "NoveltyDayCoverage" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  resolved integer;
  configured integer;
  minutes_only integer;
BEGIN
  SELECT count(*) INTO resolved FROM "NoveltyDayCoverage" WHERE "reviewStatus" = 'RESOLVED';
  IF resolved > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % día(s) de cobertura con resolución manual. Esa decisión no se puede re-derivar.', resolved;
  END IF;

  SELECT count(*) INTO configured
  FROM "NoveltyType"
  WHERE "requiresObservation" = true
     OR "realWorkCompatibility" <> 'COMPATIBLE'
     OR NOT (
       ("coverageMode" = 'NONE')
       OR (
         "coverageMode" = 'MANUAL_MINUTES'
         AND "allowsHours" = true
         AND "allowsDateRange" = false
         AND "coverageCountsTowardTotal" = false
         AND "coverageAppliesSpecialHours" = false
       )
     );
  IF configured > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % tipo(s) de novedad con configuración de cobertura propia. Volver a NONE desde el catálogo (o registrar la configuración) antes de revertir.', configured;
  END IF;

  SELECT count(*) INTO minutes_only
  FROM "Novelty"
  WHERE "quantityMinutes" IS NOT NULL
    AND ("quantityHours" IS NULL OR round("quantityHours" * 60)::integer <> "quantityMinutes");
  IF minutes_only > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % novedad(es) con una cantidad que sólo existe en minutos.', minutes_only;
  END IF;
END $$;

DROP TABLE "NoveltyDayCoverage";

ALTER TABLE "Novelty" DROP CONSTRAINT "Novelty_quantity_minutes_check";
ALTER TABLE "Novelty" DROP COLUMN "quantityMinutes";

ALTER TABLE "NoveltyType" DROP CONSTRAINT "NoveltyType_coverage_config_check";
ALTER TABLE "NoveltyType"
  DROP COLUMN "coverageMode",
  DROP COLUMN "coverageFixedMinutes",
  DROP COLUMN "coverageDayRule",
  DROP COLUMN "coverageWeekdays",
  DROP COLUMN "coverageOnDayOff",
  DROP COLUMN "coverageOnHoliday",
  DROP COLUMN "coverageAppliesSpecialHours",
  DROP COLUMN "coverageCountsTowardTotal",
  DROP COLUMN "realWorkCompatibility",
  DROP COLUMN "requiresObservation";

DROP TYPE "NoveltyCoverageResolution";
DROP TYPE "NoveltyCoverageReviewStatus";
DROP TYPE "NoveltyCoverageScheduleReviewReason";
DROP TYPE "NoveltyCoverageOutcome";
DROP TYPE "NoveltyRealWorkCompatibility";
DROP TYPE "NoveltyCoverageHolidayPolicy";
DROP TYPE "NoveltyCoverageDayOffPolicy";
DROP TYPE "NoveltyCoverageDayRule";
DROP TYPE "NoveltyCoverageMode";

COMMIT;
