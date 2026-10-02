-- Quita la baja lógica de HourConcept (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §14).
--
-- Política vigente:
--   * Deshabilitar = status INACTIVO. Conserva el concepto, sus desgloses,
--     reglas e historial, e impide nuevas cargas/aplicaciones.
--   * Eliminar definitivamente = borrado físico del concepto y de su
--     historial específico (hourConcepts.repository.ts::deletePermanently).
--     El código queda libre para reutilizarse.
--
-- Una fila con deletedAt fue "eliminada conservando la trazabilidad" con la
-- política anterior, que es exactamente lo que hoy significa Deshabilitar.
-- Se normaliza a INACTIVO (la baja lógica ya lo hacía; esto sólo cubre una
-- fila reactivada a mano por API) y vuelve a verse en el catálogo, donde RRHH
-- puede habilitarla o eliminarla definitivamente. No se borra ni reinterpreta
-- ninguna hora. Las entradas de AuditLog de esas bajas se conservan.
UPDATE "HourConcept"
SET "status" = 'INACTIVO'
WHERE "deletedAt" IS NOT NULL AND "status" <> 'INACTIVO';

-- El CHECK del modelo oficial referencia deletedAt para NORMAL_BASE: se
-- recrea igual, sin esa condición (Postgres lo descartaría en silencio al
-- borrar la columna).
ALTER TABLE "HourConcept" DROP CONSTRAINT "HourConcept_official_model_check";

ALTER TABLE "HourConcept" DROP COLUMN "deletedAt";

ALTER TABLE "HourConcept"
ADD CONSTRAINT "HourConcept_official_model_check" CHECK (
  (
    "systemRole" = 'NORMAL_BASE'
    AND "kind" = 'NORMAL'
    AND "status" = 'ACTIVO'
    AND "loadMode" IS NULL
  )
  OR
  (
    "systemRole" IS NULL
    AND "kind" <> 'NORMAL'
    AND "loadMode" IS NOT NULL
  )
);
