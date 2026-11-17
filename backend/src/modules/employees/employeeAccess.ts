import type { Prisma } from "@prisma/client";
import type { Express } from "express";
import { roles } from "../../shared/security/roles";
import { argentinaCalendarDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";

/**
 * Única fuente del alcance de legajos por rol. Todos los módulos (Legajos,
 * Horas, Novedades, Pendientes, Documentos, Francos, Alertas, Cierres, …) la
 * combinan en su query; ninguno reimplementa el alcance.
 *
 * - Nivel 1 (RRHH): sin restricción.
 * - Nivel 3: legajos con un EmployeeAssignment TIME_RESPONSIBLE vigente
 *   asignado a él.
 * - Nivel 2: unión de (A) sus TIME_RESPONSIBLE vigentes directos
 *   (compatibilidad con datos anteriores) y (B) los TIME_RESPONSIBLE vigentes
 *   de cada usuario Nivel 3 ACTIVO que supervisa (UserSupervisionAssignment). Es
 *   dinámico: no copia asignaciones, así que un legajo agregado o quitado a
 *   ese Nivel 3 aparece o desaparece del alcance del Nivel 2 sin tocarlo.
 *
 * Se resuelve en una sola query (EXISTS anidados vía `some`), sin N+1 y sin
 * duplicados: el filtro es sobre Employee, así que un legajo asignado a dos
 * responsables aparece una vez.
 */
export function employeeAccessWhere(user: Express.AuthUser, reference: Date = new Date()): Prisma.EmployeeWhereInput {
  if (user.role === roles.rrhh) return {};

  if (user.role !== roles.supervision && user.role !== roles.cargaHoraria) return { id: "__NO_ACCESS__" };

  const responsible: Prisma.EmployeeAssignmentWhereInput = user.role === roles.supervision
    ? {
        OR: [
          { userId: user.id },
          // El supervisado tiene que seguir siendo Nivel 3 y estar ACTIVO: una
          // relación desfasada nunca abre el alcance de otro rol, y un Nivel 3
          // inactivo deja de transmitir sus legajos (la relación se conserva y
          // vuelve a valer si se lo reactiva). Mismo criterio que los
          // destinatarios de notificaciones (employeeNotificationRecipients.ts).
          { user: { role: roles.cargaHoraria, status: "ACTIVO", supervisionsAsSupervised: { some: { supervisorUserId: user.id } } } },
        ],
      }
    : { userId: user.id };

  return {
    assignments: {
      some: {
        type: "TIME_RESPONSIBLE",
        AND: [...timeResponsibleValidityConditions(todayArgentinaDateKey(reference)), responsible],
      },
    },
  };
}

/**
 * Única definición de "EmployeeAssignment TIME_RESPONSIBLE vigente" en una
 * fecha calendario Argentina (`dateKey`, "YYYY-MM-DD"): estado nulo/ACTIVO/
 * Activo, `effectiveFrom` nulo o <= fecha y `effectiveTo` nulo o >= fecha
 * (ambos extremos inclusivos, columnas @db.Date). La usan el alcance de
 * legajos (arriba) y los destinatarios de notificaciones operativas
 * (workforce-management/employeeNotificationRecipients.ts); no copiarla.
 */
export function activeTimeResponsibleWhere(dateKey: string): Prisma.EmployeeAssignmentWhereInput {
  return { type: "TIME_RESPONSIBLE", AND: timeResponsibleValidityConditions(dateKey) };
}

function timeResponsibleValidityConditions(dateKey: string): Prisma.EmployeeAssignmentWhereInput[] {
  const day = argentinaCalendarDate(dateKey);
  return [
    { OR: [{ status: null }, { status: "ACTIVO" }, { status: "Activo" }] },
    { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: day } }] },
    { OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] },
  ];
}
