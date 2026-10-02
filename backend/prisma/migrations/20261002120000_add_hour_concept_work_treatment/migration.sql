-- Modelo de contabilidad de tiempo trabajado
-- (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
--
-- 100% aditiva: un enum nuevo, 1 columna nullable en HourConcept y 3 columnas
-- en HourConceptBreakdown. No borra ni reescribe minutos/horas históricos
-- (TimeEntry.hours y HourConceptBreakdown.minutes no se tocan).

CREATE TYPE "HourConceptWorkTreatment" AS ENUM ('WITHIN_BASE', 'ADDITIVE_TO_WORKED_TOTAL');

ALTER TABLE "HourConcept"
ADD COLUMN "workTreatment" "HourConceptWorkTreatment";

ALTER TABLE "HourConceptBreakdown"
ADD COLUMN "appliedMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1,
ADD COLUMN "startAt" TIMESTAMPTZ(3),
ADD COLUMN "endAt" TIMESTAMPTZ(3);

-- Backfill de metadata del catálogo auditado (inspección READ-ONLY del
-- 2026-10-02 sobre la base de desarrollo/staging, mapping confirmado por el
-- usuario). Nunca se infiere por nombre en runtime: esto es sólo la
-- migración de la instancia existente, igual criterio que
-- 20260824170000_normalize_hour_concepts.
--   HOR-001 Sereno (SERENO, BOTH, 21:00-03:00)     -> WITHIN_BASE
--   HOR-004 Prueba (OTRO, AUTOMATIC, 09:00-11:00)  -> WITHIN_BASE
--   HC-GUARDIA Guardia (GUARDIA, eliminado)        -> WITHIN_BASE
--   HOR-002 Colectivo (TRANSPORTE, MANUAL)         -> ADDITIVE_TO_WORKED_TOTAL
--   HOR-003 Camioneta (TRANSPORTE, MANUAL)         -> ADDITIVE_TO_WORKED_TOTAL
UPDATE "HourConcept"
SET "workTreatment" = 'WITHIN_BASE'
WHERE "systemRole" IS NULL AND "code" IN ('HOR-001', 'HOR-004', 'HC-GUARDIA');

UPDATE "HourConcept"
SET "workTreatment" = 'ADDITIVE_TO_WORKED_TOTAL'
WHERE "systemRole" IS NULL AND "code" IN ('HOR-002', 'HOR-003');

-- Cualquier otro concepto adicional (p. ej. en una base no auditada) aborta
-- la migración en vez de recibir un tratamiento inventado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "HourConcept" WHERE "systemRole" IS NULL AND "workTreatment" IS NULL) THEN
    RAISE EXCEPTION 'Hay conceptos horarios adicionales sin tratamiento auditado (workTreatment). Auditar y mapear explícitamente antes de migrar.';
  END IF;
END $$;

-- Prisma deja workTreatment nullable porque NORMAL_BASE legítimamente no lo
-- usa. El CHECK expresa la obligatoriedad real para todos los adicionales.
ALTER TABLE "HourConcept"
ADD CONSTRAINT "HourConcept_work_treatment_check" CHECK (
  ("systemRole" = 'NORMAL_BASE' AND "workTreatment" IS NULL)
  OR
  ("systemRole" IS NULL AND "workTreatment" IS NOT NULL)
);

ALTER TABLE "HourConceptBreakdown"
ADD CONSTRAINT "HourConceptBreakdown_interval_check" CHECK (
  ("startAt" IS NULL AND "endAt" IS NULL)
  OR
  ("startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "startAt" < "endAt")
);

-- Snapshot de multiplicador para desgloses existentes: hasta esta migración
-- la lectura tomaba el mayor appliedMultiplier de la Hora base (APROBADO/
-- EN_REVISION) del mismo empleado+fecha, y 1 si no había base. Se congela
-- exactamente ese mismo valor, así ningún número histórico cambia por la
-- migración. Los desgloses sin base quedan en el default 1, igual que antes.
UPDATE "HourConceptBreakdown" AS b
SET "appliedMultiplier" = base."multiplier"
FROM (
  SELECT t."employeeId", t."date", MAX(t."appliedMultiplier") AS "multiplier"
  FROM "TimeEntry" t
  JOIN "HourConcept" h ON h."id" = t."hourConceptId"
  WHERE h."systemRole" = 'NORMAL_BASE' AND t."status" IN ('APROBADO', 'EN_REVISION')
  GROUP BY t."employeeId", t."date"
) AS base
WHERE b."employeeId" = base."employeeId"
  AND b."date" = base."date"
  AND base."multiplier" <> 1;
