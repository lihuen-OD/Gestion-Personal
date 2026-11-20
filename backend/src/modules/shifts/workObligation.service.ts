import { prisma } from "../../shared/prisma/client";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import { workforceService } from "../workforce-management/workforce.service";
import { resolveActiveWorkRegimesForDate } from "../work-regimes/workRegimes.service";
import { applicableFixedAssignments, pickEarliestFixedCandidate, resolveExpectedShift, type FixedAssignment } from "./expectedShiftResolver";
import type { ShiftTemplateRef } from "./workShiftEvaluation.service";
import { toTemplateRef } from "./workShiftEvaluationRunner";
import { resolveRotationObligations } from "./rotationObligation.service";
import type { LoadedRotationTemplate } from "./rotationPlan.loader";
import type { ExpectedBlock } from "./rotationPlan";

export interface WorkObligationCandidate {
  employeeId: string;
  template: ShiftTemplateRef;
  scheduledStartAt: Date;
  /**
   * R4.3b: sólo en obligaciones de ROTACIÓN — el bloque efectivo (identidad
   * `obligationKey` = empleado + inicio programado). Los candidatos de turnos
   * fijos NO tienen esta clave (forma idéntica a la previa).
   */
  block?: ExpectedBlock<LoadedRotationTemplate>;
}

export interface WorkObligationResolution {
  isHoliday: boolean;
  candidates: WorkObligationCandidate[];
}

/**
 * Etapa 15M.19B (docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md): única
 * fuente de "¿quién tiene obligación REAL de trabajar esta fecha operativa?"
 * — reutilizada tanto por el chequeo intradía de falta de ingreso
 * (missingEntry.service.ts) como por el chequeo diario de inactividad
 * (attendanceInactivity.service.ts). Tener un turno asignado no alcanza por
 * sí solo: la asignación debe estar HABILITADO, vigente para esta fecha,
 * aplicable a este día de la semana (`ShiftAssignment.weekdays`), su
 * `ShiftTemplate` debe estar ACTIVO, el empleado debe estar ACTIVO, su
 * régimen (si tiene uno vigente) no puede ser `SIN_TURNO` — y si la fecha es
 * feriado, sólo cuenta si además está convocado explícitamente
 * (`HolidayWorkAssignment` ACTIVA, Etapa 12D/12E, sin tocar esa lógica).
 *
 * `TURNO_FLEXIBLE` y la ausencia de régimen vigente NO se excluyen acá: 15M.7D
 * ya estableció que una `ShiftAssignment` propia HABILITADA y aplicable es,
 * en sí misma, la "obligación explícita" que ese régimen exige (nunca se
 * infiere de una plantilla global) — el fallback sin régimen ya era
 * conservador por diseño (15M.7C). Sólo `SIN_TURNO` se excluye siempre,
 * incluso si conserva asignaciones históricas (mismo criterio que
 * `shouldSuppressMissingShiftAlert`, pero sin su componente
 * `alertOnOutOfShift`: ese flag sólo gobierna alertas de "no pude identificar
 * el turno", una pregunta distinta de "sé exactamente qué turno le
 * corresponde y no fichó").
 *
 * Novedades y evidencia de actividad (fichadas/jornadas/horas cargadas) NO
 * se resuelven acá — son un chequeo posterior, distinto para cada llamador
 * (todo el día transcurrido vs. sólo lo que ya pasó de tolerancia).
 *
 * Franco (docs/decisions/EMPLOYEE_DAY_OFF.md §5-§6): un `EmployeeDayOff`
 * ACTIVO en `dateKey` anula la obligación, aunque el turno, el régimen y la
 * fecha la exijan. Se aplica acá, después de la convocatoria a feriado (la
 * escritura ya impide que franco y convocatoria coexistan; si igual pasara,
 * gana el franco) — falta de ingreso e inactividad lo heredan sin filtros
 * propios.
 */
