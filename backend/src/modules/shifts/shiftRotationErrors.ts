/**
 * Traducción de errores de persistencia de rotaciones a errores de dominio —
 * R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
 *
 * Las validaciones del servicio dan el mensaje humano; las restricciones de la
 * base (R4.1/R4.1A) son la última defensa ante carreras. Se mapean:
 * - P2002 / 23505 (único): código de rotación o de equipo repetido, día repetido.
 * - 23P01 (exclusion_violation): membresía o versión superpuesta (EXCLUDE gist).
 * - P2003 / 23503 / 23001 (FK y RESTRICT): referencia inexistente o en uso.
 *   PostgreSQL responde 23001 (`restrict_violation`) para ON DELETE RESTRICT.
 * - P2025: el registro ya no existe.
 * Cualquier otro error se propaga sin cambios.
 */
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const meta = error instanceof Prisma.PrismaClientKnownRequestError ? JSON.stringify(error.meta ?? {}) : "";
  return `${error.message} ${meta}`;
}

function prismaCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

export function rotationPersistenceError(error: unknown): AppError | null {
  if (error instanceof AppError) return null;
  const code = prismaCode(error);
  const text = errorText(error);
  if (/ShiftRotationCrewMember_no_overlap/.test(text) || (/23P01/.test(text) && /CrewMember/.test(text))) {
    return new AppError("La persona ya tiene otra membresía de rotación en esas fechas (una sola por persona y fecha). Revisá sus altas vigentes.", 409, "ROTATION_MEMBERSHIP_OVERLAP");
  }
  if (/ShiftRotationVersion_no_overlap/.test(text) || (/23P01/.test(text) && /Version/.test(text))) {
    return new AppError("Otra versión de la rotación ya rige en esas fechas. Otra persona pudo haberla cambiado: recargá y volvé a intentar.", 409, "ROTATION_VERSION_OVERLAP");
  }
  if (code === "P2002" || /23505/.test(text)) {
    if (/ShiftRotationCrew/.test(text)) return new AppError("Ya existe un equipo con ese código en la rotación.", 409, "ROTATION_CREW_DUPLICATE");
    if (/ShiftRotationDay/.test(text)) return new AppError("La grilla repite un mismo día para el mismo equipo y semana.", 409, "ROTATION_DAY_DUPLICATE");
    return new AppError("Ya existe una rotación con ese código.", 409, "ROTATION_DUPLICATE");
  }
  if (code === "P2003" || /23503|23001|restrict_violation/.test(text)) {
    return new AppError("No se puede completar la operación: el registro está en uso o una referencia ya no existe. Recargá y volvé a intentar.", 409, "ROTATION_REFERENCE_CONFLICT");
  }
  if (code === "P2025") return new AppError("El registro de la rotación ya no existe. Recargá y volvé a intentar.", 404, "ROTATION_RECORD_NOT_FOUND");
  return null;
}

/** Ejecuta `operation` y traduce los errores de persistencia conocidos. */
export async function withRotationErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw rotationPersistenceError(error) ?? error;
  }
}
