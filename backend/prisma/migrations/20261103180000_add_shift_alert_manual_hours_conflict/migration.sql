-- Actividad del fichador sobre horas cargadas a mano
-- (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md).
-- Migración ADITIVA: un valor nuevo en "ShiftAlertType". Sin backfill: no toca
-- fichadas, jornadas, horas, alertas ni auditoría existentes. Rollback manual
-- en ROLLBACK.md (misma carpeta).

-- AlterEnum
ALTER TYPE "ShiftAlertType" ADD VALUE 'ACTIVIDAD_SOBRE_CARGA_MANUAL';
