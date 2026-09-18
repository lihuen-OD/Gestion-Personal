import { prisma } from "../prisma/client";
import { argentinaCalendarDate, calendarDateKey } from "../datetime/argentinaTime";

/**
 * Etapa 15M.19A (docs/decisions/DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md):
 * acceso puro a `JobCheckpoint` — una fila por job, identificada por `key`.
 * No es un framework de jobs: sólo lee/avanza un watermark de fecha
 * operativa Argentina. La orquestación (qué fechas están pendientes, en qué
 * orden procesarlas) vive en el módulo que la usa (ver
 * `attendanceInactivityScheduler.ts`), no acá.
 */
export const jobCheckpointRepository = {
  async findLastProcessedDateKey(key: string): Promise<string | null> {
    const row = await prisma.jobCheckpoint.findUnique({ where: { key } });
    return row?.lastProcessedDate ? calendarDateKey(row.lastProcessedDate) : null;
  },

  /**
   * Avanza el checkpoint a `dateKey`, nunca hacia atrás. Escrito para ser
   * seguro si dos instancias del proceso llegaran a correr al mismo tiempo
   * (hoy Render corre una sola instancia — ver §18 del diagnóstico 15M.18):
   * el `upsert` garantiza que la fila exista, y el `updateMany` sólo mueve
   * `lastProcessedDate` hacia adelante (`lt: date`), así que una escritura
   * "vieja" que llegue tarde nunca pisa un avance más reciente.
   */
  async advance(key: string, dateKey: string): Promise<void> {
    const date = argentinaCalendarDate(dateKey);
    await prisma.jobCheckpoint.upsert({
      where: { key },
      create: { key, lastProcessedDate: date },
      update: {},
    });
    await prisma.jobCheckpoint.updateMany({
      where: { key, lastProcessedDate: { lt: date } },
      data: { lastProcessedDate: date },
    });
  },
};
