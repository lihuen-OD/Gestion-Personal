import { prisma } from "../../shared/prisma/client";
import { formatArgentinaDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { resolveWorkObligationCandidates, type WorkObligationCandidate } from "../shifts/workObligation.service";
import {
  findEmployeeIdsExcludedByNovelty,
  findEmployeeIdsWithMatchingEntryEvidence,
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
 * Etapa 15M.19B (docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md), evidencia
 * corregida en 15M.19F: resuelve automáticamente, dentro del mismo tick,
 * cualquier incidente `PENDIENTE` de `AttendanceInactivityIncident` para la
 * fecha operativa dada cuyo empleado ya tiene evidencia PRECISA de haber
 * cumplido esa obligación puntual (`findEmployeeIdsWithMatchingEntryEvidence`
 * — no "cualquier actividad ese día", que podía resolver un incidente real
 * por actividad ajena a la obligación incumplida). Mismo criterio de "motivo
 * auditable, nunca borra histórico" ya usado por la resolución automática de
 * alertas de puntualidad al confirmarse JORNADA_FUERA_DE_TURNO (Etapa
 * 15M.7D) — acá aplicado al modelo de inactividad en vez de a ShiftAlert.
 * `reviewedByUserId` queda null a propósito: es una resolución del sistema,
 * no de una persona — igual que `resolveOpenShiftOverflowAlert` nunca pide
 * un usuario.
 *
 * Recibe los `WorkObligationCandidate` (no sólo `employeeId`s): la evidencia
 * precisa necesita el `template`/`scheduledStartAt` de CADA obligación para
 * decidir a qué ocurrencia de turno pertenece una fichada real.
 */
async function resolvePendingMissingEntries(dateKey: string, candidates: WorkObligationCandidate[]): Promise<number> {
  if (!candidates.length) return 0;
  const ranges = operationalDateRanges(dateKey);
  const pending = await prisma.attendanceInactivityIncident.findMany({
    where: { operationalDate: ranges.operationalDate, status: "PENDIENTE", employeeId: { in: candidates.map((candidate) => candidate.employeeId) } },
    select: { id: true, employeeId: true },
  });
  if (!pending.length) return 0;

  const candidateByEmployee = new Map(candidates.map((candidate) => [candidate.employeeId, candidate]));
  const relevantCandidates = pending
    .map((incident) => candidateByEmployee.get(incident.employeeId))
    .filter((candidate): candidate is WorkObligationCandidate => Boolean(candidate));
  const hasEntryEvidence = await findEmployeeIdsWithMatchingEntryEvidence(relevantCandidates);
  const toResolve = pending.filter((incident) => hasEntryEvidence.has(incident.employeeId)).map((incident) => incident.id);
  if (!toResolve.length) return 0;

  await prisma.attendanceInactivityIncident.updateMany({
    where: { id: { in: toResolve } },
    data: {
      status: "RESUELTA",
      reviewedAt: new Date(),
      reviewNote: "Resuelto automáticamente: se registró el ingreso correspondiente a la obligación.",
    },
  });
  return toResolve.length;
}

/**
 * Etapa 15M.19F: crea (si corresponde) los incidentes de falta de ingreso
 * para los `candidates` dados de `dateKey` — extraído para reutilizarse
 * tanto por el chequeo intradía de HOY (`checkMissingExpectedEntries`, sólo
 * candidatos ya vencidos de tolerancia) como por el catch-up de días
 * anteriores ya completamente elapsados (`checkMissingEntriesForElapsedDate`,
 * TODOS sus candidatos — el día entero ya pasó, no hace falta filtrar por
 * tolerancia).
 */
async function createMissingEntryIncidents(dateKey: string, candidates: WorkObligationCandidate[]): Promise<number> {
  if (!candidates.length) return 0;
  const ranges = operationalDateRanges(dateKey);
  const employeeIds = candidates.map((candidate) => candidate.employeeId);
  const [hasEntryEvidence, excludedByNovelty] = await Promise.all([
    findEmployeeIdsWithMatchingEntryEvidence(candidates),
    findEmployeeIdsExcludedByNovelty(employeeIds, ranges.operationalDate),
  ]);
  const missing = candidates.filter((candidate) => !hasEntryEvidence.has(candidate.employeeId) && !excludedByNovelty.has(candidate.employeeId));
  if (!missing.length) return 0;

  const templateById = new Map(missing.map((candidate) => [candidate.employeeId, candidate.template]));
  const employees = await prisma.employee.findMany({
    where: { id: { in: missing.map((candidate) => candidate.employeeId) } },
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
  return result.detected;
}

/**
 * Etapa 15M.19B (docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md): chequeo
 * intradía de "turno esperado + tolerancia vencida + sin fichada" — el
 * hallazgo central de 15M.18 (esta regla no existía en absoluto). A
 * diferencia de `detectAttendanceInactivity` (una vez por día, sobre el día
 * YA elapsado), este chequeo corre en cada tick del scheduler de 60s
 * existente (clockPunchMaintenance.ts, sin `setInterval` nuevo) y evalúa el
 * día operativo de HOY, mientras todavía está en curso.
 *
 * Etapa 15M.19F: este chequeo, por diseño, sólo mira "hoy" — nunca vuelve
 * atrás por sí solo. Si el proceso estuvo caído durante la ventana en la que
 * venció la tolerancia de una obligación de un día ANTERIOR, esa obligación
 * queda fuera del alcance de esta función para siempre en cuanto "hoy"
 * avanza. Ese hueco lo cubre `missingEntryScheduler.ts::runMissingEntryCatchUp`
 * (checkpoint durable propio, mismo mecanismo que 15M.19A) — ver
 * docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md.
 */
export async function checkMissingExpectedEntries(now: Date = new Date()): Promise<MissingEntryCheckResult> {
  const dateKey = todayArgentinaDateKey(now);
  const { candidates } = await resolveWorkObligationCandidates(dateKey);
  if (!candidates.length) return { candidates: 0, due: 0, created: 0, resolved: 0 };

  const due = candidates.filter((candidate) => isToleranceExpired(candidate, now));
  const created = await createMissingEntryIncidents(dateKey, due);

  // Etapa 15M.19B §Lifecycle: resolver también a los candidatos de hoy que
  // NO están "due" en este tick pero pueden tener un incidente PENDIENTE de
  // un tick anterior (ej. ficharon recién). Se evalúa sobre TODOS los
  // candidatos con obligación hoy, no sólo los `due` de esta pasada.
  const resolved = await resolvePendingMissingEntries(dateKey, candidates);

  return { candidates: candidates.length, due: due.length, created, resolved };
}

/**
 * Etapa 15M.19F (docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md): evalúa una
 * fecha operativa YA completamente elapsada (nunca "hoy") — usada
 * exclusivamente por el catch-up de `missingEntryScheduler.ts`. A diferencia
 * de `checkMissingExpectedEntries`, no filtra por tolerancia: el día entero
 * ya pasó, así que cualquier obligación real de ese día está, por
 * definición, vencida. También corre el paso de resolución sobre los mismos
 * candidatos — esto además resuelve, de forma incidental pero correcta, un
 * incidente de un turno que cruza medianoche cuyo ingreso (tardío) recién se
 * registró después de las 00:00 del día siguiente, caso que
 * `checkMissingExpectedEntries` del día siguiente nunca vuelve a mirar por sí
 * solo (evalúa sólo SU "hoy").
 */
export async function checkMissingEntriesForElapsedDate(dateKey: string): Promise<{ created: number; resolved: number }> {
  const { candidates } = await resolveWorkObligationCandidates(dateKey);
  if (!candidates.length) return { created: 0, resolved: 0 };
  const created = await createMissingEntryIncidents(dateKey, candidates);
  const resolved = await resolvePendingMissingEntries(dateKey, candidates);
  return { created, resolved };
}
