-- Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md)
-- Normalizacion aditiva del modelo NoveltyType. No elimina ninguna columna
-- legacy (origin, allowsDateTo, hasValidity, blocksTimeEntry,
-- setsWorkedHoursToZero, timeImpact) ni cambia su comportamiento de lectura
-- actual (findBlockingNovelty en time-entries sigue leyendolas igual).

-- CreateEnum
CREATE TYPE "NoveltyTimeEntryBehavior" AS ENUM ('NO_BLOQUEA', 'BLOQUEA_NUEVA_CARGA');

-- CreateEnum
CREATE TYPE "FinnegansValueUnit" AS ENUM ('HOURS', 'DAYS', 'UNIT');

-- AlterTable
ALTER TABLE "NoveltyType"
  ADD COLUMN     "notes" TEXT,
  ADD COLUMN     "allowsDateRange" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN     "timeEntryBehavior" "NoveltyTimeEntryBehavior" NOT NULL DEFAULT 'NO_BLOQUEA',
  ADD COLUMN     "finnegansValueUnit" "FinnegansValueUnit",
  ADD COLUMN     "finnegansRequiresValidity" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (Etapa 15L.2A, punto 8): calcular los campos nuevos a partir de
-- los legacy para cada NoveltyType existente. No se infiere DAYS/UNIT sin
-- evidencia -- finnegansValueUnit queda NULL salvo que allowsHours = true.

-- allowsDateRange: copia directa de allowsDateTo.
UPDATE "NoveltyType" SET "allowsDateRange" = "allowsDateTo";

-- finnegansRequiresValidity: copia directa de hasValidity.
UPDATE "NoveltyType" SET "finnegansRequiresValidity" = "hasValidity";

-- timeEntryBehavior: BLOQUEA_NUEVA_CARGA si cualquiera de los 3 campos
-- legacy ya bloqueaba carga horaria; NO_BLOQUEA en caso contrario (ya es el
-- default de la columna, este UPDATE solo corrige las filas que bloquean).
UPDATE "NoveltyType"
SET "timeEntryBehavior" = 'BLOQUEA_NUEVA_CARGA'
WHERE "blocksTimeEntry" = true
   OR "setsWorkedHoursToZero" = true
   OR "timeImpact" = 'BLOQUEA_CARGA_DIA';

-- finnegansValueUnit: HOURS cuando allowsHours = true; NULL (sin
-- determinar) en cualquier otro caso -- no se asume DAYS ni UNIT.
UPDATE "NoveltyType" SET "finnegansValueUnit" = 'HOURS' WHERE "allowsHours" = true;
