-- Reversión de 20261126120000_add_user_shift_group_scopes (R8,
-- docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26).
-- Una sola transacción, con la tabla bloqueada antes de comprobar nada.
--
-- Aborta sin cambios si existe algún alcance asignado: es configuración de
-- permisos cargada por RRHH y no se puede re-derivar de ningún otro dato.
-- Quitar esos alcances desde Usuarios y roles (queda auditado) antes de
-- revertir. Nunca vaciar la tabla a mano para poder revertir.
--
-- También borra la fila de esta migración de `_prisma_migrations` (patrón de
-- 20261125120000): `prisma migrate status` la vuelve a mostrar pendiente
-- (`prisma migrate resolve --rolled-back` sólo aplica a migraciones
-- fallidas, P3012).
--
-- Fuera del alcance de SQL: revertir antes el código que lee/escribe esta
-- tabla (shiftGroupAccess.ts, módulo users).
BEGIN;

LOCK TABLE "UserShiftGroupScope" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  used integer;
BEGIN
  SELECT count(*) INTO used FROM "UserShiftGroupScope";
  IF used > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % alcance(s) de grupos de turnos asignados. Quitarlos desde Usuarios y roles antes de revertir.', used;
  END IF;
END $$;

DROP TABLE "UserShiftGroupScope";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261126120000_add_user_shift_group_scopes';

COMMIT;
