-- Etapa 15L.6 (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md)
-- Retiro controlado de campos legacy en NoveltyType + simplificación 1:1 de
-- FinnegansNoveltyLink. Migración destructiva pero segura: primero se
-- agregan las columnas nuevas y se copian los datos reales (única fila
-- productiva confirmada en Neon: NoveltyType "NOV-LLEGADA-TARDE" con
-- exactamente 1 FinnegansNoveltyLink activo), recién después se elimina lo
-- viejo.

-- AlterTable: agrega finnegansCode/finnegansName ANTES de tocar nada más,
-- para poder copiar datos antes del DROP TABLE.
ALTER TABLE "NoveltyType" ADD COLUMN     "finnegansCode" TEXT,
ADD COLUMN     "finnegansName" TEXT;

-- Copia el código/nombre del vínculo Finnegans PRINCIPAL de cada tipo hacia
-- las columnas nuevas, antes de eliminar FinnegansNoveltyLink. Mismo
-- desempate que finnegansExport.principalLink.ts::resolvePrincipalFinnegansLink
-- (ya retirado en esta etapa junto con la tabla 1:N que resolvía): entre los
-- vínculos ACTIVO de cada NoveltyType, gana el de menor "priority", empate
-- estable por "code". Un NoveltyType sin ningún vínculo ACTIVO queda con
-- finnegansCode/finnegansName en NULL (no tenía nada exportable configurado
-- de todas formas).
UPDATE "NoveltyType" AS nt
SET "finnegansCode" = principal.code,
    "finnegansName" = principal.name
FROM (
  SELECT DISTINCT ON ("noveltyTypeId") "noveltyTypeId", code, name
  FROM "FinnegansNoveltyLink"
  WHERE status = 'ACTIVO'
  ORDER BY "noveltyTypeId", priority ASC, code ASC
) AS principal
WHERE nt.id = principal."noveltyTypeId";

-- DropForeignKey
ALTER TABLE "FinnegansNoveltyLink" DROP CONSTRAINT "FinnegansNoveltyLink_noveltyTypeId_fkey";

-- AlterTable: retira los 6 campos legacy (Etapa 15L.2A los dejó como
-- compatibilidad-solamente; auditoría de esta etapa confirmó cero
-- consumidores productivos reales).
ALTER TABLE "NoveltyType" DROP COLUMN "allowsDateTo",
DROP COLUMN "blocksTimeEntry",
DROP COLUMN "hasValidity",
DROP COLUMN "origin",
DROP COLUMN "setsWorkedHoursToZero",
DROP COLUMN "timeImpact";

-- DropTable: FinnegansNoveltyLink (1:N) -- migrado a NoveltyType.finnegansCode
-- / finnegansName (1:1 físico), evidencia: ningún NoveltyType real tiene más
-- de 1 vínculo activo.
DROP TABLE "FinnegansNoveltyLink";

-- DropEnum
DROP TYPE "NoveltyTimeImpact";

-- DropEnum
DROP TYPE "NoveltyTypeOrigin";
