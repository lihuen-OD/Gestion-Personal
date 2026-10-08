-- Reversión de 20261008150000_org_catalog_archive_classification.
-- Sólo retirar columnas aditivas; no restaura ni altera ningún dato previo
-- (las columnas se crearon vacías salvo los `isLegacy` derivados, cuyo
-- significado se rederiva de nuevo en cada lectura al retirarlos).
ALTER TABLE "Position" DROP COLUMN "archivedAt";
ALTER TABLE "Sector" DROP COLUMN "archivedAt";
ALTER TABLE "Area" DROP COLUMN "archivedAt";
ALTER TABLE "Establishment" DROP COLUMN "archivedAt";
ALTER TABLE "BusinessUnit" DROP COLUMN "archivedAt";
ALTER TABLE "Company" DROP COLUMN "archivedAt";

ALTER TABLE "Establishment" DROP COLUMN "isLegacy";
ALTER TABLE "Area" DROP COLUMN "isLegacy";
