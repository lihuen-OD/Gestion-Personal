-- Motor de cobertura horaria de Novedades — Etapa 1: modelo y configuración
-- (docs/decisions/NOVELTY_COVERAGE_ENGINE.md).
--
-- Migración ADITIVA: enums nuevos, columnas nuevas en "NoveltyType" y
-- "Novelty", tabla derivada "NoveltyDayCoverage" (vacía) y CHECKs de
-- coherencia. No toca TimeEntry, fichadas, jornadas, desgloses, cierres ni
-- lotes Finnegans, y no cambia ningún total: ningún tipo existente queda con
-- cobertura que sume.
--
-- Backfill basado sólo en evidencia (nunca por nombre, código ni kind):
--   * allowsHours = true y allowsDateRange = false → coverageMode
--     MANUAL_MINUTES, que no suma (coverageCountsTowardTotal = false): es
--     exactamente el comportamiento vigente (cantidad de horas visible,
--     nunca suma).
--   * allowsHours = true con rango → queda NONE: no hay evidencia de cómo
--     repartir la cantidad por día. RRHH lo reconfigura.
--   * Resto → NONE.
--   * Novelty.quantityMinutes = round(quantityHours × 60) sólo en tipos
--     MANUAL_MINUTES. Una cantidad mayor a 24 h de un único día aborta la
--     migración en vez de recortarse o inventarse.
-- Rollback: prisma/rollbacks/20261113180000_add_novelty_coverage_engine.down.sql

-- Precondición, ANTES de cualquier cambio (un aborto no deja nada a medias):
-- las novedades que pasarán a cantidad manual en minutos (tipos con
-- allowsHours = true y sin rango, mismo criterio que el backfill) no pueden
-- tener más de 24 h en un único día.
DO $$
DECLARE
  oversized integer;
BEGIN
  SELECT count(*) INTO oversized
  FROM "Novelty" n
  JOIN "NoveltyType" t ON t."id" = n."noveltyTypeId"
  WHERE t."allowsHours" = true
    AND t."allowsDateRange" = false
    AND n."quantityHours" IS NOT NULL
    AND round(n."quantityHours" * 60) > 1440;
  IF oversized > 0 THEN
    RAISE EXCEPTION 'Hay % novedad(es) de un único día con más de 24 h cargadas en un tipo con cantidad manual. Auditar y corregir antes de migrar.', oversized;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "NoveltyCoverageMode" AS ENUM ('NONE', 'FIXED_MINUTES', 'MANUAL_MINUTES', 'EXPECTED_SCHEDULE');

-- CreateEnum
CREATE TYPE "NoveltyCoverageDayRule" AS ENUM ('EVERY_DAY', 'SELECTED_WEEKDAYS', 'WORK_OBLIGATION');

-- CreateEnum
CREATE TYPE "NoveltyCoverageDayOffPolicy" AS ENUM ('NO_COVERAGE', 'COVER');

-- CreateEnum
CREATE TYPE "NoveltyCoverageHolidayPolicy" AS ENUM ('NO_COVERAGE', 'COVER', 'ONLY_IF_CONVOKED');

-- CreateEnum
CREATE TYPE "NoveltyRealWorkCompatibility" AS ENUM ('COMPATIBLE', 'INCOMPATIBLE');

-- CreateEnum
CREATE TYPE "NoveltyCoverageOutcome" AS ENUM ('COVERED', 'NO_COVERAGE', 'WEEKDAY_NOT_INCLUDED', 'NO_WORK_OBLIGATION', 'HOLIDAY_NOT_CONVOKED', 'HOLIDAY_EXCLUDED', 'DAY_OFF', 'SCHEDULE_UNRESOLVED');

-- CreateEnum
CREATE TYPE "NoveltyCoverageScheduleReviewReason" AS ENUM ('SCHEDULE_MISSING', 'FLEXIBLE_REGIME_NO_ASSIGNMENT', 'REGIME_WITHOUT_SCHEDULE', 'EXPECTED_MINUTES_UNKNOWN');

-- CreateEnum
CREATE TYPE "NoveltyCoverageReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NoveltyCoverageResolution" AS ENUM ('CONFIRMED_ZERO', 'SET_BASE_MINUTES');

-- AlterTable
ALTER TABLE "NoveltyType" ADD COLUMN     "coverageAppliesSpecialHours" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coverageCountsTowardTotal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coverageDayRule" "NoveltyCoverageDayRule" NOT NULL DEFAULT 'EVERY_DAY',
ADD COLUMN     "coverageFixedMinutes" INTEGER,
ADD COLUMN     "coverageMode" "NoveltyCoverageMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "coverageOnDayOff" "NoveltyCoverageDayOffPolicy",
ADD COLUMN     "coverageOnHoliday" "NoveltyCoverageHolidayPolicy",
ADD COLUMN     "coverageWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "realWorkCompatibility" "NoveltyRealWorkCompatibility" NOT NULL DEFAULT 'COMPATIBLE',
ADD COLUMN     "requiresObservation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Novelty" ADD COLUMN     "quantityMinutes" INTEGER;

