import { EmployeeStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { argentinaCalendarDate, argentinaDateParts, argentinaDayRange, formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import { noveltyCoversDay } from "../novelties/novelties.dateRange";
import { resolveWorkObligationCandidates, type WorkObligationCandidate } from "../shifts/workObligation.service";
import { closestOccurrence } from "../shifts/workShiftEvaluation.service";

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
 * Etapa 15M.19B: qué empleados quedan exceptuados por una novedad vigente
 * — extraído del `where` de novedades que antes vivía inline en
 * `detectAttendanceInactivity` (Etapa 15L.2C: `allowsDateRange` decide si
 * una novedad open-ended cubre días posteriores a `fromDate`, mismo criterio
 * que `noveltyCoversDay`). Misma política de siempre, sin cambios: cualquier
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
      OR: [{ toDate: null }, { toDate: { gte: operationalDate } }],
    },
    select: { employeeId: true, fromDate: true, toDate: true, noveltyType: { select: { allowsDateRange: true } } },
  });
  return new Set(novelties.filter((novelty) => noveltyCoversDay(novelty, novelty.noveltyType, operationalDate)).map((novelty) => novelty.employeeId));
}

export interface InactivityCandidate {
  id: string;
  legajo: string;
  firstName: string;
  lastName: string;
  assignments: { userId: string | null }[];
}

export interface PersistInactivityResult {
  detected: number;
  notified: number;
}

const TIME_RESPONSIBLE_SELECT = {
  where: { type: "TIME_RESPONSIBLE" as const, userId: { not: null }, OR: [{ status: null }, { status: { in: ["ACTIVO", "Activo"] } }] },
  select: { userId: true },
};

export const INACTIVITY_CANDIDATE_SELECT = {
  id: true,
  legajo: true,
  firstName: true,
  lastName: true,
  assignments: TIME_RESPONSIBLE_SELECT,
} as const;

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
  const rrhh = await prisma.user.findMany({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } });
  let notified = 0;

  for (const incident of pendingNotification) {
    const recipients = Array.from(new Set([
      ...rrhh.map((user) => user.id),
      ...incident.employee.assignments.flatMap((assignment) => (assignment.userId ? [assignment.userId] : [])),
    ]));
    await prisma.$transaction(async (tx) => {
      if (recipients.length) {
        await tx.systemNotification.createMany({
          data: recipients.map((recipientUserId) => ({
            recipientUserId,
            type,
            priority: "ALTA",
            title,
            message: buildMessage(incident.employee),
            entityType: "AttendanceInactivityIncident",
            entityId: incident.id,
            link: `/asistencia?observationDate=${dateKey}`,
          })),
        });
      }
      await tx.attendanceInactivityIncident.update({ where: { id: incident.id }, data: { notifiedAt: new Date() } });
    });
    notified += recipients.length;
  }

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
  const { isHoliday, candidates: obligationCandidates } = await resolveWorkObligationCandidates(dateKey);
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
