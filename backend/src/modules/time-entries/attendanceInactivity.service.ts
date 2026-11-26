import { EmployeeStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../shared/prisma/client";
import { argentinaCalendarDate, argentinaDateParts, argentinaDayRange, formatArgentinaDate, nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { noveltyCoversDay } from "../novelties/novelties.dateRange";
import { resolveWorkObligationCandidates, type WorkObligationCandidate } from "../shifts/workObligation.service";
import { closestOccurrence } from "../shifts/workShiftEvaluation.service";
import { assignInstantToBlock, DEFAULT_BLOCK_EARLY_WINDOW_MINUTES } from "../shifts/blockAssignment";
import { effectiveBlocksAround } from "../shifts/rotationObligation.service";
import type { LoadedRotationTemplate } from "../shifts/rotationPlan.loader";
import type { ExpectedBlock } from "../shifts/rotationPlan";
import { calendarDayEventAt } from "../workforce-management/notificationListing";
import { resolveEmployeeNotificationRecipientsBatch } from "../workforce-management/employeeNotificationRecipients";

export function previousOperationalDateKey(value = new Date()) {
  const { year, month, day } = argentinaDateParts(value);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function isInactivityCheckDue(value: Date, hour: number, minute: number) {
  const local = argentinaDateParts(value);
  return local.hour > hour || (local.hour === hour && local.minute >= minute);
}

// Etapa 15M.19B: renombrado de `ranges` (privado) a `operationalDateRanges`
// (exportado) — sigue siendo la misma cuenta de siempre, ahora reutilizada
// también por missingEntry.service.ts (chequeo intradía de falta de
// ingreso), que necesita exactamente el mismo rango [00:00, 24:00) ART de
// una fecha operativa para buscar evidencia de actividad.
export function operationalDateRanges(dateKey: string) {
  const operationalDate = argentinaCalendarDate(dateKey);
  const nextOperationalDate = new Date(operationalDate.getTime() + 24 * 60 * 60 * 1000);
  const { startAt: localStart, endAt: localEnd } = argentinaDayRange(dateKey);
  return { operationalDate, nextOperationalDate, localStart, localEnd };
}

export type OperationalDateRanges = ReturnType<typeof operationalDateRanges>;

/**
 * Etapa 15M.19B: qué cuenta como "evidencia de actividad" para un conjunto
 * de empleados en una fecha operativa — extraído del `where` que antes vivía
 * inline en `detectAttendanceInactivity` (relación `Employee.attendancePunches
 * /workShifts/timeEntries: none`), ahora expresado como 3 consultas batch
 * (una por modelo, `employeeId IN (...)`, nunca una por empleado) porque el
 * chequeo intradía de falta de ingreso (missingEntry.service.ts) necesita
 * exactamente la misma pregunta para un universo de candidatos distinto
 * (resuelto por ShiftAssignment, no por Employee). Misma semántica de
 * siempre: fichada, jornada iniciada o carga horaria manual/automática
 * cualquiera cuenta como "hubo actividad" — no distingue tipo ni fuente.
 */
export async function findEmployeeIdsWithActivityEvidence(employeeIds: string[], ranges: OperationalDateRanges): Promise<Set<string>> {
  if (!employeeIds.length) return new Set();
  const [punches, workShifts, timeEntries] = await Promise.all([
    prisma.attendancePunch.findMany({ where: { employeeId: { in: employeeIds }, timestamp: { gte: ranges.localStart, lt: ranges.localEnd } }, select: { employeeId: true }, distinct: ["employeeId"] }),
    prisma.workShift.findMany({ where: { employeeId: { in: employeeIds }, startAt: { gte: ranges.localStart, lt: ranges.localEnd } }, select: { employeeId: true }, distinct: ["employeeId"] }),
    prisma.timeEntry.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: ranges.operationalDate, lt: ranges.nextOperationalDate } }, select: { employeeId: true }, distinct: ["employeeId"] }),
  ]);
  return new Set([...punches, ...workShifts, ...timeEntries].map((row) => row.employeeId));
}

