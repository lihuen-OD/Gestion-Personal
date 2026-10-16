import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { clockPunchPostProcessRepository } from "./clockPunchPostProcess.repository";

/**
 * PERF-5D (docs/decisions/F12_PERF_5.md): el cierre mensual no puede armar su
 * snapshot con el post-proceso de una fichada del período sin terminar (Motor B
 * escribe los desgloses que el snapshot lee). Se llama dentro de la transacción
 * del envío, con el lock EXCLUSIVO de los períodos ya tomado: una salida nueva
 * del período espera a que el envío termine, así que el conteo es definitivo.
 */
export async function assertClockPunchPostProcessSettled(db: Pick<PrismaTransactionClient, "clockPunchPostProcessJob">, employeeIds: string[], period: string) {
  const pending = await clockPunchPostProcessRepository.countUnfinished(db, employeeIds, period);
  if (pending) {
    throw new AppError("Hay fichadas recientes de este período que todavía se están procesando. Reintentá en unos segundos.", 409, "CLOCK_POSTPROCESS_PENDING", { pending });
  }
}
