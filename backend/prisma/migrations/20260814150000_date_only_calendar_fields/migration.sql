-- Etapa 4 / Subetapa 4B (2026-08-14): migrar a DATE el resto de las columnas
-- que representan fecha calendario (donde la hora del dia no tiene significado
-- de negocio).
--
-- Verificacion previa (ver resumen de la etapa): se revisaron los 12 campos
-- listados abajo contra la base de desarrollo. Ninguno tenia un valor con hora
-- distinta de 00:00:00.000 UTC (Employee.birthDate: 3 valores no nulos de 4 filas;
-- LaborMovement.effectiveFrom: 4 valores de 4 filas; Novelty.fromDate: 1 valor de
-- 1 fila; el resto sin filas o sin valores no nulos en este momento). No hay
-- perdida de informacion posible.
--
-- No se toca ningun instante real (TIMESTAMPTZ) ni TimeEntry.date/TimeSegment.date
-- (migrados en la Subetapa 4A), ni ShiftTemplate.startTime/endTime, ni Position,
-- ni la jerarquia organizacional, ni ningun campo *ByUserId.

ALTER TABLE "Employee" ALTER COLUMN "birthDate" TYPE DATE USING "birthDate"::date;
ALTER TABLE "LaborMovement" ALTER COLUMN "effectiveFrom" TYPE DATE USING "effectiveFrom"::date;
ALTER TABLE "EmployeeAssignment" ALTER COLUMN "effectiveFrom" TYPE DATE USING "effectiveFrom"::date;
ALTER TABLE "EmployeeAssignment" ALTER COLUMN "effectiveTo" TYPE DATE USING "effectiveTo"::date;
ALTER TABLE "EmployeeFieldHistory" ALTER COLUMN "effectiveFrom" TYPE DATE USING "effectiveFrom"::date;
ALTER TABLE "EmployeeBlockHistory" ALTER COLUMN "effectiveFrom" TYPE DATE USING "effectiveFrom"::date;
ALTER TABLE "Novelty" ALTER COLUMN "fromDate" TYPE DATE USING "fromDate"::date;
ALTER TABLE "Novelty" ALTER COLUMN "toDate" TYPE DATE USING "toDate"::date;
ALTER TABLE "DoubleHourRule" ALTER COLUMN "fromDate" TYPE DATE USING "fromDate"::date;
ALTER TABLE "DoubleHourRule" ALTER COLUMN "toDate" TYPE DATE USING "toDate"::date;
ALTER TABLE "EmployeeDocument" ALTER COLUMN "issuedAt" TYPE DATE USING "issuedAt"::date;
ALTER TABLE "EmployeeDocument" ALTER COLUMN "expiresAt" TYPE DATE USING "expiresAt"::date;
