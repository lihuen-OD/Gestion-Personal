-- Rol estable para conceptos administrados por el sistema. No depende de
-- nombres, códigos ni del kind, que eran ambiguos en los datos legacy.
CREATE TYPE "HourConceptSystemRole" AS ENUM ('NORMAL_BASE');

ALTER TABLE "HourConcept"
ADD COLUMN "systemRole" "HourConceptSystemRole";

-- La base de desarrollo ya contiene HC-NORMAL y conserva historial asociado.
-- Se recupera esa misma fila en lugar de crear otra y romper referencias.
UPDATE "HourConcept"
SET
  "name" = 'Hora normal',
  "kind" = 'NORMAL',
  "status" = 'ACTIVO',
  "deletedAt" = NULL,
  "loadMode" = NULL,
  "countsAsWorked" = TRUE,
  "systemRole" = 'NORMAL_BASE'
WHERE "code" = 'HC-NORMAL';

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "HourConcept" WHERE "systemRole" = 'NORMAL_BASE') <> 1 THEN
    RAISE EXCEPTION 'Debe existir exactamente un concepto horario NORMAL_BASE (HC-NORMAL)';
  END IF;
END $$;

-- Horas normales nunca se habilita por legajo: está disponible para todos.
DELETE FROM "EmployeeHourConcept"
WHERE "hourConceptId" IN (
  SELECT "id" FROM "HourConcept" WHERE "systemRole" = 'NORMAL_BASE'
);

-- Correcciones explícitas del catálogo demo auditado.
UPDATE "HourConcept"
SET "name" = 'Sereno', "kind" = 'SERENO', "status" = 'ACTIVO',
    "deletedAt" = NULL, "loadMode" = 'AUTOMATIC', "systemRole" = NULL
WHERE "code" = 'HOR-001';

UPDATE "HourConcept"
SET "name" = 'Colectivo', "kind" = 'TRANSPORTE', "status" = 'ACTIVO',
    "deletedAt" = NULL, "loadMode" = 'MANUAL', "systemRole" = NULL
WHERE "code" = 'HOR-002';

UPDATE "HourConcept"
SET "name" = 'Guardia', "kind" = 'GUARDIA', "status" = 'ACTIVO',
    "deletedAt" = NULL, "loadMode" = 'AUTOMATIC', "systemRole" = NULL
WHERE "code" = 'HC-GUARDIA';

-- Normaliza cualquier otro concepto legacy sin inventar automatismos: sólo
-- los tipos inherentemente horarios reciben AUTOMATIC; el resto queda MANUAL.
UPDATE "HourConcept"
SET "kind" = 'OTRO'
WHERE "systemRole" IS NULL AND "kind" = 'NORMAL';

UPDATE "HourConcept"
SET "loadMode" = CASE
  WHEN "kind" IN ('NOCTURNA', 'GUARDIA', 'SERENO') THEN 'AUTOMATIC'::"HourConceptLoadMode"
  ELSE 'MANUAL'::"HourConceptLoadMode"
END
WHERE "systemRole" IS NULL AND "loadMode" IS NULL;

CREATE UNIQUE INDEX "HourConcept_systemRole_key"
ON "HourConcept"("systemRole");

-- Prisma deja loadMode nullable porque NORMAL_BASE legítimamente no lo usa.
-- El CHECK expresa la obligatoriedad real para todos los adicionales y evita
-- reintroducir otro kind NORMAL por fuera del concepto canónico.
ALTER TABLE "HourConcept"
ADD CONSTRAINT "HourConcept_official_model_check" CHECK (
  (
    "systemRole" = 'NORMAL_BASE'
    AND "kind" = 'NORMAL'
    AND "status" = 'ACTIVO'
    AND "deletedAt" IS NULL
    AND "loadMode" IS NULL
  )
  OR
  (
    "systemRole" IS NULL
    AND "kind" <> 'NORMAL'
    AND "loadMode" IS NOT NULL
  )
);
