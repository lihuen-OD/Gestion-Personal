-- Reversión de 20261117120000_add_user_supervision_assignment.
-- Una sola transacción, con la tabla bloqueada antes de comprobar nada.
--
-- Aborta sin cambios si existe alguna relación Nivel 2 → Nivel 3: es
-- configuración de permisos cargada por RRHH y no se puede re-derivar de
-- ningún otro dato. Quitar esas relaciones desde Usuarios y roles (queda
-- auditado) antes de revertir.
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que lee/escribe esta tabla (employeeAccess.ts, módulo
-- users) y, después,
-- `prisma migrate resolve --rolled-back 20261117120000_add_user_supervision_assignment`.
BEGIN;

LOCK TABLE "UserSupervisionAssignment" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  used integer;
BEGIN
  SELECT count(*) INTO used FROM "UserSupervisionAssignment";
  IF used > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % relación(es) de supervisión Nivel 2 → Nivel 3 existentes. Quitarlas desde Usuarios y roles antes de revertir.', used;
  END IF;
END $$;

DROP TABLE "UserSupervisionAssignment";

COMMIT;