export async function resolveWorkObligationCandidates(dateKey: string): Promise<WorkObligationResolution> {
  const referenceDate = argentinaCalendarDate(dateKey);

  // Feriado por calendario, sin alcance de la regla (deuda P7): para alertas,
  // todo feriado alcanza a todos. Sin ningún convocado corta antes de leer
  // asignaciones.
  const holidayDays = await workforceService.holidayDatesInRange(referenceDate, referenceDate);
  const isHoliday = holidayDays.length > 0;
  let convokedEmployeeIds: string[] | null = null;
  if (isHoliday) {
    const assignments = await prisma.holidayWorkAssignment.findMany({ where: { date: referenceDate, status: "ACTIVA" }, select: { employeeId: true } });
    convokedEmployeeIds = assignments.map((item) => item.employeeId);
    if (!convokedEmployeeIds.length) return { isHoliday, candidates: [] };
  }

  // R4.3b (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5): miembros
  // vigentes de rotaciones ACTIVAS — un candidato por bloque efectivo (0..N).
  // La rotación reemplaza a sus asignaciones fijas ese día. Sin membresías
  // (hoy, todos los entornos) es una sola consulta vacía y nada más cambia.
  const { rotation, candidates: rotationCandidates } = await resolveRotationBlockCandidates(dateKey, convokedEmployeeIds ?? undefined);

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      status: "HABILITADO",
      employee: { status: "ACTIVO" },
      shiftTemplate: { status: "ACTIVO" },
      ...(convokedEmployeeIds ? { employeeId: { in: convokedEmployeeIds } } : {}),
    },
    include: { shiftTemplate: true },
  });

  // Etapa R2: vigencia, día de semana y estado los decide el resolver central
  // (expectedShiftResolver.ts). Sólo se agrupan las asignaciones aplicables,
  // en orden de lectura: el orden de los candidatos resultantes es el mismo
  // que antes (un empleado entra al mapa con su primera asignación aplicable).
  const applicableByEmployee = new Map<string, FixedAssignment<ShiftTemplateRef>[]>();
  for (const assignment of assignments) {
    const fixed: FixedAssignment<ShiftTemplateRef> = {
      status: assignment.status,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo,
      weekdays: assignment.weekdays,
      template: toTemplateRef(assignment.shiftTemplate),
    };
    if (!applicableFixedAssignments([fixed], referenceDate).length) continue;
    const list = applicableByEmployee.get(assignment.employeeId) ?? [];
    list.push(fixed);
    applicableByEmployee.set(assignment.employeeId, list);
  }

  // La rotación reemplaza a los turnos fijos: quien tiene plan de rotación ese
  // día no aporta candidatos fijos (defensa de la Opción C, §24.11).
  for (const employeeId of rotation.keys()) applicableByEmployee.delete(employeeId);
  if (!applicableByEmployee.size) return { isHoliday, candidates: rotationCandidates };

  const [regimes, dayOffs] = await Promise.all([
    resolveActiveWorkRegimesForDate(referenceDate),
    prisma.employeeDayOff.findMany({ where: { date: referenceDate, status: "ACTIVO", employeeId: { in: [...applicableByEmployee.keys()] } }, select: { employeeId: true } }),
  ]);
  const withDayOff = new Set(dayOffs.map((item) => item.employeeId));
  const candidates: WorkObligationCandidate[] = [];
  for (const [employeeId, employeeAssignments] of applicableByEmployee) {
    const resolution = resolveExpectedShift(
      {
        dateKey,
        assignments: employeeAssignments,
        dayOff: withDayOff.has(employeeId),
        // Sólo los convocados llegan hasta acá en un feriado.
        holiday: isHoliday ? "IN_SCOPE" : null,
        convocation: isHoliday ? { employeeId } : null,
        regimeKind: regimes.get(employeeId)?.kind ?? null,
      },
      "WORK_OBLIGATION",
    );
    if (resolution.obligation !== "SHIFT") continue;
    // Selección LEGACY entre varias aplicables: inicio más temprano (P1).
    const earliest = pickEarliestFixedCandidate(dateKey, resolution.fixedCandidates);
    if (earliest) candidates.push({ employeeId, template: earliest.template, scheduledStartAt: earliest.scheduledStartAt });
  }

  return { isHoliday, candidates: [...candidates, ...rotationCandidates] };
}

/**
 * R4.3b (§25.5): candidatos por BLOQUE de una fecha — un candidato por
 * bloque efectivo de cada miembro vigente (empleado ACTIVO) de una rotación
 * ACTIVA. `employeeIds` acota (convocados de un feriado). Devuelve también
 * el mapa de obligaciones: un miembro con plan de rotación (aun REST,
 * MISSING o CONFLICT, sin bloques) NO usa sus asignaciones fijas ese día.
 */
export async function resolveRotationBlockCandidates(dateKey: string, employeeIds?: string[]) {
  const rotation = await resolveRotationObligations({ dateKeys: [dateKey], activeEmployeesOnly: true, ...(employeeIds ? { employeeIds } : {}) });
  const candidates: WorkObligationCandidate[] = [];
  for (const byDate of rotation.values()) {
    const obligation = byDate.get(dateKey);
    if (!obligation) continue;
    for (const block of obligation.blocks) {
      candidates.push({ employeeId: obligation.employeeId, template: toTemplateRef(block.template), scheduledStartAt: block.scheduledStartAt, block });
    }
  }
  return { rotation, candidates };
}
