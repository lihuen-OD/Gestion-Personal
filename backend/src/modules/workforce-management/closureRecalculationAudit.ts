import type { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { humanizePeriodEs } from "../../shared/datetime/argentinaTime";
import type { RebuiltClosureSnapshot } from "./closureSnapshot";

// Un AuditLog por cierre recalculado, con el snapshot anterior y el nuevo
// (la historia del cierre vive en su entityId). Compartido por toda
// reinterpretación de la historia: corrección/eliminación de conceptos y
// cambio de reglas de Hora Especial. `employeeReference` resuelve la
// identidad humana de todo el lote en una sola consulta.
export async function auditClosureRecalculations(
  closures: RebuiltClosureSnapshot[],
  cause: string,
  audit: AuditContext | undefined,
  loadEmployeeReference: (employeeIds: string[]) => Promise<(employeeId: string) => string>,
) {
  if (!closures.length) return;
  const employeeReference = await loadEmployeeReference(closures.map((closure) => closure.employeeId));
  await Promise.all(closures.map((closure) => auditService.register({
    ...audit,
    action: "UPDATE",
    entity: "MonthlyTimeClosure",
    entityId: closure.id,
    description: `Se recalculó el snapshot del cierre de ${humanizePeriodEs(closure.period)} de ${employeeReference(closure.employeeId)} por ${cause}. El estado del cierre no cambia.`,
    before: { snapshot: closure.before } as Prisma.InputJsonValue,
    after: { snapshot: closure.after } as Prisma.InputJsonValue,
  })));
}
