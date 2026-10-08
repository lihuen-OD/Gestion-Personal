-- A8-1 / A8-3 extensión: archivo de catálogo y clasificación persistente en
-- Área y Establecimiento (docs/decisions/A8_M2_PREPARATION.md §12.1 y §12.9.8).
--
-- SÓLO aditiva, sin datos de ejemplo y sin tocar nada que exista:
--   * `archivedAt` en los seis modelos de catálogo (Company, BusinessUnit,
--     Establishment, Area, Sector, Position): nula en todas las filas
--     existentes. La transacción de limpieza (B3) es la ÚNICA escritura
--     prevista; ninguna ruta de alta ni de edición la setea. Sin DEFAULT:
--     un alta futura no puede "quedar archivada" por un valor por defecto.
--   * `isLegacy` en Area y Establishment, clasificación de origen persistida
--     con el mismo criterio que ya se usaba EN CADA LECTURA (Area sin
--     sectorId del modelo objetivo; Establishment sin zoneId): se evalúa una
--     única vez aquí y desde entonces no se rederiva, igual que
--     `Sector.isLegacy` en 20261008110000. Sin DEFAULT: el alta clasifica
--     explícitamente.
--   * no borra columnas, no cambia FKs ni índices, no re-clasifica nada que
--     exista salvo el backfill declarado abajo.
-- Reversión: prisma/rollbacks/20261008150000_org_catalog_archive_classification.down.sql.
ALTER TABLE "Company" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "BusinessUnit" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Establishment" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Area" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Sector" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Position" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

ALTER TABLE "Area" ADD COLUMN "isLegacy" BOOLEAN;

-- Criterio previo, evaluado una única vez sobre el estado actual de la tabla
-- (mismo criterio que 20261008110000 usó para Sector).
UPDATE "Area" SET "isLegacy" = ("sectorId" IS NULL);

ALTER TABLE "Area" ALTER COLUMN "isLegacy" SET NOT NULL;

ALTER TABLE "Establishment" ADD COLUMN "isLegacy" BOOLEAN;

UPDATE "Establishment" SET "isLegacy" = ("zoneId" IS NULL);

ALTER TABLE "Establishment" ALTER COLUMN "isLegacy" SET NOT NULL;
