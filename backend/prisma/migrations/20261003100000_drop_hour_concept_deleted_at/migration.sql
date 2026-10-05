-- Quita la baja lógica de HourConcept (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §14).
--
-- Política vigente:
--   * Deshabilitar = status INACTIVO. Conserva el concepto, sus desgloses,
--     reglas e historial, e impide nuevas cargas/aplicaciones.
--   * Eliminar definitivamente = borrado físico del concepto y de su
--     historial específico (hourConcepts.repository.ts::deletePermanently).
--     El código queda libre para reutilizarse.
--
-- Deuda de la política anterior: una fila con deletedAt seguía ocupando su
-- UNIQUE(code). Se limpian TODAS las bajas lógicas, no códigos puntuales, con
-- la misma política del DELETE actual. Si alguna conserva TimeEntry legacy,
-- se aborta toda la migración antes de modificar nada: puede representar
-- jornada física y requiere auditoría manual.
DO $$
DECLARE
  unsafe_concepts text;
BEGIN
  SELECT string_agg(hc."code" || ' (' || counts.entries || ' TimeEntry)', ', ' ORDER BY hc."code")
  INTO unsafe_concepts
  FROM "HourConcept" hc
  JOIN LATERAL (
    SELECT count(*)::text AS entries
    FROM "TimeEntry" te
    WHERE te."hourConceptId" = hc."id"
  ) counts ON true
  WHERE hc."deletedAt" IS NOT NULL AND counts.entries::int > 0;

  IF unsafe_concepts IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden limpiar conceptos horarios legacy con TimeEntry: %. Auditar antes de migrar.', unsafe_concepts;
  END IF;
END $$;

-- Evidencia física: conserva jornadas/minutos y vuelve a Hora normal, igual
-- que hourConceptsRepository.deletePermanently. Las fichadas no se tocan.
UPDATE "TimeSegment" segment
SET "hourConceptId" = normal."id",
    "hourConceptName" = normal."name",
    "hourConceptRuleId" = NULL,
    "conceptStatus" = 'SIN_CONCEPTO_COMPATIBLE'
FROM "HourConcept" legacy
CROSS JOIN "HourConcept" normal
WHERE legacy."deletedAt" IS NOT NULL
  AND normal."systemRole" = 'NORMAL_BASE'
  AND segment."hourConceptId" = legacy."id";

UPDATE "WorkShift" work_shift
SET "hourConceptId" = normal."id",
    "hourConceptName" = normal."name"
FROM "HourConcept" legacy
CROSS JOIN "HourConcept" normal
WHERE legacy."deletedAt" IS NOT NULL
  AND normal."systemRole" = 'NORMAL_BASE'
  AND work_shift."hourConceptId" = legacy."id";

UPDATE "Novelty" novelty
SET "targetHourConceptId" = NULL
FROM "HourConcept" legacy
WHERE legacy."deletedAt" IS NOT NULL
  AND novelty."targetHourConceptId" = legacy."id";

-- Historial/configuración propios del concepto descartado.
DELETE FROM "HourConceptBreakdown" breakdown
USING "HourConcept" legacy
WHERE legacy."deletedAt" IS NOT NULL
  AND breakdown."hourConceptId" = legacy."id";

DELETE FROM "HourConceptRule" rule
USING "HourConcept" legacy
WHERE legacy."deletedAt" IS NOT NULL
  AND rule."hourConceptId" = legacy."id";

DELETE FROM "EmployeeHourConcept" assignment
USING "HourConcept" legacy
WHERE legacy."deletedAt" IS NOT NULL
  AND assignment."hourConceptId" = legacy."id";

DELETE FROM "HourConcept" WHERE "deletedAt" IS NOT NULL;

-- El CHECK del modelo oficial referencia deletedAt para NORMAL_BASE: se
-- recrea igual, sin esa condición (Postgres lo descartaría en silencio al
-- borrar la columna).
ALTER TABLE "HourConcept" DROP CONSTRAINT "HourConcept_official_model_check";

ALTER TABLE "HourConcept" DROP COLUMN "deletedAt";

ALTER TABLE "HourConcept"
ADD CONSTRAINT "HourConcept_official_model_check" CHECK (
  (
    "systemRole" = 'NORMAL_BASE'
    AND "kind" = 'NORMAL'
    AND "status" = 'ACTIVO'
    AND "loadMode" IS NULL
  )
  OR
  (
    "systemRole" IS NULL
    AND "kind" <> 'NORMAL'
    AND "loadMode" IS NOT NULL
  )
);
