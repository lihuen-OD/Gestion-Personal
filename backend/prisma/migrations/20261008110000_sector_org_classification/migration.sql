-- A8-3: clasificación persistente legado/nuevo del sector
-- (docs/decisions/A8_M2_PREPARATION.md §3.4; ADR ORG_LOCATION_REORGANIZATION.md §20, hallazgo 1).
--
-- Antes de este cambio la clasificación se derivaba EN CADA LECTURA de
-- `Sector.businessUnitId IS NULL` (timeEntries.repository.ts, reglas de horas
-- especiales; orgStructure/positions, guardas de la estructura), de modo que
-- re-padrear un sector — o el NOT NULL de M2 — reinterpretaba la semántica de
-- las reglas existentes y su resolución histórica.
--
-- Esta migración es SÓLO aditiva:
--   * agrega la columna y clasifica los registros existentes con el CRITERIO
--     PREVIO, antes de cambiar cómo se deriva;
--   * no asigna padres nuevos ni modifica referencias históricas;
--   * no declara DEFAULT: un alta futura debe clasificar explícitamente, para
--     que ningún valor por defecto clasifique mal una fila nueva.
ALTER TABLE "Sector" ADD COLUMN "isLegacy" BOOLEAN;

-- Criterio previo, evaluado una única vez sobre el estado actual de la tabla.
UPDATE "Sector" SET "isLegacy" = ("businessUnitId" IS NULL);

ALTER TABLE "Sector" ALTER COLUMN "isLegacy" SET NOT NULL;
