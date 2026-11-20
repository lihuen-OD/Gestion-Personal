import { prisma } from "../../shared/prisma/client";
import { argentinaDayRange, formatArgentinaDate, previousCalendarDateKey, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { lockEmployeeDays } from "../employee-day-offs/employeeDayLock";
import { resolveRotationBlockCandidates, resolveWorkObligationCandidates, type WorkObligationCandidate } from "../shifts/workObligation.service";
import {
  claimAndNotifyInactivityIncidents,
  findEmployeeIdsExcludedByNovelty,
  findEmployeeIdsWithMatchingEntryEvidence,
  findSatisfiedBlockObligationKeys,
  INACTIVITY_CANDIDATE_SELECT,
  operationalDateRanges,
  persistAndNotifyInactivityIncidents,
} from "./attendanceInactivity.service";

/**
 * R4.3b — decisión INTERINA (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md
 * §25.5, tarea T-R4-CONC, bloqueante de R4.9): el (empleado, fecha) ya tenía
 * un incidente de DÍA revisado por una persona (o descartado). No se reabre ni
 * modifica la decisión humana, no se crean faltas por bloque ni avisos: el
 * caso se informa acá, de forma determinística, para su conciliación. Esto NO
 * es una conciliación persistente.
 */
export interface MissingEntryReconciliationRequired {
  employeeId: string;
  dateKey: string;
  dayIncidentId: string;
  /** `obligationKey` de los bloques vencidos sin evidencia que no se registraron. */
  blockKeys: string[];
}

export interface MissingEntryCheckResult {
  candidates: number;
  due: number;
  created: number;
  resolved: number;
  /** Sólo presente si hay casos (R4.3b, interino). */
  reconciliationRequired?: MissingEntryReconciliationRequired[];
}

const DAY_REPLACED_BY_BLOCKS_NOTE = "Reemplazado por las faltas de ingreso por bloque de la programación por rotación.";
const BLOCK_RESOLVED_NOTE = "Resuelto automáticamente: se registró el ingreso correspondiente al bloque de la programación por rotación.";
const ENTRY_RESOLVED_NOTE = "Resuelto automáticamente: se registró el ingreso correspondiente a la obligación.";

function entryDeadline(candidate: WorkObligationCandidate): number {
  return candidate.scheduledStartAt.getTime() + candidate.template.entryToleranceAfterMinutes * 60_000;
}

function isToleranceExpired(candidate: WorkObligationCandidate, now: Date): boolean {
  return now.getTime() >= entryDeadline(candidate);
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
      reviewNote: ENTRY_RESOLVED_NOTE,
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

// ---------------------------------------------------------------------------
// R4.3b (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5): falta de ingreso
// POR BLOQUE para obligaciones de rotación. Los candidatos sin `block`
// (turnos fijos) siguen exactamente el camino legacy de arriba; estas
// funciones sólo corren cuando hay candidatos por bloque, y son las únicas que
// leen/escriben `scheduledStartAt`.
// ---------------------------------------------------------------------------

type BlockCandidate = WorkObligationCandidate & { block: NonNullable<WorkObligationCandidate["block"]> };

const isBlockCandidate = (candidate: WorkObligationCandidate): candidate is BlockCandidate => Boolean(candidate.block);

type BlockOutcome = { created: number; reconciliationRequired: MissingEntryReconciliationRequired[] };

function groupByEmployeeDate(candidates: readonly BlockCandidate[]) {
  const groups = new Map<string, { employeeId: string; dateKey: string; blocks: BlockCandidate[] }>();
  for (const candidate of candidates) {
    const key = `${candidate.employeeId}|${candidate.block.operationalDate}`;
    const group = groups.get(key) ?? { employeeId: candidate.employeeId, dateKey: candidate.block.operationalDate, blocks: [] };
    group.blocks.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => (left.dateKey + left.employeeId).localeCompare(right.dateKey + right.employeeId));
}

const blockObservation = (candidate: BlockCandidate) =>
  `No se registró el ingreso dentro de la tolerancia del turno ${candidate.block.template.code} (${candidate.block.template.startTime}) para el ${formatArgentinaDate(candidate.block.operationalDate)}. Requiere revisión.`;

/**
 * Crea las faltas de ingreso de los bloques VENCIDOS (`due`) sin evidencia
 * propia (`assignInstantToBlock` sobre los bloques efectivos de D−1..D+1) ni
 * novedad que excluya el día. Por (empleado, fecha), una transacción con el
 * lock de jornada (`lockEmployeeDays`, misma familia que francos y
 * convocatorias):
 *  - incidente de DÍA revisado por una persona o DESCARTADO ⇒ no se crea nada
 *    ni se avisa; se informa en `reconciliationRequired` (interino, T-R4-CONC);
 *  - si no, `createMany` (skipDuplicates: idempotente por la unicidad por
 *    bloque de R4.3a), verificación de que TODAS las filas existen y, sólo
 *    entonces, un incidente de DÍA PENDIENTE sin revisión humana pasa a
 *    RESUELTA con nota de reemplazo — en la misma transacción (un fallo
 *    revierte ambos). Los bloques futuros nunca participan.
 * Los avisos van después, con el reclamo atómico compartido.
 */
async function createMissingBlockIncidents(due: readonly BlockCandidate[]): Promise<BlockOutcome> {
  const outcome: BlockOutcome = { created: 0, reconciliationRequired: [] };
  if (!due.length) return outcome;

  const dateKeys = [...new Set(due.map((candidate) => candidate.block.operationalDate))];
  const [satisfied, ...excludedPerDate] = await Promise.all([
    findSatisfiedBlockObligationKeys(due.map((candidate) => candidate.block)),
    ...dateKeys.map((dateKey) =>
      findEmployeeIdsExcludedByNovelty(
        [...new Set(due.filter((candidate) => candidate.block.operationalDate === dateKey).map((candidate) => candidate.employeeId))],
        operationalDateRanges(dateKey).operationalDate,
      ),
    ),
  ]);
  const excludedByDate = new Map(dateKeys.map((dateKey, index) => [dateKey, excludedPerDate[index]!]));
  const missing = due.filter((candidate) => !satisfied.has(candidate.block.obligationKey) && !excludedByDate.get(candidate.block.operationalDate)!.has(candidate.employeeId));
  if (!missing.length) return outcome;

  const persisted: BlockCandidate[] = [];
  for (const group of groupByEmployeeDate(missing)) {
    const operationalDate = operationalDateRanges(group.dateKey).operationalDate;
    const starts = group.blocks.map((candidate) => candidate.block.scheduledStartAt);
    const skipped = await prisma.$transaction(async (tx) => {
      await lockEmployeeDays(tx, [{ employeeId: group.employeeId, dateKey: group.dateKey }]);
      const dayIncident = await tx.attendanceInactivityIncident.findFirst({
        where: { employeeId: group.employeeId, operationalDate, scheduledStartAt: null },
        select: { id: true, status: true, reviewedByUserId: true },
      });
      if (dayIncident && (dayIncident.reviewedByUserId !== null || dayIncident.status === "DESCARTADA")) {
        return { dayIncidentId: dayIncident.id };
      }
      await tx.attendanceInactivityIncident.createMany({
        data: group.blocks.map((candidate) => ({ employeeId: group.employeeId, operationalDate, scheduledStartAt: candidate.block.scheduledStartAt, observation: blockObservation(candidate) })),
        skipDuplicates: true,
      });
      const rows = await tx.attendanceInactivityIncident.count({ where: { employeeId: group.employeeId, operationalDate, scheduledStartAt: { in: starts } } });
      if (rows !== starts.length) {
        throw new Error(`Faltas por bloque no persistidas (${rows}/${starts.length}) para ${group.dateKey}; se revierte sin reemplazar el incidente del día.`);
      }
      if (dayIncident?.status === "PENDIENTE") {
        await tx.attendanceInactivityIncident.updateMany({
          where: { id: dayIncident.id, status: "PENDIENTE", reviewedByUserId: null },
          data: { status: "RESUELTA", reviewedAt: new Date(), reviewNote: DAY_REPLACED_BY_BLOCKS_NOTE },
        });
      }
      return null;
    });
    if (skipped) {
      outcome.reconciliationRequired.push({ employeeId: group.employeeId, dateKey: group.dateKey, dayIncidentId: skipped.dayIncidentId, blockKeys: group.blocks.map((candidate) => candidate.block.obligationKey) });
      continue;
    }
    persisted.push(...group.blocks);
  }
  outcome.created = persisted.length;
  if (!persisted.length) return outcome;

  const byKey = new Map(persisted.map((candidate) => [candidate.block.obligationKey, candidate]));
  for (const dateKey of [...new Set(persisted.map((candidate) => candidate.block.operationalDate))]) {
    const pending = await prisma.attendanceInactivityIncident.findMany({
      where: {
        operationalDate: operationalDateRanges(dateKey).operationalDate,
        notifiedAt: null,
        scheduledStartAt: { not: null },
        employeeId: { in: [...new Set(persisted.filter((candidate) => candidate.block.operationalDate === dateKey).map((candidate) => candidate.employeeId))] },
      },
      select: { id: true, employeeId: true, scheduledStartAt: true, employee: { select: INACTIVITY_CANDIDATE_SELECT } },
      orderBy: [{ employeeId: "asc" }, { scheduledStartAt: "asc" }],
    });
    const toNotify = pending
      .map((incident) => ({ ...incident, candidate: byKey.get(`${incident.employeeId}|${incident.scheduledStartAt!.toISOString()}`) }))
      .filter((incident): incident is typeof incident & { candidate: BlockCandidate } => Boolean(incident.candidate));
    await claimAndNotifyInactivityIncidents(toNotify, dateKey, "FALTA_INGRESO", "Falta de ingreso", (incident) => {
      const { employee, candidate } = incident;
      return `${employee.lastName}, ${employee.firstName} · Legajo ${employee.legajo} no fichó su ingreso dentro de la tolerancia del turno ${candidate.block.template.code} (${candidate.block.template.startTime}).`;
    });
  }
  return outcome;
}

/**
 * Resolución automática POR BLOQUE: un incidente PENDIENTE con
 * `scheduledStartAt` se resuelve sólo si SU bloque (`obligationKey`) tiene
 * evidencia — la entrada de un bloque nunca resuelve la falta de otro. Un
 * incidente de DÍA PENDIENTE de un empleado en rotación (anomalía previa) se
 * resuelve si alguno de los bloques de ese día tiene evidencia.
 */
async function resolvePendingBlockIncidents(candidates: readonly BlockCandidate[]): Promise<number> {
  if (!candidates.length) return 0;
  let resolved = 0;
  for (const dateKey of [...new Set(candidates.map((candidate) => candidate.block.operationalDate))]) {
    const ofDate = candidates.filter((candidate) => candidate.block.operationalDate === dateKey);
    const pending = await prisma.attendanceInactivityIncident.findMany({
      where: { operationalDate: operationalDateRanges(dateKey).operationalDate, status: "PENDIENTE", employeeId: { in: [...new Set(ofDate.map((candidate) => candidate.employeeId))] } },
      select: { id: true, employeeId: true, scheduledStartAt: true },
    });
    if (!pending.length) continue;
    const satisfied = await findSatisfiedBlockObligationKeys(ofDate.map((candidate) => candidate.block));
    const employeesWithEvidence = new Set(ofDate.filter((candidate) => satisfied.has(candidate.block.obligationKey)).map((candidate) => candidate.employeeId));
    const blockIds = pending.filter((incident) => incident.scheduledStartAt && satisfied.has(`${incident.employeeId}|${incident.scheduledStartAt.toISOString()}`)).map((incident) => incident.id);
    const dayIds = pending.filter((incident) => !incident.scheduledStartAt && employeesWithEvidence.has(incident.employeeId)).map((incident) => incident.id);
    if (blockIds.length) {
      await prisma.attendanceInactivityIncident.updateMany({ where: { id: { in: blockIds }, status: "PENDIENTE" }, data: { status: "RESUELTA", reviewedAt: new Date(), reviewNote: BLOCK_RESOLVED_NOTE } });
    }
    if (dayIds.length) {
      await prisma.attendanceInactivityIncident.updateMany({ where: { id: { in: dayIds }, status: "PENDIENTE" }, data: { status: "RESUELTA", reviewedAt: new Date(), reviewNote: ENTRY_RESOLVED_NOTE } });
    }
    resolved += blockIds.length + dayIds.length;
  }
  return resolved;
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
  // R4.3b: bloques de AYER cuya tolerancia vence HOY (empiezan cerca de la
  // medianoche): ningún otro tick los vería vencidos y el catch-up sólo crea
  // faltas de bloques ya vencidos. Con las tablas de rotación vacías es una
  // consulta vacía.
  const todayStart = argentinaDayRange(dateKey).startAt.getTime();
  const { candidates: yesterdayCandidates } = await resolveRotationBlockCandidates(previousCalendarDateKey(dateKey));
  const yesterdayTail = yesterdayCandidates.filter(isBlockCandidate).filter((candidate) => entryDeadline(candidate) >= todayStart);
  if (!candidates.length && !yesterdayTail.length) return { candidates: 0, due: 0, created: 0, resolved: 0 };

  const fixedCandidates = candidates.filter((candidate) => !isBlockCandidate(candidate));
  const blockCandidates = [...yesterdayTail, ...candidates.filter(isBlockCandidate)];

  const due = fixedCandidates.filter((candidate) => isToleranceExpired(candidate, now));
  const created = await createMissingEntryIncidents(dateKey, due);
  const blockDue = blockCandidates.filter((candidate) => isToleranceExpired(candidate, now));
  const blockOutcome = await createMissingBlockIncidents(blockDue);

  // Etapa 15M.19B §Lifecycle: resolver también a los candidatos de hoy que
  // NO están "due" en este tick pero pueden tener un incidente PENDIENTE de
  // un tick anterior (ej. ficharon recién). Se evalúa sobre TODOS los
  // candidatos con obligación hoy, no sólo los `due` de esta pasada.
  const resolved = (await resolvePendingMissingEntries(dateKey, fixedCandidates)) + (await resolvePendingBlockIncidents(blockCandidates));

  return {
    candidates: candidates.length,
    due: due.length + blockDue.length,
    created: created + blockOutcome.created,
    resolved,
    ...(blockOutcome.reconciliationRequired.length ? { reconciliationRequired: blockOutcome.reconciliationRequired } : {}),
  };
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
export async function checkMissingEntriesForElapsedDate(
  dateKey: string,
  now: Date = new Date(),
): Promise<{ created: number; resolved: number; reconciliationRequired?: MissingEntryReconciliationRequired[] }> {
  const { candidates } = await resolveWorkObligationCandidates(dateKey);
  if (!candidates.length) return { created: 0, resolved: 0 };
  const fixedCandidates = candidates.filter((candidate) => !isBlockCandidate(candidate));
  const blockCandidates = candidates.filter(isBlockCandidate);
  const created = await createMissingEntryIncidents(dateKey, fixedCandidates);
  // R4.3b: aun en una fecha elapsada, sólo bloques efectivamente vencidos
  // (uno que empieza cerca de la medianoche con tolerancia larga lo toma el
  // tick intradía del día siguiente).
  const blockOutcome = await createMissingBlockIncidents(blockCandidates.filter((candidate) => isToleranceExpired(candidate, now)));
  const resolved = (await resolvePendingMissingEntries(dateKey, fixedCandidates)) + (await resolvePendingBlockIncidents(blockCandidates));
  return {
    created: created + blockOutcome.created,
    resolved,
    ...(blockOutcome.reconciliationRequired.length ? { reconciliationRequired: blockOutcome.reconciliationRequired } : {}),
  };
}
