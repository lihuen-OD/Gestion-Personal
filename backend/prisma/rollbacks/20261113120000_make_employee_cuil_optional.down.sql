-- Reversión de 20261113120000_make_employee_cuil_optional. Una sola
-- transacción, con "Employee" bloqueada antes de comprobar nada.
--
-- Aborta sin cambios si existe algún legajo sin CUIL: volver a exigir NOT NULL
-- obligaría a inventar o borrar datos. Esos legajos se completan antes con su
-- CUIL real (edición normal del legajo), nunca con un valor de relleno.
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que permite el alta sin CUIL y, después,
-- `prisma migrate resolve --rolled-back 20261113120000_make_employee_cuil_optional`.
BEGIN;

LOCK TABLE "Employee" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing FROM "Employee" WHERE "cuil" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % legajo(s) sin CUIL. Completar el CUIL real antes de revertir.', missing;
  END IF;
END $$;

ALTER TABLE "Employee" ALTER COLUMN "cuil" SET NOT NULL;

COMMIT;
