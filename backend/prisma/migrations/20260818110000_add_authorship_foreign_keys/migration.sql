-- Trazabilidad de autoria (2026-08-18): 11 campos "quien hizo esto" que hoy
-- son un String suelto pasan a tener una FK real a User, con el mismo patron
-- ya usado en los otros 17 campos equivalentes del esquema (FK opcional,
-- ON DELETE SET NULL). No se borra ningun dato: verificado antes de esta
-- migracion que ninguno de estos 11 campos apunta hoy a un userId
-- inexistente en la base de desarrollo (0 casos).
--
-- No se toca Turnos como concepto de negocio, ni Position, ni la jerarquia
-- organizacional, ni el fichador: solo se agrega la FK que faltaba sobre
-- columnas que ya existian.

ALTER TABLE "Novelty" ADD CONSTRAINT "Novelty_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkShift" ADD CONSTRAINT "WorkShift_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkShift" ADD CONSTRAINT "WorkShift_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_disabledByUserId_fkey" FOREIGN KEY ("disabledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftAlert" ADD CONSTRAINT "ShiftAlert_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DoubleHourRule" ADD CONSTRAINT "DoubleHourRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditParameter: opcion 2 de la decision de negocio — renombrar createdBy/
-- updatedBy a createdByUserId/updatedByUserId, agregar createdByUserName/
-- updatedByUserName como snapshot de texto, y mover a esas columnas el
-- literal "Sistema" (y cualquier otro valor no-UUID) que hoy vive en las
-- columnas viejas, dejando el id en null en vez de inventar un usuario.
-- Verificado antes de esta migracion: 5/5 filas reales tenian "Sistema"
-- en ambas columnas.

ALTER TABLE "AuditParameter" RENAME COLUMN "createdBy" TO "createdByUserId";
ALTER TABLE "AuditParameter" RENAME COLUMN "updatedBy" TO "updatedByUserId";
ALTER TABLE "AuditParameter" ADD COLUMN "createdByUserName" TEXT;
ALTER TABLE "AuditParameter" ADD COLUMN "updatedByUserName" TEXT;

UPDATE "AuditParameter"
SET "createdByUserName" = "createdByUserId", "createdByUserId" = NULL
WHERE "createdByUserId" IS NOT NULL
  AND "createdByUserId" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

UPDATE "AuditParameter"
SET "updatedByUserName" = "updatedByUserId", "updatedByUserId" = NULL
WHERE "updatedByUserId" IS NOT NULL
  AND "updatedByUserId" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

ALTER TABLE "AuditParameter" ADD CONSTRAINT "AuditParameter_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditParameter" ADD CONSTRAINT "AuditParameter_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
