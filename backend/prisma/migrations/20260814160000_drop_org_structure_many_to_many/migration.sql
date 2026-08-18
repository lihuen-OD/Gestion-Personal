-- Simplificación de jerarquía organizacional (2026-08-14): el FK legado
-- (BusinessUnit.companyId, Establishment.companyId/businessUnitId,
-- Area.establishmentId, Sector.areaId) queda como única fuente de verdad para
-- Company -> BusinessUnit -> Establishment -> Area -> Sector.
--
-- Se eliminan las 7 tablas M:N que duplicaban o derivaban ese mismo vínculo,
-- confirmado (ver diagnóstico previo) que ningún módulo operativo (legajos,
-- puestos, dashboard) las leía — solo el propio catálogo de Estructura
-- Organizacional, que pasa a usar el FK legado directamente.
--
-- Esta migración SÍ borra datos: las filas de estas 7 tablas (metadata de
-- catálogo, no datos operativos de legajos/fichadas/novedades). No se toca
-- ninguna tabla de CostCenter (CostCenterCompany, CostCenterBusinessUnit,
-- CostCenterEstablishment, CostCenterArea, CostCenterSector), que siguen
-- siendo la única fuente de verdad para esas relaciones.

DROP TABLE "BusinessUnitCompany";
DROP TABLE "EstablishmentCompany";
DROP TABLE "EstablishmentBusinessUnit";
DROP TABLE "AreaEstablishment";
DROP TABLE "AreaBusinessUnit";
DROP TABLE "SectorArea";
DROP TABLE "SectorEstablishment";
