import type { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "../prisma/client";

// Identidad humana de un legajo para todo texto visible (descripción de
// auditoría, notificación). El employeeId es un UUID técnico: vive en
// entityId/before/after, nunca en el texto de negocio.
export const employeeReferenceSelect = {
  legajo: true,
  firstName: true,
  lastName: true,
} as const satisfies Prisma.EmployeeSelect;

export type EmployeeReferenceFields = {
  legajo?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

// Frase neutra cuando no hay ningún dato humano disponible. Sin artículo
// definido para que lea bien detrás de "de"/"para"/"a".
export const UNIDENTIFIED_EMPLOYEE_REFERENCE = "un legajo sin identificar";

/** "Pérez, Juan · Legajo 30" — con fallbacks "Legajo 30" / "Pérez, Juan". */
export function formatEmployeeReference(employee: EmployeeReferenceFields | null | undefined): string {
  const legajo = employee?.legajo?.trim();
  const lastName = employee?.lastName?.trim();
  const firstName = employee?.firstName?.trim();
  const name = lastName && firstName ? `${lastName}, ${firstName}` : lastName || firstName;
  const legajoLabel = legajo ? `Legajo ${legajo}` : "";
  if (name && legajoLabel) return `${name} · ${legajoLabel}`;
  return name || legajoLabel || UNIDENTIFIED_EMPLOYEE_REFERENCE;
}

type EmployeeReferenceReader = Pick<PrismaTransactionClient, "employee">;

/**
 * Para operaciones batch (cierres, recálculos): resuelve todas las
 * identidades en UNA sola consulta, nunca una por legajo. Devuelve un lookup
 * que cae en la frase neutra si el id no existe.
 */
export async function loadEmployeeReferences(db: EmployeeReferenceReader, employeeIds: string[]) {
  const ids = Array.from(new Set(employeeIds.filter(Boolean)));
  const rows = ids.length
    ? await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, ...employeeReferenceSelect } })
    : [];
  const references = new Map(rows.map((row) => [row.id, formatEmployeeReference(row)]));
  return (employeeId: string) => references.get(employeeId) ?? UNIDENTIFIED_EMPLOYEE_REFERENCE;
}
