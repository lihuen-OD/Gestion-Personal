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
 * - Nivel 2: legajos con un EmployeeAssignment TIME_RESPONSIBLE vigente
 *   asignado directamente a él.
 * - Nivel 3: hereda dinámicamente los legajos de cada Nivel 2 ACTIVO que lo
 *   supervisa (UserSupervisionAssignment); con varios Nivel 2 recibe la unión.
 *   Sus propias asignaciones directas no abren alcance: el Nivel 3 nunca es
 *   responsable directo. Mismo sentido de herencia que los grupos de turnos
 *   (shifts/shiftGroupAccess.ts). No copia asignaciones: un legajo agregado o
 *   quitado al Nivel 2 aparece o desaparece del alcance del Nivel 3.
 *
 * Se resuelve en una sola query (EXISTS anidados vía `some`), sin N+1 y sin
 * duplicados: el filtro es sobre Employee, así que un legajo asignado a dos
 * responsables aparece una vez.
 */
export function employeeAccessWhere(user: Express.AuthUser, reference: Date = new Date()): Prisma.EmployeeWhereInput {
  if (user.role === roles.rrhh) return {};

  if (user.role !== roles.supervision && user.role !== roles.cargaHoraria) return { id: "__NO_ACCESS__" };

  const responsible: Prisma.EmployeeAssignmentWhereInput = user.role === roles.supervision
    ? { userId: user.id }
    : {
        // El supervisor tiene que seguir siendo Nivel 2 y estar ACTIVO: una
        // relación desfasada nunca abre el alcance, y un Nivel 2 inactivo deja
        // de transmitir sus legajos (la relación se conserva y vuelve a valer
        // si se lo reactiva). Mismo criterio que los destinatarios de
        // notificaciones (employeeNotificationRecipients.ts).
        user: { role: roles.supervision, status: "ACTIVO", supervisionsAsSupervisor: { some: { supervisedUserId: user.id } } },
      };

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

/**
 * Legajos sin un responsable de carga efectivo: ningún TIME_RESPONSIBLE
 * vigente hoy asignado a un usuario Nivel 2 ACTIVO (filas sólo con nombre,
 * vencidas o de otro rol no cuentan). Se COMBINA con `AND` junto al alcance:
 * nunca con spread, porque la clave `assignments` pisaría la del alcance de
 * Nivel 2/3 y el conteo se volvería global.
 */
export function withoutEffectiveTimeResponsibleWhere(reference: Date = new Date()): Prisma.EmployeeWhereInput {
  return {
    assignments: {
      none: { ...activeTimeResponsibleWhere(todayArgentinaDateKey(reference)), user: { role: roles.supervision, status: "ACTIVO" } },
    },
  };
}

function timeResponsibleValidityConditions(dateKey: string): Prisma.EmployeeAssignmentWhereInput[] {
  const day = argentinaCalendarDate(dateKey);
  return [
    { OR: [{ status: null }, { status: "ACTIVO" }, { status: "Activo" }] },
    { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: day } }] },
    { OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] },
  ];
}
