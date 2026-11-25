-- Reversión de 20261124120000_shift_alert_unscheduled_work_types (R4.5,
-- docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.7).
-- Una sola transacción, con la tabla bloqueada antes de comprobar nada.
--
-- Aborta sin cambios si alguna alerta usa TRABAJO_NO_PROGRAMADO o
-- INGRESO_FUERA_DE_VENTANA: son historia (clasificación y revisión de
-- jornadas reales) y nunca se borran para poder revertir. Antes, volver al
-- código anterior a R4.5 y decidir esas filas por un procedimiento autorizado.
--
-- PostgreSQL no permite quitar valores de un enum: se recrea el tipo con los
-- valores previos, en el mismo orden que dejó el historial de migraciones.
-- También borra la fila de esta migración de `_prisma_migrations` (patrón de
-- 20261121090000): `prisma migrate status` la vuelve a mostrar pendiente
-- (`prisma migrate resolve --rolled-back` sólo aplica a migraciones fallidas).
BEGIN;

LOCK TABLE "ShiftAlert" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  in_use integer;
BEGIN
  SELECT count(*) INTO in_use FROM "ShiftAlert" WHERE "type"::text IN ('TRABAJO_NO_PROGRAMADO', 'INGRESO_FUERA_DE_VENTANA');
  IF in_use > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % alerta(s) usan TRABAJO_NO_PROGRAMADO o INGRESO_FUERA_DE_VENTANA.', in_use;
  END IF;
END $$;

ALTER TYPE "ShiftAlertType" RENAME TO "ShiftAlertType_r45_old";
CREATE TYPE "ShiftAlertType" AS ENUM (
  'INGRESO_TARDE', 'SALIDA_ANTICIPADA', 'SALIDA_TARDIA', 'TURNO_NO_IDENTIFICADO',
  'SHIFT_NOT_ENABLED_FOR_EMPLOYEE', 'POSSIBLE_SHIFT_CONFIGURATION_MISSING',
  'JORNADA_INSUFICIENTE', 'JORNADA_EXTENDIDA', 'DESCANSO_INSUFICIENTE',
  'POSIBLE_OLVIDO_SALIDA', 'CONCEPTO_NO_HABILITADO', 'SEGMENTO_SIN_CLASIFICAR',
  'INGRESO_ANTICIPADO', 'JORNADA_FUERA_DE_TURNO', 'ACTIVIDAD_EN_FRANCO',
  'ACTIVIDAD_SOBRE_CARGA_MANUAL'
);
ALTER TABLE "ShiftAlert" ALTER COLUMN "type" TYPE "ShiftAlertType" USING ("type"::text::"ShiftAlertType");
DROP TYPE "ShiftAlertType_r45_old";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261124120000_shift_alert_unscheduled_work_types';

COMMIT;
