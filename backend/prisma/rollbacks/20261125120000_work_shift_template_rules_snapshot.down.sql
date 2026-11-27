-- Reversión de 20261125120000_work_shift_template_rules_snapshot (R4.6,
-- docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
-- Una sola transacción, con la tabla bloqueada antes de comprobar nada.
--
-- Aborta sin cambios si alguna jornada tiene "templateRulesSnapshot" cargado:
-- es la evidencia de las reglas con las que se evaluó esa jornada (historia) y
-- quitarla haría que su salida se reevalúe con la plantilla en vivo. Nunca
-- forzar este rollback ni vaciar la columna para poder revertir.
--
-- También borra la fila de esta migración de `_prisma_migrations` (patrón de
-- 20261120180000 y 20261121090000): `prisma migrate status` la vuelve a
-- mostrar pendiente (`prisma migrate resolve --rolled-back` sólo aplica a
-- migraciones fallidas, P3012).
--
-- Fuera del alcance de SQL: revertir antes el código que lee/escribe la
-- columna (R4.6). Orden: debe correr antes que los rollbacks de
-- 20261124120000, 20261121090000, 20261120180000 y 20261120120000.
BEGIN;

LOCK TABLE "WorkShift" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  with_snapshot integer;
BEGIN
  SELECT count(*) INTO with_snapshot FROM "WorkShift" WHERE "templateRulesSnapshot" IS NOT NULL;
  IF with_snapshot > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % jornada(s) con templateRulesSnapshot. Son historia de evaluación; no se revierte con datos.', with_snapshot;
  END IF;
END $$;

ALTER TABLE "WorkShift" DROP COLUMN "templateRulesSnapshot";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261125120000_work_shift_template_rules_snapshot';

COMMIT;
