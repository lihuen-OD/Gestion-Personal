-- Jerarquía de alcance Nivel 2 → Nivel 3 (usuarios reales, por id de User).
-- Un Nivel 2 hereda dinámicamente los legajos con TIME_RESPONSIBLE vigente de
-- cada Nivel 3 que supervisa (backend/src/modules/employees/employeeAccess.ts).
-- Aditiva: tabla nueva y vacía, sin backfill ni cambios sobre datos existentes.
-- Los roles de cada extremo los valida la aplicación (no es expresable como
-- CHECK porque depende de otra fila); el CHECK de abajo sólo impide que un
-- usuario se supervise a sí mismo.

-- CreateTable
CREATE TABLE "UserSupervisionAssignment" (
    "id" TEXT NOT NULL,
    "supervisorUserId" TEXT NOT NULL,
    "supervisedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSupervisionAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserSupervisionAssignment_not_self_check" CHECK ("supervisorUserId" <> "supervisedUserId")
);

-- CreateIndex
CREATE INDEX "UserSupervisionAssignment_supervisedUserId_idx" ON "UserSupervisionAssignment"("supervisedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSupervisionAssignment_supervisorUserId_supervisedUserId_key" ON "UserSupervisionAssignment"("supervisorUserId", "supervisedUserId");

-- AddForeignKey
ALTER TABLE "UserSupervisionAssignment" ADD CONSTRAINT "UserSupervisionAssignment_supervisorUserId_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSupervisionAssignment" ADD CONSTRAINT "UserSupervisionAssignment_supervisedUserId_fkey" FOREIGN KEY ("supervisedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
