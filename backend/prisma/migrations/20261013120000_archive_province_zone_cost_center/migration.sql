-- Eliminación controlada con dependencias (shared/deletion): Provincia, Zona y
-- Centro de costo pasan a tener archivo de un solo sentido, como el resto de
-- la estructura (Company/BusinessUnit/Sector/Area/Establishment/Position/
-- EstablishmentUnit ya lo tienen desde A8).
-- Migración ADITIVA: sólo agrega columnas nulas. No modifica datos: ninguna
-- fila queda archivada al aplicarla.

-- AlterTable
ALTER TABLE "CostCenter" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Province" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);
