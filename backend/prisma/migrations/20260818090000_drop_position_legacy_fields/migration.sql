-- Limpieza final de Position (2026-08-18): sectorId queda como unica fuente
-- oficial de ubicacion (Position.sectorId -> Sector.areaId -> Area.establishmentId
-- -> Establishment.businessUnitId -> BusinessUnit.companyId) y
-- PositionSalaryCategory como unica fuente de categoria salarial.
--
-- Se elimina la relacion Position.area (vestigial: areaId era una FK
-- independiente de sectorId, sin caso de negocio real confirmado) y los 8
-- campos string/JSON legado que duplicaban lo que ya se deriva de la cadena
-- real o de PositionSalaryCategory. Verificado antes de esta migracion: los
-- puestos reales en desarrollo ya tienen sectorId poblado, 0 casos de
-- revision manual pendientes, 0 inconsistencias areaId/sectorId.
--
-- No se borran filas de Position, SalaryCategory ni PositionSalaryCategory.
-- No se toca Sector, Area, Establishment, BusinessUnit, Company (jerarquia
-- organizacional ya cerrada), Turnos, fichador ni campos *ByUserId.

DROP INDEX "Position_areaId_sectorId_idx";
DROP INDEX "Position_areaId_idx";
ALTER TABLE "Position" DROP CONSTRAINT "Position_areaId_fkey";

ALTER TABLE "Position"
  DROP COLUMN "areaId",
  DROP COLUMN "areaDepartment",
  DROP COLUMN "sectorName",
  DROP COLUMN "businessUnitName",
  DROP COLUMN "establishmentName",
  DROP COLUMN "businessUnitNames",
  DROP COLUMN "establishmentNames",
  DROP COLUMN "sectorNames",
  DROP COLUMN "salaryRangeCategories";
