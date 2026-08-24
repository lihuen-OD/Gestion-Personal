-- Etapa 6H.1: una carga manual representa una única celda por empleado,
-- fecha y concepto. Se conserva la fila modificada más recientemente ante
-- duplicados legacy; los breakdowns AUTOMATIC quedan fuera del saneamiento.
WITH "ranked_manual" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "employeeId", "date", "hourConceptId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS "duplicate_rank"
  FROM "HourConceptBreakdown"
  WHERE "source" = 'MANUAL'
)
DELETE FROM "HourConceptBreakdown"
WHERE "id" IN (
  SELECT "id"
  FROM "ranked_manual"
  WHERE "duplicate_rank" > 1
);

-- Un índice global que incluyera source también restringiría AUTOMATIC a una
-- fila diaria. El predicado preserva múltiples breakdowns automáticos futuros
-- asociados a distintos turnos, segmentos o reglas.
CREATE UNIQUE INDEX IF NOT EXISTS "HourConceptBreakdown_manual_unique"
ON "HourConceptBreakdown" ("employeeId", "date", "hourConceptId")
WHERE "source" = 'MANUAL';
