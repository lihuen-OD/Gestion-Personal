-- Motor de cobertura horaria de Novedades — Etapa 3
-- (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §5).
--
-- Migración ADITIVA: sólo agrega valores a dos enums de la etapa 1. No toca
-- filas, columnas, constraints ni la migración
-- 20261113180000_add_novelty_coverage_engine (historia inmutable).
--   * NoveltyCoverageOutcome.OUTSIDE_EMPLOYMENT: fecha fuera de la relación
--     laboral conocida (antes del ALTA o desde la BAJA de LaborMovement).
--     0 h confirmado; el CHECK NoveltyDayCoverage_minutes_check ya exige 0
--     minutos fuera de COVERED.
--   * NoveltyCoverageScheduleReviewReason.SHIFT_ASSIGNMENTS_OVERLAP: varios
--     turnos del mismo día con horarios superpuestos (etapa 2).
--   * NoveltyCoverageScheduleReviewReason.EMPLOYMENT_HISTORY_UNRESOLVED: sin
--     historia de altas y bajas suficiente para saber si había relación
--     laboral ese día.
-- Ninguno de los valores se usa en esta misma migración (ALTER TYPE ... ADD
-- VALUE no puede usarse en la transacción que lo agrega).
-- Rollback: prisma/rollbacks/20261114120000_add_novelty_coverage_employment_and_overlap.down.sql

ALTER TYPE "NoveltyCoverageOutcome" ADD VALUE 'OUTSIDE_EMPLOYMENT';

ALTER TYPE "NoveltyCoverageScheduleReviewReason" ADD VALUE 'SHIFT_ASSIGNMENTS_OVERLAP';
ALTER TYPE "NoveltyCoverageScheduleReviewReason" ADD VALUE 'EMPLOYMENT_HISTORY_UNRESOLVED';