/**
 * Etapa 15M.19F (docs/decisions/MISSING_ENTRY_CROSS_MIDNIGHT_RECONCILIATION_15M19F.md):
 * evidencia PRECISA de que una obligación PUNTUAL de ingreso fue cumplida —
 * a diferencia de `findEmployeeIdsWithActivityEvidence` (que responde "¿hubo
 * CUALQUIER actividad ese día calendario?", la pregunta correcta para
 * SIN_ACTIVIDAD_REGISTRADA), esta responde "¿existe una fichada de INGRESO
 * que corresponda específicamente a ESTA obligación (este turno, este
 * `scheduledStartAt`)?" — la pregunta correcta para FALTA_INGRESO.
 *
 * Bug real que motivó esta función (caso "Sereno", turno nocturno
 * 23:00-07:00): la jornada anterior que cruza medianoche deja evidencia dentro
 * de la ventana `[00:00,24:00)` del día siguiente (la fichada de SALIDA, y/o
 * el `TimeEntry`/`WorkShift` generado por esa misma jornada) — ninguna de esas
 * señales demuestra que la NUEVA obligación de esa noche fue cumplida.
 * `findEmployeeIdsWithActivityEvidence`, al mirar "cualquier actividad del
 * día calendario", quedaba engañada por esa cola de actividad.
 *
 * Decisiones de diseño (documentadas a propósito, ver §21 del pedido):
 * - Sólo `AttendancePunch` de tipo INGRESO cuenta — nunca SALIDA (no es
 *   evidencia de haber INICIADO una jornada) ni `TimeEntry` (una carga
 *   horaria manual/automática no demuestra por sí sola que la persona fichó
 *   su ingreso; puede haberse cargado después, por otro motivo).
 * - Para cada punch candidato, se reutiliza `closestOccurrence` — el MISMO
 *   cálculo de "a qué ocurrencia del turno pertenece esta fichada" que ya usa
 *   `matchShiftForEmployee` (workShiftEvaluation.service.ts) para clasificar
 *   INGRESO_TARDE/TEMPRANO — en vez de un rango `[00:00,24:00)` del día
 *   calendario. Así, una fichada de las 23:00 de AYER nunca cuenta como
 *   evidencia de la obligación de HOY a las 23:00, aunque ambas toquen "el
 *   mismo día calendario" en algún punto de su ventana; y una fichada
 *   TARDÍA (ej. 23:25 con 10' de tolerancia) sigue contando como
 *   cumplimiento de la obligación de esta noche — sólo dejará de contar la
 *   FALTA_INGRESO, el retraso en sí lo sigue marcando `INGRESO_TARDE`
 *   (ShiftAlert), un sistema totalmente independiente que esta función no
 *   toca.
 */
export async function findEmployeeIdsWithMatchingEntryEvidence(candidates: WorkObligationCandidate[]): Promise<Set<string>> {
  if (!candidates.length) return new Set();
  const employeeIds = candidates.map((candidate) => candidate.employeeId);
  const times = candidates.map((candidate) => candidate.scheduledStartAt.getTime());
  const oneDayMs = 24 * 60 * 60 * 1000;
  const windowStart = new Date(Math.min(...times) - oneDayMs);
  const windowEnd = new Date(Math.max(...times) + oneDayMs);

  const punches = await prisma.attendancePunch.findMany({
    where: { employeeId: { in: employeeIds }, type: "INGRESO", timestamp: { gte: windowStart, lt: windowEnd } },
    select: { employeeId: true, timestamp: true },
  });

  const timestampsByEmployee = new Map<string, Date[]>();
  for (const punch of punches) {
    const list = timestampsByEmployee.get(punch.employeeId) ?? [];
    list.push(punch.timestamp);
    timestampsByEmployee.set(punch.employeeId, list);
  }

  const matched = new Set<string>();
  for (const candidate of candidates) {
    const timestamps = timestampsByEmployee.get(candidate.employeeId);
    if (!timestamps?.length) continue;
    const satisfiesThisObligation = timestamps.some(
      (timestamp) => closestOccurrence(timestamp, candidate.template.startTime).scheduledAt.getTime() === candidate.scheduledStartAt.getTime(),
    );
    if (satisfiesThisObligation) matched.add(candidate.employeeId);
  }
  return matched;
}

