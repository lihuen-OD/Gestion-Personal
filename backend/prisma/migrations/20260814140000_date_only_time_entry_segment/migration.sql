-- Etapa 4 / Subetapa 4A (2026-08-14): migrar a DATE las columnas que representan
-- el día laboral (fecha calendario, sin significado de negocio en la hora).
--
-- Verificacion previa (ver resumen de la etapa): TimeEntry.date y TimeSegment.date
-- tenian 0 filas cada una en la base de desarrollo al momento de esta migracion.
-- No hay perdida de informacion posible: no existe ningun valor con hora distinta
-- de medianoche que se este descartando.
--
-- Esta migracion NO toca los instantes reales ya migrados a TIMESTAMPTZ(3) en la
-- etapa anterior (WorkShift.startAt/endAt, TimeSegment.fromDateTime/toDateTime,
-- TimeEntry.segmentStartAt/segmentEndAt, etc.) ni ninguna otra columna.

ALTER TABLE "TimeEntry" ALTER COLUMN "date" TYPE DATE USING "date"::date;
ALTER TABLE "TimeSegment" ALTER COLUMN "date" TYPE DATE USING "date"::date;
