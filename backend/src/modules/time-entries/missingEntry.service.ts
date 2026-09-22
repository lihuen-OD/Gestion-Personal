import { prisma } from "../../shared/prisma/client";
import { formatArgentinaDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { resolveWorkObligationCandidates, type WorkObligationCandidate } from "../shifts/workObligation.service";
import {
  findEmployeeIdsExcludedByNovelty,
  findEmployeeIdsWithActivityEvidence,
  INACTIVITY_CANDIDATE_SELECT,
  operationalDateRanges,
  persistAndNotifyInactivityIncidents,
} from "./attendanceInactivity.service";

export interface MissingEntryCheckResult {
  candidates: number;
  due: number;
  created: number;
  resolved: number;
}

function isToleranceExpired(candidate: WorkObligationCandidate, now: Date): boolean {
  const deadline = candidate.scheduledStartAt.getTime() + candidate.template.entryToleranceAfterMinutes * 60_000;
  return now.getTime() >= deadline;
}

/**
 * Etapa 15M.19B (docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md): resuelve
 * automáticamente, dentro del mismo tick, cualquier incidente `PENDIENTE` de
 * `AttendanceInactivityIncident` para la fecha operativa dada cuyo empleado
 * ya tiene evidencia de actividad — el empleado fichó (o cargó horas) DESPUÉS
 * de haber sido detectado como falta de ingreso. Mismo criterio de "motivo
 * auditable, nunca borra histórico" ya usado por la resolución automática de
 * alertas de puntualidad al confirmarse JORNADA_FUERA_DE_TURNO (Etapa
 * 15M.7D) — acá aplicado al modelo de inactividad en vez de a ShiftAlert.
 * `reviewedByUserId` queda null a propósito: es una resolución del sistema,
 * no de una persona — igual que `resolveOpenShiftOverflowAlert` nunca pide
 * un usuario.
 */
async function resolvePendingMissingEntries(dateKey: string, employeeIds: string[]): Promise<number> {
  if (!employeeIds.length) return 0;
  const ranges = operationalDateRanges(dateKey);
  const pending = await prisma.attendanceInactivityIncident.findMany({
    where: { operationalDate: ranges.operationalDate, status: "PENDIENTE", employeeId: { in: employeeIds } },
    select: { id: true, employeeId: true },
  });
  if (!pending.length) return 0;

  const hasEvidence = await findEmployeeIdsWithActivityEvidence(pending.map((incident) => incident.employeeId), ranges);
  const toResolve = pending.filter((incident) => hasEvidence.has(incident.employeeId)).map((incident) => incident.id);
  if (!toResolve.length) return 0;

  await prisma.attendanceInactivityIncident.updateMany({
    where: { id: { in: toResolve } },
    data: {
      status: "RESUELTA",
      reviewedAt: new Date(),
      reviewNote: "Resuelto automáticamente: se registró actividad después de haberse detectado la falta de ingreso.",
    },
  });
  return toResolve.length;
}

/**
 * Etapa 15M.19B: chequeo intradía de "turno esperado + tolerancia vencida +
 * sin fichada" — el hallazgo central de 15M.18 (esta regla no existía en
 * absoluto). A diferencia de `detectAttendanceInactivity` (una vez por día,
 * sobre el día YA elapsado), este chequeo corre en cada tick del scheduler
 * de 60s existente (clockPunchMaintenance.ts, sin `setInterval` nuevo) y
 * evalúa el día operativo de HOY, mientras todavía está en curso.
 *
 * Reutiliza exactamente los mismos tres pilares que el chequeo diario:
 * - `resolveWorkObligationCandidates` para "¿quién tiene obligación real de
 *   trabajar hoy?" (la MISMA función, ver workObligation.service.ts);
 * - `findEmployeeIdsWithActivityEvidence`/`findEmployeeIdsExcludedByNovelty`
 *   para "¿ya hay evidencia/novedad que lo exima?";
 * - `persistAndNotifyInactivityIncidents` para persistir y notificar, sobre
 *   el MISMO modelo (`AttendanceInactivityIncident`) que el chequeo diario —
 *   una ausencia detectada acá y luego revisitada por el chequeo diario del
 *   día siguiente nunca duplica el incidente ni la notificación (misma
 *   identidad `employeeId`+`operationalDate`, mismo `notifiedAt`).
 *
 * Lo único propio de este chequeo es decidir QUIÉN ya superó su tolerancia
 * de ingreso (`isToleranceExpired`) y, al final, resolver automáticamente
 * cualquier incidente de hoy cuyo empleado ya haya fichado.
 */
export async function checkMissingExpectedEntries(now: Date = new Date()): Promise<MissingEntryCheckResult> {
  const dateKey = todayArgentinaDateKey(now);
  const { candidates } = await resolveWorkObligationCandidates(dateKey);
  if (!candidates.length) return { candidates: 0, due: 0, created: 0, resolved: 0 };

  const due = candidates.filter((candidate) => isToleranceExpired(candidate, now));
  if (!due.length) {
    const resolved = await resolvePendingMissingEntries(dateKey, candidates.map((candidate) => candidate.employeeId));
    return { candidates: candidates.length, due: 0, created: 0, resolved };
  }

  const ranges = operationalDateRanges(dateKey);
  const dueIds = due.map((candidate) => candidate.employeeId);
  const [hasEvidence, excludedByNovelty] = await Promise.all([
    findEmployeeIdsWithActivityEvidence(dueIds, ranges),
    findEmployeeIdsExcludedByNovelty(dueIds, ranges.operationalDate),
  ]);
  const missingIds = dueIds.filter((id) => !hasEvidence.has(id) && !excludedByNovelty.has(id));

  let created = 0;
  if (missingIds.length) {
    const templateById = new Map(due.map((candidate) => [candidate.employeeId, candidate.template]));
    const employees = await prisma.employee.findMany({
      where: { id: { in: missingIds } },
      select: INACTIVITY_CANDIDATE_SELECT,
    });
    const result = await persistAndNotifyInactivityIncidents(
      ranges.operationalDate,
      dateKey,
      "FALTA_INGRESO",
      "Falta de ingreso",
      employees,
      (employee) => {
        const template = templateById.get(employee.id)!;
        return `No se registró el ingreso dentro de la tolerancia del turno ${template.code} (${template.startTime}) para el ${formatArgentinaDate(dateKey)}. Requiere revisión.`;
      },
      (employee) => {
        const template = templateById.get(employee.id)!;
        return `${employee.lastName}, ${employee.firstName} · Legajo ${employee.legajo} no fichó su ingreso dentro de la tolerancia del turno ${template.code} (${template.startTime}).`;
      },
    );
    created = result.detected;
  }

  // Etapa 15M.19B §Lifecycle: resolver también a los candidatos de hoy que
  // NO están "due" en este tick pero pueden tener un incidente PENDIENTE de
  // un tick anterior (ej. ficharon recién). Se evalúa sobre TODOS los
  // candidatos con obligación hoy, no sólo los `due` de esta pasada.
  const resolved = await resolvePendingMissingEntries(dateKey, candidates.map((candidate) => candidate.employeeId));

  return { candidates: candidates.length, due: due.length, created, resolved };
}