/**
 * R4.3b (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5): evidencia de
 * ingreso POR BLOQUE para obligaciones de rotación. Una fichada INGRESO es
 * evidencia de a lo sumo un bloque: el que le asigna `assignInstantToBlock`
 * (R4.2) entre los bloques EFECTIVOS de D−1, D y D+1 (convocatoria con
 * plantilla, franco, feriado, régimen, REST/MISSING/CONFLICT ya aplicados por
 * `resolveRotationObligations`): una entrada nunca se asigna a un bloque
 * habitual reemplazado. Fuera de todas las ventanas no satisface nada.
 * Nunca usa la coincidencia legacy por plantilla aislada.
 * Devuelve las `obligationKey` con evidencia. Asignar no es puntualidad
 * (eso es R4.4). Consultas: resolución efectiva en lote + una de fichadas.
 */
export async function findSatisfiedBlockObligationKeys(blocks: ReadonlyArray<ExpectedBlock<LoadedRotationTemplate>>): Promise<Set<string>> {
  const satisfied = new Set<string>();
  if (!blocks.length) return satisfied;
  const employeeIds = [...new Set(blocks.map((block) => block.employeeId))];
  const dates = new Set<string>();
  for (const block of blocks) {
    dates.add(previousCalendarDateKey(block.operationalDate));
    dates.add(block.operationalDate);
    dates.add(nextCalendarDateKey(block.operationalDate));
  }
  const { blocksByEmployee: candidatesByEmployee } = await effectiveBlocksAround(employeeIds, [...dates]);
  const allCandidates = [...candidatesByEmployee.values()].flat();
  if (!allCandidates.length) return satisfied;
  const windowStart = new Date(Math.min(...allCandidates.map((block) => block.scheduledStartAt.getTime())) - DEFAULT_BLOCK_EARLY_WINDOW_MINUTES * 60_000);
  const windowEnd = new Date(Math.max(...allCandidates.map((block) => block.scheduledEndAt.getTime())));
  const punches = await prisma.attendancePunch.findMany({
    where: { employeeId: { in: employeeIds }, type: "INGRESO", timestamp: { gte: windowStart, lt: windowEnd } },
    select: { employeeId: true, timestamp: true },
  });
  for (const punch of punches) {
    const assignment = assignInstantToBlock(punch.timestamp, candidatesByEmployee.get(punch.employeeId) ?? []);
    if (assignment.kind === "ASSIGNED") satisfied.add(assignment.block.obligationKey);
  }
  return satisfied;
}

/**
 * R4.9C.2 O2 (SHIFT_ROTATION_AUDIT_PLAN.md §25.19): fichadas de INGRESO EN
 * CURSO. El fichador confirma el `ClockPunchAttempt` (PROCESSING) ANTES de
 * tomar el instante de la fichada, subir la foto y confirmar el
 * `AttendancePunch`. Un detector que, a partir del vencimiento, lee PRIMERO
 * los intentos y DESPUÉS las fichadas no puede perder una fichada puntual:
 * si su intento no estaba visible en la primera lectura, la fichada tomó su
 * instante después de esa lectura (≥ vencimiento) y es tardía; si estaba
 * PROCESSING, esa obligación se pospone; si ya estaba COMPLETED, la fichada
 * ya estaba confirmada (misma transacción) y la segunda lectura la ve.
 * Sólo cuentan intentos dentro del TTL (vencido el TTL el mantenimiento los
 * pasa a FAILED). `startedAt` usa el reloj de la aplicación, el mismo de la
 * fichada y de este chequeo.
 */
async function inFlightEntryAttempts(employeeIds: string[], asOf: Date) {
  if (!employeeIds.length) return [];
  return prisma.clockPunchAttempt.findMany({
    where: { employeeId: { in: employeeIds }, punchType: "INGRESO", status: "PROCESSING", startedAt: { gte: new Date(asOf.getTime() - env.CLOCK_ATTEMPT_PROCESSING_TTL_MS) } },
    select: { employeeId: true, startedAt: true },
  });
}