-- CreateTable
CREATE TABLE "NoveltyDayCoverage" (
    "id" TEXT NOT NULL,
    "noveltyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "noveltyTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "period" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "outcome" "NoveltyCoverageOutcome" NOT NULL,
    "scheduleReviewReason" "NoveltyCoverageScheduleReviewReason",
    "expectedMinutes" INTEGER,
    "baseMinutes" INTEGER NOT NULL,
    "appliedMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "countsTowardTotal" BOOLEAN NOT NULL,
    "realWorkCompatibility" "NoveltyRealWorkCompatibility" NOT NULL,
    "shiftTemplateId" TEXT,
    "reviewStatus" "NoveltyCoverageReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "resolution" "NoveltyCoverageResolution",
    "resolvedBaseMinutes" INTEGER,
    "resolvedAgainstWorkedMinutes" INTEGER,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolutionNote" TEXT,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NoveltyDayCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoveltyDayCoverage_employeeId_period_idx" ON "NoveltyDayCoverage"("employeeId", "period");

-- CreateIndex
CREATE INDEX "NoveltyDayCoverage_employeeId_date_idx" ON "NoveltyDayCoverage"("employeeId", "date");

-- CreateIndex
CREATE INDEX "NoveltyDayCoverage_period_reviewStatus_idx" ON "NoveltyDayCoverage"("period", "reviewStatus");

-- CreateIndex
CREATE INDEX "NoveltyDayCoverage_noveltyTypeId_idx" ON "NoveltyDayCoverage"("noveltyTypeId");

-- CreateIndex
CREATE INDEX "NoveltyDayCoverage_shiftTemplateId_idx" ON "NoveltyDayCoverage"("shiftTemplateId");

-- CreateIndex
CREATE INDEX "NoveltyDayCoverage_resolvedByUserId_idx" ON "NoveltyDayCoverage"("resolvedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "NoveltyDayCoverage_noveltyId_date_key" ON "NoveltyDayCoverage"("noveltyId", "date");

-- AddForeignKey
ALTER TABLE "NoveltyDayCoverage" ADD CONSTRAINT "NoveltyDayCoverage_noveltyId_fkey" FOREIGN KEY ("noveltyId") REFERENCES "Novelty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoveltyDayCoverage" ADD CONSTRAINT "NoveltyDayCoverage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoveltyDayCoverage" ADD CONSTRAINT "NoveltyDayCoverage_noveltyTypeId_fkey" FOREIGN KEY ("noveltyTypeId") REFERENCES "NoveltyType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoveltyDayCoverage" ADD CONSTRAINT "NoveltyDayCoverage_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoveltyDayCoverage" ADD CONSTRAINT "NoveltyDayCoverage_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill ---------------------------------------------------------------

UPDATE "NoveltyType"
SET "coverageMode" = 'MANUAL_MINUTES'
WHERE "allowsHours" = true AND "allowsDateRange" = false;

UPDATE "Novelty" n
SET "quantityMinutes" = round(n."quantityHours" * 60)::integer
FROM "NoveltyType" t
WHERE t."id" = n."noveltyTypeId"
  AND t."coverageMode" = 'MANUAL_MINUTES'
  AND n."quantityHours" IS NOT NULL;

-- Coherencia de la configuración de cobertura del tipo -------------------
-- Prisma no modela CHECKs: este conjunto expresa en la base las reglas que
-- también valida noveltyTypes.service (assertCoverageConfigCoherent).
--   NONE: sin cantidad, días EVERY_DAY sin selección, sin políticas, sin
--     multiplicadores y sin sumar.
--   MANUAL_MINUTES: la cantidad la indica quien carga para un único día
--     (sin rango, allowsHours = true mientras exista ese campo), sin regla
--     de días ni políticas.
--   EXPECTED_SCHEDULE: sólo días con obligación laboral (WORK_OBLIGATION).
--   FIXED_MINUTES: 1..1440 minutos; con WORK_OBLIGATION las políticas de
--     franco/feriado quedan NULL (las deciden franco y convocatoria); con
--     reglas por calendario son obligatorias (sin default funcional).
-- La unicidad de coverageWeekdays la garantiza el backend (normaliza y
-- ordena); un CHECK no puede usar subconsultas.
-- COALESCE(…, false): un CHECK que evalúa a NULL (p. ej. NULL BETWEEN 1 AND
-- 1440) se considera cumplido; así una columna nula nunca lo saltea.
ALTER TABLE "NoveltyType"
ADD CONSTRAINT "NoveltyType_coverage_config_check" CHECK (
  COALESCE((
    (
      "coverageMode" = 'NONE'
      AND "coverageFixedMinutes" IS NULL
      AND "coverageDayRule" = 'EVERY_DAY'
      AND cardinality(COALESCE("coverageWeekdays", ARRAY[]::INTEGER[])) = 0
      AND "coverageOnDayOff" IS NULL
      AND "coverageOnHoliday" IS NULL
      AND "coverageAppliesSpecialHours" = false
      AND "coverageCountsTowardTotal" = false
    )
    OR (
      "coverageMode" = 'MANUAL_MINUTES'
      AND "coverageFixedMinutes" IS NULL
      AND "allowsDateRange" = false
      AND "allowsHours" = true
      AND "coverageDayRule" = 'EVERY_DAY'
      AND cardinality(COALESCE("coverageWeekdays", ARRAY[]::INTEGER[])) = 0
      AND "coverageOnDayOff" IS NULL
      AND "coverageOnHoliday" IS NULL
    )
    OR (
      "coverageMode" = 'EXPECTED_SCHEDULE'
      AND "coverageFixedMinutes" IS NULL
      AND "coverageDayRule" = 'WORK_OBLIGATION'
      AND cardinality(COALESCE("coverageWeekdays", ARRAY[]::INTEGER[])) = 0
      AND "coverageOnDayOff" IS NULL
      AND "coverageOnHoliday" IS NULL
    )
    OR (
      "coverageMode" = 'FIXED_MINUTES'
      AND "coverageFixedMinutes" BETWEEN 1 AND 1440
      AND (
        (
          "coverageDayRule" = 'WORK_OBLIGATION'
          AND cardinality(COALESCE("coverageWeekdays", ARRAY[]::INTEGER[])) = 0
          AND "coverageOnDayOff" IS NULL
          AND "coverageOnHoliday" IS NULL
        )
        OR (
          "coverageDayRule" = 'EVERY_DAY'
          AND cardinality(COALESCE("coverageWeekdays", ARRAY[]::INTEGER[])) = 0
          AND "coverageOnDayOff" IS NOT NULL
          AND "coverageOnHoliday" IS NOT NULL
        )
        OR (
          "coverageDayRule" = 'SELECTED_WEEKDAYS'
          AND cardinality("coverageWeekdays") BETWEEN 1 AND 7
          AND "coverageWeekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
          AND "coverageOnDayOff" IS NOT NULL
          AND "coverageOnHoliday" IS NOT NULL
        )
      )
    )
  ), false)
);

ALTER TABLE "Novelty"
ADD CONSTRAINT "Novelty_quantity_minutes_check" CHECK (
  "quantityMinutes" IS NULL OR "quantityMinutes" BETWEEN 1 AND 1440
);

-- Integridad de la fila diaria derivada ----------------------------------
ALTER TABLE "NoveltyDayCoverage"
ADD CONSTRAINT "NoveltyDayCoverage_calendar_check" CHECK (
  "day" = EXTRACT(DAY FROM "date")::integer
  AND "period" = EXTRACT(YEAR FROM "date")::integer::text || '-' || lpad(EXTRACT(MONTH FROM "date")::integer::text, 2, '0')
);

ALTER TABLE "NoveltyDayCoverage"
ADD CONSTRAINT "NoveltyDayCoverage_minutes_check" CHECK (
  "baseMinutes" BETWEEN 0 AND 1440
  AND ("expectedMinutes" IS NULL OR "expectedMinutes" BETWEEN 0 AND 1440)
  AND "appliedMultiplier" > 0
  AND ("outcome" = 'COVERED' OR "baseMinutes" = 0)
);

-- 0 h provisional (SCHEDULE_UNRESOLVED) nunca equivale a 0 h confirmado:
-- siempre lleva motivo y nace PENDING (o RESOLVED por una persona).
ALTER TABLE "NoveltyDayCoverage"
ADD CONSTRAINT "NoveltyDayCoverage_review_check" CHECK (
  (("outcome" = 'SCHEDULE_UNRESOLVED') = ("scheduleReviewReason" IS NOT NULL))
  AND ("outcome" <> 'SCHEDULE_UNRESOLVED' OR "reviewStatus" <> 'NOT_REQUIRED')
  AND ("reviewStatus" <> 'PENDING' OR "outcome" = 'SCHEDULE_UNRESOLVED')
);

-- Una resolución es una decisión humana completa: tipo, minutos efectivos y
-- fecha. CONFIRMED_ZERO deja 0 explícito; SET_BASE_MINUTES, 1..1440.
-- resolvedByUserId no se exige: es FK SetNull (DATABASE_STANDARDS.md).
ALTER TABLE "NoveltyDayCoverage"
ADD CONSTRAINT "NoveltyDayCoverage_resolution_check" CHECK (
  COALESCE((
    (
      "reviewStatus" = 'RESOLVED'
      AND "resolution" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
      AND "resolvedAgainstWorkedMinutes" IS NOT NULL
      AND "resolvedAgainstWorkedMinutes" >= 0
      AND (
        ("resolution" = 'CONFIRMED_ZERO' AND "resolvedBaseMinutes" = 0)
        OR ("resolution" = 'SET_BASE_MINUTES' AND "resolvedBaseMinutes" BETWEEN 1 AND 1440)
      )
    )
    OR (
      "reviewStatus" <> 'RESOLVED'
      AND "resolution" IS NULL
      AND "resolvedBaseMinutes" IS NULL
      AND "resolvedAgainstWorkedMinutes" IS NULL
      AND "resolvedAt" IS NULL
      AND "resolvedByUserId" IS NULL
      AND "resolutionNote" IS NULL
    )
  ), false)
);
