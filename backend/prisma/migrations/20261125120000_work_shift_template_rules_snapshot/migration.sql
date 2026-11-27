-- R4.6 — snapshot de reglas de la plantilla en la jornada
-- (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9, garantía 1).
-- Migración ADITIVA: una columna JSONB nullable en "WorkShift", sin default ni
-- backfill (sólo metadata del catálogo; no reescribe la tabla). Las jornadas
-- existentes quedan con NULL y conservan exactamente la lógica actual (la
-- plantilla en vivo). No toca fichadas, horas, alertas, avisos ni auditoría.
-- Rollback: prisma/rollbacks/20261125120000_work_shift_template_rules_snapshot.down.sql
-- (aborta si alguna jornada ya tiene snapshot).

-- AlterTable
ALTER TABLE "WorkShift" ADD COLUMN     "templateRulesSnapshot" JSONB;