/** O2, legacy: empleados cuyo intento en curso corresponde a ESTA obligación (misma ocurrencia que la evidencia precisa). */
export async function findEmployeeIdsWithInFlightEntryForObligation(candidates: WorkObligationCandidate[], asOf: Date): Promise<Set<string>> {
  const attempts = await inFlightEntryAttempts([...new Set(candidates.map((candidate) => candidate.employeeId))], asOf);
  const deferred = new Set<string>();
  for (const candidate of candidates) {
    const matches = attempts.some((attempt) => attempt.employeeId === candidate.employeeId
      && closestOccurrence(attempt.startedAt, candidate.template.startTime).scheduledAt.getTime() === candidate.scheduledStartAt.getTime());
    if (matches) deferred.add(candidate.employeeId);
  }
  return deferred;
}

/** O2, rotación: `obligationKey` del bloque al que se asignaría cada intento en curso (misma asignación que la evidencia por bloque). */
export async function findInFlightBlockObligationKeys(blocks: ReadonlyArray<ExpectedBlock<LoadedRotationTemplate>>, asOf: Date): Promise<Set<string>> {
  const keys = new Set<string>();
  const attempts = await inFlightEntryAttempts([...new Set(blocks.map((block) => block.employeeId))], asOf);
  if (!attempts.length) return keys;
  const employeeIds = [...new Set(attempts.map((attempt) => attempt.employeeId))];
  const dates = new Set<string>();
  for (const block of blocks.filter((candidate) => employeeIds.includes(candidate.employeeId))) {
    dates.add(previousCalendarDateKey(block.operationalDate));
    dates.add(block.operationalDate);
    dates.add(nextCalendarDateKey(block.operationalDate));
  }
  const { blocksByEmployee } = await effectiveBlocksAround(employeeIds, [...dates]);
  for (const attempt of attempts) {
    const assignment = assignInstantToBlock(attempt.startedAt, blocksByEmployee.get(attempt.employeeId) ?? []);
    if (assignment.kind === "ASSIGNED") keys.add(assignment.block.obligationKey);
  }
  return keys;
}

/**
 * Etapa 15M.19B: qué empleados quedan exceptuados por una novedad vigente
 * — extraído del `where` de novedades que antes vivía inline en
 * `detectAttendanceInactivity`. Fechas: `toDate` nulo es un único día
 * (`fromDate`), nunca un rango abierto (NOVELTY_COVERAGE_ENGINE.md §6.3,
 * `noveltyCoversDay`). Misma política de estado de siempre: cualquier
 * estado distinto de RECHAZADO exime presencia — usar exactamente este
 * criterio en cualquier llamador nuevo, nunca una política paralela (ver
 * docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md §Novedades).
 */
export async function findEmployeeIdsExcludedByNovelty(employeeIds: string[], operationalDate: Date): Promise<Set<string>> {
  if (!employeeIds.length) return new Set();
  const novelties = await prisma.novelty.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: { not: "RECHAZADO" },
      fromDate: { lte: operationalDate },
      OR: [{ toDate: { gte: operationalDate } }, { toDate: null, fromDate: operationalDate }],
    },
    select: { employeeId: true, fromDate: true, toDate: true },
  });
  return new Set(novelties.filter((novelty) => noveltyCoversDay(novelty, operationalDate)).map((novelty) => novelty.employeeId));
}

export interface InactivityCandidate {
  id: string;
  legajo: string;
  firstName: string;
  lastName: string;
}

export interface PersistInactivityResult {
  detected: number;
  notified: number;
}

export const INACTIVITY_CANDIDATE_SELECT = {
  id: true,
  legajo: true,
  firstName: true,
  lastName: true,
} as const;

