-- Incidentes de inactividad por BLOQUE — R4.3a
-- (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.4).
--
-- AttendanceInactivityIncident era único por (employeeId, operationalDate): una
-- sola fila por persona y día. Con rotaciones reales un día puede tener varios
-- bloques (José, viernes A: 07:00–11:00 y 19:00–07:00) y cada uno necesita su
-- propia falta de ingreso. Esta migración:
--   1. agrega "scheduledStartAt" (nullable, sin default ni backfill: sólo
--      metadata, la tabla no se reescribe). NULL = incidente de día (TODOS los
--      históricos, SIN_ACTIVIDAD_REGISTRADA y la falta de ingreso de turnos
--      fijos); NOT NULL = falta de ingreso de un bloque (instante programado).
--   2. crea la nueva unicidad ANTES de quitar la vieja (nunca hay un instante
--      sin unicidad): índice único de EXPRESIÓN
--        ("employeeId", "operationalDate", COALESCE("scheduledStartAt", '-infinity'))
--      = una fila de día por persona y fecha, y una por bloque (equivale a
--      NULLS NOT DISTINCT). Escrito a mano: Prisma no modela índices de
--      expresión ni NULLS NOT DISTINCT y no los compara en `migrate diff`
--      (mismo patrón que los índices lower() de 20261119120000/20261120120000).
--      `createMany({ skipDuplicates })` (ON CONFLICT DO NOTHING) lo respeta.
--   3. quita el índice único anterior.
-- Ninguna fila se modifica: sin UPDATE, INSERT ni DELETE. Ningún código escribe
-- todavía "scheduledStartAt" (eso es R4.3b). Todo el script corre en una sola
-- transacción (una consulta multi-sentencia): si una guarda aborta, no queda
-- ningún cambio.

-- Escrituras bloqueadas durante la migración (ADD COLUMN toma este lock igual).
LOCK TABLE "AttendanceInactivityIncident" IN ACCESS EXCLUSIVE MODE;

-- Precondiciones.
DO $$
DECLARE
  duplicated integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AttendanceInactivityIncident' AND column_name = 'scheduledStartAt') THEN
    RAISE EXCEPTION 'Migración abortada: AttendanceInactivityIncident ya tiene la columna scheduledStartAt.';
  END IF;
  SELECT count(*) INTO duplicated FROM (
    SELECT 1 FROM "AttendanceInactivityIncident" GROUP BY "employeeId", "operationalDate" HAVING count(*) > 1
  ) AS duplicates;
  IF duplicated > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % par(es) (empleado, fecha) repetidos en AttendanceInactivityIncident.', duplicated;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "AttendanceInactivityIncident" ADD COLUMN     "scheduledStartAt" TIMESTAMPTZ(3);

-- CreateIndex (a mano: unicidad por día o por bloque; ver encabezado)
CREATE UNIQUE INDEX "AttendanceInactivityIncident_block_key" ON "AttendanceInactivityIncident"("employeeId", "operationalDate", COALESCE("scheduledStartAt", '-infinity'::timestamptz));

-- DropIndex
DROP INDEX "AttendanceInactivityIncident_employeeId_operationalDate_key";

-- Postcondiciones: ninguna fila con bloque, unicidad por (empleado, fecha)
-- intacta para los históricos, índice nuevo presente y viejo ausente.
DO $$
DECLARE
  with_block integer;
  total integer;
  pairs integer;
BEGIN
  SELECT count(*) FILTER (WHERE "scheduledStartAt" IS NOT NULL), count(*), count(DISTINCT ("employeeId", "operationalDate"))
    INTO with_block, total, pairs
    FROM "AttendanceInactivityIncident";
  IF with_block > 0 OR total <> pairs THEN
    RAISE EXCEPTION 'Migración abortada (postcondición): % fila(s) con bloque, % fila(s), % par(es) (empleado, fecha).', with_block, total, pairs;
  END IF;
  IF to_regclass('public."AttendanceInactivityIncident_block_key"') IS NULL OR to_regclass('public."AttendanceInactivityIncident_employeeId_operationalDate_key"') IS NOT NULL THEN
    RAISE EXCEPTION 'Migración abortada (postcondición): índices inesperados en AttendanceInactivityIncident.';
  END IF;
END $$;
