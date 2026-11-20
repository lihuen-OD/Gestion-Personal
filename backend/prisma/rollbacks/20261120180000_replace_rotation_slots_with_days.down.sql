-- Reversión de 20261120180000_replace_rotation_slots_with_days (R4.1A,
-- docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.2).
-- Una sola transacción, con las tablas bloqueadas antes de comprobar nada.
--
-- Aborta sin cambios si existe algún día o bloque de rotación: es
-- configuración cargada por RRHH que no se puede convertir a ShiftRotationSlot
-- sin pérdida (un día con varios bloques no tiene representación en una
-- celda única). Eliminar esa configuración por su procedimiento controlado
-- antes de revertir; nunca forzar este rollback.
--
-- Recrea ShiftRotationSlot EXACTAMENTE como la dejó
-- 20261120120000_add_shift_rotations (tabla, únicos, índice, FKs y CHECK), de
-- modo que el schema vuelve a ser el de R4.1.
--
-- También borra la fila de esta migración de `_prisma_migrations` (patrón de
-- 20261009150000_org_location_contract_m2): el schema vuelve EXACTAMENTE al de
-- R4.1 y `prisma migrate status` la vuelve a mostrar pendiente.
-- (`prisma migrate resolve --rolled-back` no sirve: sólo aplica a migraciones
-- fallidas, P3012 — verificado en la validación local de R4.1A.)
--
-- Fuera del alcance de SQL (responsabilidad de quien la ejecuta): revertir
-- antes el código que lee/escribe ShiftRotationDay/ShiftRotationBlock. Orden:
-- este rollback debe correr ANTES que el de 20261120120000_add_shift_rotations
-- (que espera encontrar ShiftRotationSlot).
BEGIN;

LOCK TABLE "ShiftRotationBlock", "ShiftRotationDay" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  days integer;
  blocks integer;
BEGIN
  SELECT count(*) INTO days FROM "ShiftRotationDay";
  SELECT count(*) INTO blocks FROM "ShiftRotationBlock";
  IF days > 0 OR blocks > 0 THEN
    RAISE EXCEPTION 'Rollback abortado: % día(s) y % bloque(s) de rotación. Eliminar esa configuración por su procedimiento controlado antes de revertir.', days, blocks;
  END IF;
END $$;

-- Cada DROP TABLE arrastra sus índices, CHECK y FKs salientes.
DROP TABLE "ShiftRotationBlock";
DROP TABLE "ShiftRotationDay";

-- ShiftRotationSlot tal como en 20261120120000_add_shift_rotations.
CREATE TABLE "ShiftRotationSlot" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "cycleWeekIndex" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "kind" "ShiftRotationCellKind" NOT NULL,
    "shiftTemplateId" TEXT,

    CONSTRAINT "ShiftRotationSlot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShiftRotationSlot_shiftTemplateId_idx" ON "ShiftRotationSlot"("shiftTemplateId");
CREATE UNIQUE INDEX "ShiftRotationSlot_versionId_crewId_cycleWeekIndex_weekday_key" ON "ShiftRotationSlot"("versionId", "crewId", "cycleWeekIndex", "weekday");
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ShiftRotationVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "ShiftRotationCrew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_cycle_week_index_check" CHECK ("cycleWeekIndex" BETWEEN 0 AND 11);
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "ShiftRotationSlot" ADD CONSTRAINT "ShiftRotationSlot_kind_template_check" CHECK (
  ("kind" = 'SHIFT' AND "shiftTemplateId" IS NOT NULL) OR
  ("kind" = 'REST' AND "shiftTemplateId" IS NULL)
);

DELETE FROM "_prisma_migrations" WHERE migration_name = '20261120180000_replace_rotation_slots_with_days';

COMMIT;