/**
 * Avisos internos de incidentes de inactividad (legacy por día y R4.3b por
 * bloque). R4.3b (§25.5): por incidente, una transacción que PRIMERO reclama
 * el aviso con un único UPDATE … WHERE notifiedAt IS NULL y sólo si lo ganó
 * crea las filas `SystemNotification` — se confirman juntos o ninguno. Dos
 * ejecuciones concurrentes nunca avisan dos veces; un fallo antes de confirmar
 * deja `notifiedAt` en NULL y el próximo tick/catch-up lo reintenta.
 * Garantía limitada a los registros internos `SystemNotification`: este flujo
 * no tiene entregas externas (push/mail).
 * Destinatarios en batch (RRHH + responsables Nivel 2 + Nivel 3 heredados),
 * vigencia evaluada en la fecha operativa del incidente — no en el día en que
 * corre el chequeo (un catch-up de días anteriores usa los responsables de
 * ese día).
 */
export async function claimAndNotifyInactivityIncidents<I extends { id: string; employeeId: string }>(
  incidents: readonly I[],
  dateKey: string,
  type: "SIN_ACTIVIDAD_REGISTRADA" | "FALTA_INGRESO",
  title: string,
  buildMessage: (incident: I) => string,
): Promise<number> {
  if (!incidents.length) return 0;
  const recipientsByEmployee = await resolveEmployeeNotificationRecipientsBatch([...new Set(incidents.map((incident) => incident.employeeId))], dateKey);
  let notified = 0;
  for (const incident of incidents) {
    const recipients = recipientsByEmployee.get(incident.employeeId) ?? [];
    let claimed = false;
    await prisma.$transaction(async (tx) => {
      const claim = await tx.attendanceInactivityIncident.updateMany({ where: { id: incident.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
      if (claim.count !== 1) return;
      claimed = true;
      if (recipients.length) {
        await tx.systemNotification.createMany({
          data: recipients.map((recipientUserId) => ({
            recipientUserId,
            type,
            priority: "ALTA" as const,
            title,
            message: buildMessage(incident),
            entityType: "AttendanceInactivityIncident",
            entityId: incident.id,
            eventAt: calendarDayEventAt(dateKey),
            link: `/asistencia?observationDate=${dateKey}`,
          })),
        });
      }
    });
    if (claimed) notified += recipients.length;
  }
  return notified;
}

/**
 * Etapa 15M.19B: extraído de `detectAttendanceInactivity` para reutilizarse
 * también desde el chequeo intradía de falta de ingreso
 * (missingEntry.service.ts) — ambos escriben al MISMO modelo
 * (`AttendanceInactivityIncident`) con la MISMA identidad (`employeeId` +
 * `operationalDate`, `@@unique`) y el MISMO mecanismo de idempotencia
 * (`createMany` con `skipDuplicates` + `notifiedAt` dentro de una
 * transacción por incidente). Esto no es casualidad: una ausencia detectada
 * primero por el chequeo intradía y luego revisitada por el chequeo diario
 * NUNCA debe generar un segundo incidente ni una segunda notificación — son,
 * a propósito, la misma fila (ver docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md
 * §Relación con Sin actividad registrada).
 */
export async function persistAndNotifyInactivityIncidents(
  operationalDate: Date,
  dateKey: string,
  type: "SIN_ACTIVIDAD_REGISTRADA" | "FALTA_INGRESO",
  title: string,
  candidates: InactivityCandidate[],
  buildObservation: (candidate: InactivityCandidate) => string,
  buildMessage: (candidate: InactivityCandidate) => string,
): Promise<PersistInactivityResult> {
  if (!candidates.length) return { detected: 0, notified: 0 };

  await prisma.attendanceInactivityIncident.createMany({
    data: candidates.map((employee) => ({
      employeeId: employee.id,
      operationalDate,
      observation: buildObservation(employee),
    })),
    skipDuplicates: true,
  });

  const pendingNotification = await prisma.attendanceInactivityIncident.findMany({
    where: { operationalDate, notifiedAt: null, employeeId: { in: candidates.map((employee) => employee.id) } },
    include: { employee: { select: INACTIVITY_CANDIDATE_SELECT } },
  });
  const notified = await claimAndNotifyInactivityIncidents(pendingNotification, dateKey, type, title, (incident) => buildMessage(incident.employee));
  return { detected: candidates.length, notified };
}

// Etapa 12E: en una fecha feriado (DoubleHourRule.kind=FERIADO — nunca por
// nombre de regla), "Sin actividad registrada" sólo tiene sentido para
// quien tenía una expectativa real de trabajar. Esa expectativa la define
// HolidayWorkAssignment (Etapa 12D), nunca "tener turno" ni "estar activo"
// por sí solos.
//
// Etapa 15M.19B (docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md): antes de
// esta etapa, el universo de candidatos era "todo Employee ACTIVO", sin
// ninguna noción de turno/régimen — un empleado sin obligación real de
// trabajar ese día (régimen SIN_TURNO, día de descanso semanal, asignación
// vencida) igual generaba el incidente si no tenía fichadas/horas/novedades.
// Ahora el universo de candidatos lo resuelve `resolveWorkObligationCandidates`
// (shifts/workObligation.service.ts) — la MISMA función que usa el chequeo
// intradía de falta de ingreso — que ya exige ShiftAssignment propia
// HABILITADA, vigente, aplicable a este día de semana, régimen distinto de
// SIN_TURNO, y (en feriado) convocatoria HolidayWorkAssignment ACTIVA. Este
// chequeo diario sigue agregando, sobre esos candidatos, las dos condiciones
// que le son propias: cero evidencia de actividad en TODO el día, y ninguna
// novedad vigente que lo exima.
export async function detectAttendanceInactivity(dateKey: string): Promise<{ date: string } & PersistInactivityResult> {
  const ranges = operationalDateRanges(dateKey);
  const { isHoliday, candidates: allCandidates } = await resolveWorkObligationCandidates(dateKey);
  // R4.3b (§25.5): una obligación por BLOQUES de rotación registra sus
  // ausencias sólo por bloque (falta de ingreso por bloque) — nunca
  // SIN_ACTIVIDAD_REGISTRADA. Se excluye desde el principio, así el resultado
  // no depende del orden en que corran este proceso y el de falta de ingreso.
  const blockObligated = new Set(allCandidates.filter((candidate) => candidate.block).map((candidate) => candidate.employeeId));
  const obligationCandidates = blockObligated.size ? allCandidates.filter((candidate) => !blockObligated.has(candidate.employeeId)) : allCandidates;
  if (!obligationCandidates.length) return { date: dateKey, detected: 0, notified: 0 };

  const obligationEmployeeIds = obligationCandidates.map((candidate) => candidate.employeeId);
  const [hasEvidence, excludedByNovelty] = await Promise.all([
    findEmployeeIdsWithActivityEvidence(obligationEmployeeIds, ranges),
    findEmployeeIdsExcludedByNovelty(obligationEmployeeIds, ranges.operationalDate),
  ]);
  const finalCandidateIds = obligationEmployeeIds.filter((id) => !hasEvidence.has(id) && !excludedByNovelty.has(id));
  if (!finalCandidateIds.length) return { date: dateKey, detected: 0, notified: 0 };

  const employees = await prisma.employee.findMany({
    where: { id: { in: finalCandidateIds }, status: EmployeeStatus.ACTIVO },
    select: INACTIVITY_CANDIDATE_SELECT,
  });

  const result = await persistAndNotifyInactivityIncidents(
    ranges.operationalDate,
    dateKey,
    "SIN_ACTIVIDAD_REGISTRADA",
    "Sin actividad registrada",
    employees,
    (employee) =>
      isHoliday
        ? `La persona estaba convocada a trabajar el feriado del ${formatArgentinaDate(dateKey)} y no se registraron fichadas, horas ni novedades. Requiere revisión.`
        : `No se registraron fichadas, horas ni novedades para el ${formatArgentinaDate(dateKey)}. Requiere revisión.`,
    (employee) =>
      isHoliday
        ? `${employee.lastName}, ${employee.firstName} · Legajo ${employee.legajo} estaba convocado a trabajar el feriado del ${formatArgentinaDate(dateKey)} y no registra actividad.`
        : `${employee.lastName}, ${employee.firstName} · Legajo ${employee.legajo} no registra actividad para el ${formatArgentinaDate(dateKey)}.`,
  );
  return { date: dateKey, ...result };
}
