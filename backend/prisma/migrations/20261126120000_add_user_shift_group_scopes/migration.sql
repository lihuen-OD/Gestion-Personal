-- R8: alcance de administración de turnos por grupo
-- (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26).
-- Sólo un Nivel 2 tiene filas; Nivel 1 administra todo sin filas y un Nivel 3
-- hereda en vivo los grupos de los Nivel 2 ACTIVOS que lo supervisan
-- (UserSupervisionAssignment). Sin filas = sin acceso, nunca acceso global.
-- Aditiva: tabla nueva y vacía, sin backfill ni cambios sobre datos
-- existentes. El rol del usuario lo valida la aplicación (depende de otra fila;
-- no es expresable como CHECK). Restrict en userId/shiftGroupId: un usuario o
-- grupo con alcances no se borra físicamente; createdByUserId es autoría.

-- CreateTable
CREATE TABLE "UserShiftGroupScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftGroupId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserShiftGroupScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserShiftGroupScope_shiftGroupId_idx" ON "UserShiftGroupScope"("shiftGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "UserShiftGroupScope_userId_shiftGroupId_key" ON "UserShiftGroupScope"("userId", "shiftGroupId");

-- AddForeignKey
ALTER TABLE "UserShiftGroupScope" ADD CONSTRAINT "UserShiftGroupScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserShiftGroupScope" ADD CONSTRAINT "UserShiftGroupScope_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserShiftGroupScope" ADD CONSTRAINT "UserShiftGroupScope_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
