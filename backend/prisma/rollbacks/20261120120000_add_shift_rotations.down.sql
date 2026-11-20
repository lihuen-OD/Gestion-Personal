-- Reversión de 20261120120000_add_shift_rotations (R4.1,
-- docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §24).
-- Una sola transacción, con las tablas bloqueadas antes de comprobar nada.
--
-- Aborta sin cambios si existe cualquier dato de rotaciones (rotación,
-- versión, equipo, membresía o celda) o alguna jornada con
-- WorkShift.shiftTemplateSource o WorkShift.scheduledStartAt cargados: es
-- planificación e historia que no se puede re-derivar de ningún otro dato
-- (ni de ShiftAssignment ni del turno adoptado). Cerrar o eliminar esa
-- configuración por su procedimiento controlado antes de revertir; nunca
-- forzar este rollback.
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que lee/escribe estas tablas y columnas y, después,
-- `prisma migrate resolve --rolled-back 20261120120000_add_shift_rotations`.
-- La extensión btree_gist NO se elimina: existía antes (M1) y la usan otras
-- tablas.
BEGIN;

LOCK TABLE "ShiftRotationSlot", "ShiftRotationCrewMember", "ShiftRotationCrew", "ShiftRotationVersion", "ShiftRotation", "WorkShift" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  rotations integer;
  versions integer;
  crews integer;
  members integer;
  slots integer;
  sourced_shifts integer;
  scheduled_shifts integer;
BEGIN
  SELECT count(*) INTO rotations FROM "ShiftRotation";
  SELECT count(*) INTO versions FROM "ShiftRotationVersion";
  SELECT count(*) INTO crews FROM "ShiftRotationCrew";
  SELECT count(*) INTO members FROM "ShiftRotationCrewMember";
  SELECT count(*) INTO slots FROM "ShiftRotationSlot";
  SELECT count(*) INTO sourced_shifts FROM "WorkShift" WHERE "shiftTemplateSource" IS NOT NULL;
  SELECT count(*) INTO scheduled_shifts FROM "WorkShift" WHERE "scheduledStartAt" IS NOT NULL;
  IF rotations > 0 OR versions > 0 OR crews > 0 OR members > 0 OR slots > 0 OR sourced_shifts > 0 OR scheduled_shifts > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % rotación(es), % versión(es), % equipo(s), % membresía(s), % celda(s), % jornada(s) con fuente de turno y % jornada(s) con inicio programado. Eliminar esa configuración e historia por su procedimiento controlado antes de revertir.',
      rotations, versions, crews, members, slots, sourced_shifts, scheduled_shifts;
  END IF;
END $$;

-- Columnas de WorkShift; después las tablas en orden de dependencia (cada
-- DROP TABLE arrastra sus índices, CHECK, EXCLUDE y FKs salientes); por
-- último los enums, ya sin columnas que los usen.
ALTER TABLE "WorkShift" DROP COLUMN "shiftTemplateSource";
ALTER TABLE "WorkShift" DROP COLUMN "scheduledStartAt";
DROP TABLE "ShiftRotationSlot";
DROP TABLE "ShiftRotationCrewMember";
DROP TABLE "ShiftRotationCrew";
DROP TABLE "ShiftRotationVersion";
DROP TABLE "ShiftRotation";
DROP TYPE "ShiftTemplateSource";
DROP TYPE "ShiftRotationCellKind";

COMMIT;
