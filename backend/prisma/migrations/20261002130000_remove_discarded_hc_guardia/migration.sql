-- Elimina físicamente HC-GUARDIA (Guardia), concepto descartado por negocio
-- (misma idea que Sereno). Ver docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md.
--
-- Para bases donde 20261002120000_add_hour_concept_work_treatment ya se
-- aplicó con la versión que todavía mapeaba HC-GUARDIA (staging, 2026-10-02).
-- En una base nueva esa migración ya lo eliminó y este bloque es un no-op.
--
-- Mismas protecciones: sólo se borra si no hay historial real (horas,
-- segmentos, turnos, novedades, desgloses, ni tramos/desgloses que apunten a
-- sus reglas); si lo hubiera, aborta. Nunca se convierte a Sereno. Las
-- entradas de AuditLog que lo mencionan se conservan (entityId es texto, no
-- FK), igual que en la eliminación física que ya hace el CRUD de conceptos.
DO $$
DECLARE
  guardia_id TEXT;
BEGIN
  SELECT "id" INTO guardia_id FROM "HourConcept" WHERE "code" = 'HC-GUARDIA' AND "systemRole" IS NULL;
  IF guardia_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "TimeEntry" WHERE "hourConceptId" = guardia_id)
    OR EXISTS (SELECT 1 FROM "TimeSegment" WHERE "hourConceptId" = guardia_id)
    OR EXISTS (SELECT 1 FROM "WorkShift" WHERE "hourConceptId" = guardia_id)
    OR EXISTS (SELECT 1 FROM "Novelty" WHERE "targetHourConceptId" = guardia_id)
    OR EXISTS (SELECT 1 FROM "HourConceptBreakdown" WHERE "hourConceptId" = guardia_id)
    OR EXISTS (
      SELECT 1 FROM "TimeSegment" s JOIN "HourConceptRule" r ON r."id" = s."hourConceptRuleId"
      WHERE r."hourConceptId" = guardia_id
    )
    OR EXISTS (
      SELECT 1 FROM "HourConceptBreakdown" b JOIN "HourConceptRule" r ON r."id" = b."hourConceptRuleId"
      WHERE r."hourConceptId" = guardia_id
    )
  THEN
    RAISE EXCEPTION 'HC-GUARDIA tiene historial real (horas, segmentos, turnos, novedades o desgloses): no se elimina físicamente. Auditar antes de migrar.';
  END IF;
  -- Sólo configuración: habilitaciones por legajo y reglas horarias propias.
  DELETE FROM "EmployeeHourConcept" WHERE "hourConceptId" = guardia_id;
  DELETE FROM "HourConceptRule" WHERE "hourConceptId" = guardia_id;
  DELETE FROM "HourConcept" WHERE "id" = guardia_id;
END $$;
