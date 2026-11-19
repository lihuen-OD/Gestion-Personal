-- Reversión de 20261119120000_add_shift_groups (R3.1,
-- docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23).
-- Una sola transacción, con las tablas bloqueadas antes de comprobar nada.
--
-- Aborta sin cambios si existe algún grupo de turnos o alguna plantilla
-- clasificada en un grupo: es configuración cargada por RRHH (auditada) que no
-- se puede re-derivar de ningún otro dato (categoryName NO es el grupo).
-- Desclasificar las plantillas y eliminar los grupos desde la aplicación
-- (queda auditado) antes de revertir.
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que lee/escribe ShiftGroup y ShiftTemplate.shiftGroupId
-- (shifts/shiftGroup.*, workforce.service.ts) y, después,
-- `prisma migrate resolve --rolled-back 20261119120000_add_shift_groups`.
BEGIN;

LOCK TABLE "ShiftGroup", "ShiftTemplate" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  groups integer;
  classified integer;
BEGIN
  SELECT count(*) INTO groups FROM "ShiftGroup";
  SELECT count(*) INTO classified FROM "ShiftTemplate" WHERE "shiftGroupId" IS NOT NULL;
  IF groups > 0 OR classified > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % grupo(s) de turnos y % plantilla(s) clasificada(s). Desclasificar y eliminar los grupos desde la aplicación antes de revertir.', groups, classified;
  END IF;
END $$;

-- La FK, el índice y la columna de ShiftTemplate; después la tabla (arrastra
-- sus índices, el CHECK de forma y las FK de autoría).
ALTER TABLE "ShiftTemplate" DROP CONSTRAINT "ShiftTemplate_shiftGroupId_fkey";
DROP INDEX "ShiftTemplate_shiftGroupId_idx";
ALTER TABLE "ShiftTemplate" DROP COLUMN "shiftGroupId";
DROP TABLE "ShiftGroup";

COMMIT;
