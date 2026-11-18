-- Alta mínima de legajo: el CUIL deja de ser obligatorio.
-- Sólo quita NOT NULL; no modifica ni completa CUIL existentes (sin backfill).
-- El índice único "Employee_cuil_key" se conserva: PostgreSQL trata los NULL
-- como distintos, así que varios legajos pueden no tener CUIL y un CUIL real
-- sigue siendo único.
ALTER TABLE "Employee" ALTER COLUMN "cuil" DROP NOT NULL;
