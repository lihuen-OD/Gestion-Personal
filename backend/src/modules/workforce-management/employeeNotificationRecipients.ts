import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { roles } from "../../shared/security/roles";
import { activeTimeResponsibleWhere } from "../employees/employeeAccess";

/**
 * Destinatarios de una notificación operativa de un legajo ("RRHH +
 * responsables del legajo"). Única fuente: la usan las alertas de turno /
 * fichada (ALERTA_FICHADA, incluida ACTIVIDAD_EN_FRANCO), FALTA_SALIDA,
 * FALTA_INGRESO y SIN_ACTIVIDAD_REGISTRADA. Sólo decide QUIÉN recibe; crear el
 * aviso sigue siendo de `notifyUsers` / del productor.
 *
 * Por legajo, la unión deduplicada de:
 * A. RRHH: usuarios ACTIVO con rol Nivel 1.
 * B. Responsables directos: usuarios Nivel 2 ACTIVO con un
 *    EmployeeAssignment TIME_RESPONSIBLE vigente en `referenceDateKey`
 *    (criterio canónico `activeTimeResponsibleWhere`, el mismo del alcance).
 *    Una fila a nombre de otro rol no concede el aviso (sólo el Nivel 2 es
 *    responsable directo).
 * C. Nivel 3 heredados: por cada responsable directo, los Nivel 3 ACTIVO que
 *    supervisa (UserSupervisionAssignment), igual que el alcance de legajos.
 *    Los roles y estados de ambos lados se verifican al resolver: una relación
 *    desfasada (rol cambiado, usuario inactivo) no concede el aviso.
 *
 * `EmployeeAssignment.role` es legacy y nunca se usa: el rol sale de User.
 *
 * Batch: a lo sumo 3 consultas para cualquier cantidad de legajos (RRHH,
 * asignaciones vigentes de Nivel 2, Nivel 3 que supervisan esos Nivel 2); el Map se arma en memoria.
 *
 * `db`: el post-proceso durable de una fichada resuelve dentro de la
 * transacción de su paso, para leer con la misma conexión que escribe.
 */
export type RecipientsReader = Pick<PrismaTransactionClient, "user" | "employeeAssignment" | "userSupervisionAssignment">;

export async function resolveEmployeeNotificationRecipientsBatch(
  employeeIds: string[],
  referenceDateKey: string,
  db: RecipientsReader = prisma,
): Promise<Map<string, string[]>> {
  const uniqueEmployeeIds = Array.from(new Set(employeeIds.filter(Boolean)));
  const result = new Map<string, string[]>();
  if (!uniqueEmployeeIds.length) return result;

  const [rrhh, assignments] = await Promise.all([
    db.user.findMany({ where: { role: roles.rrhh, status: "ACTIVO" }, select: { id: true } }),
    db.employeeAssignment.findMany({
      where: {
        AND: [activeTimeResponsibleWhere(referenceDateKey), { employeeId: { in: uniqueEmployeeIds } }, { user: { role: roles.supervision, status: "ACTIVO" } }],
      },
      select: { employeeId: true, userId: true },
    }),
  ]);

  const directByEmployee = new Map<string, Set<string>>();
  const directSupervisors = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment.userId) continue;
    const direct = directByEmployee.get(assignment.employeeId) ?? new Set<string>();
    direct.add(assignment.userId);
    directByEmployee.set(assignment.employeeId, direct);
    directSupervisors.add(assignment.userId);
  }

  const supervisedBySupervisor = new Map<string, string[]>();
  if (directSupervisors.size) {
    const supervisions = await db.userSupervisionAssignment.findMany({
      where: {
        supervisorUserId: { in: Array.from(directSupervisors) },
        supervised: { role: roles.cargaHoraria, status: "ACTIVO" },
        supervisor: { role: roles.supervision, status: "ACTIVO" },
      },
      select: { supervisorUserId: true, supervisedUserId: true },
    });
    for (const supervision of supervisions) {
      const list = supervisedBySupervisor.get(supervision.supervisorUserId) ?? [];
      list.push(supervision.supervisedUserId);
      supervisedBySupervisor.set(supervision.supervisorUserId, list);
    }
  }

  const rrhhIds = rrhh.map((user) => user.id);
  for (const employeeId of uniqueEmployeeIds) {
    const recipients = new Set<string>(rrhhIds);
    for (const responsibleId of directByEmployee.get(employeeId) ?? []) {
      recipients.add(responsibleId);
      for (const supervisedId of supervisedBySupervisor.get(responsibleId) ?? []) recipients.add(supervisedId);
    }
    result.set(employeeId, Array.from(recipients));
  }
  return result;
}

export async function resolveEmployeeNotificationRecipients(employeeId: string, referenceDateKey: string, db: RecipientsReader = prisma): Promise<string[]> {
  const recipients = await resolveEmployeeNotificationRecipientsBatch([employeeId], referenceDateKey, db);
  return recipients.get(employeeId) ?? [];
}
