-- AlterEnum
-- Etapa 13A: nuevo tipo de ShiftAlert para clasificar un ingreso registrado
-- antes del horario/tolerancia del turno asignado del empleado. Aditivo puro
-- (un solo valor de enum, sin tocar filas existentes ni otros tipos) — mismo
-- patrón ya usado en 20260723165615_shift_alert_duration_and_missing_out_types.
ALTER TYPE "ShiftAlertType" ADD VALUE 'INGRESO_ANTICIPADO';
