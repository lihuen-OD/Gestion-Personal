-- Grupos de turnos (lugar / ámbito operativo principal: Planta, Granja,
-- Oficina, Taller…) — docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23 (R3.1).
-- Aditiva e inerte: tabla nueva y vacía, y una columna nullable en
-- ShiftTemplate sin default ni backfill. Ninguna plantilla se reescribe:
-- shiftGroupId = NULL significa "todavía no clasificada", nunca "inválida".
-- categoryName y ShiftAssignment no se tocan. La clasificación de las
-- plantillas existentes es una operación posterior y explícita (R3.3).
-- RESTRICT hacia ShiftGroup: borrar un grupo nunca desclasifica plantillas en
-- silencio (la aplicación lo rechaza antes; la FK es la segunda defensa).
--
-- Unicidad de código y nombre SIN distinguir mayúsculas (regla de dominio):
-- los índices únicos de Prisma (@unique) distinguen mayúsculas, así que no
-- bastan como segunda defensa. Se agregan a mano índices únicos sobre
-- lower(...) — Prisma no modela índices funcionales ni los compara en
-- `migrate diff` — y un CHECK de forma que garantiza en la base la misma
-- normalización de espacios que aplica la aplicación (sin extremos ni
-- espacios repetidos), para que variantes como " Planta" o "Medio  Ambiente"
-- tampoco puedan existir. Ambos son invisibles para Prisma (mismo criterio
-- que los CHECK/EXCLUDE ya escritos a mano en migraciones anteriores).

-- AlterTable
ALTER TABLE "ShiftTemplate" ADD COLUMN     "shiftGroupId" TEXT;

-- CreateTable
CREATE TABLE "ShiftGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVO',
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShiftGroup_pkey" PRIMARY KEY ("id"),
    -- Columnas NOT NULL: el CHECK nunca evalúa NULL. Cada valor tiene al menos
    -- un carácter visible y no empieza, termina ni repite espacios en blanco.
    CONSTRAINT "ShiftGroup_code_name_shape_check" CHECK (
        "code" ~ '\S' AND "code" !~ '(^\s|\s$|\s\s)'
        AND "name" ~ '\S' AND "name" !~ '(^\s|\s$|\s\s)'
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftGroup_code_key" ON "ShiftGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftGroup_name_key" ON "ShiftGroup"("name");

-- CreateIndex (a mano: unicidad sin distinguir mayúsculas; ver encabezado)
CREATE UNIQUE INDEX "ShiftGroup_code_lower_key" ON "ShiftGroup"(lower("code"));

-- CreateIndex (a mano: unicidad sin distinguir mayúsculas; ver encabezado)
CREATE UNIQUE INDEX "ShiftGroup_name_lower_key" ON "ShiftGroup"(lower("name"));

-- CreateIndex
CREATE INDEX "ShiftGroup_status_sortOrder_idx" ON "ShiftGroup"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "ShiftTemplate_shiftGroupId_idx" ON "ShiftTemplate"("shiftGroupId");

-- AddForeignKey
ALTER TABLE "ShiftGroup" ADD CONSTRAINT "ShiftGroup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftGroup" ADD CONSTRAINT "ShiftGroup_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
