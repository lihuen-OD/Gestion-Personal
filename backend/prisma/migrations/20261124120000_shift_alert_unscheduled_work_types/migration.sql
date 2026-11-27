-- R4.5 — trabajo no programado (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.7).
-- Migración ADITIVA: dos valores nuevos en "ShiftAlertType". Sin backfill: no
-- toca fichadas, jornadas, horas, alertas, avisos ni auditoría existentes.
--   TRABAJO_NO_PROGRAMADO    — clasificación informativa (INFO, ya RESUELTA)
--                              de una jornada sin turno programado.
--   INGRESO_FUERA_DE_VENTANA — ingreso de un miembro de rotación antes de la
--                              ventana de asignación de su bloque posterior.
-- Rollback: prisma/rollbacks/20261124120000_shift_alert_unscheduled_work_types.down.sql
-- (aborta si alguna alerta usa los valores nuevos).

-- AlterEnum
ALTER TYPE "ShiftAlertType" ADD VALUE 'TRABAJO_NO_PROGRAMADO';
ALTER TYPE "ShiftAlertType" ADD VALUE 'INGRESO_FUERA_DE_VENTANA';
