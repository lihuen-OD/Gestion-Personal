/**
 * PERF-5 (docs/decisions/F12_PERF_5.md) contra PostgreSQL REAL: el resultado funcional de una
 * fichada (IN, OUT y rollover) y su presupuesto de sentencias SQL por fase. Todo pasa por la app
 * real (createApp, requireClockDevice, controller, servicio, repositorios, storage, auditoría,
 * evaluación de turnos, Motor B y notificaciones); sólo el object storage primario (Neon) se
 * reemplaza por uno en memoria.
 *
 * Fases: PRE = antes del BEGIN de la transacción que inserta el AttendancePunch; TX = ese
 * BEGIN..COMMIT; POST = lo que el request todavía ejecuta después del COMMIT y antes de responder.
 * Los presupuestos son techos: bajar un número es una mejora, superarlo es una regresión.
 *
 * Opt-in: sólo corre con `CLOCK_PERF_IT_DATABASE_URL` → `localhost`, base `clock_it*` PROPIA, con el
 * schema de este commit (`DATABASE_URL=<url> npx prisma db push --skip-generate`). VACÍA la base al
 * empezar. Nunca usa el DATABASE_URL del .env y verifica `current_database()` antes de escribir.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.CLOCK_PERF_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(6000, 1).toString("base64")}`;

type Device = { id: string; secret: string };
type Statement = { verb: string; tables: string[] };
type Phases = { pre: number; tx: number; post: number; total: number };
type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  repository: typeof import("../time-entries/timeEntries.repository").timeEntriesRepository;
};

// Techos de sentencias SQL por fase para este fixture (ver F12_PERF_5.md §Presupuesto).
// Línea base medida antes de PERF-5 (mismo fixture): IN 5/11/9, OUT 17/19/23, ROLLOVER 6/16/17.
// PERF-5A: IN 5/10/9, OUT 16/17/22, ROLLOVER 6/15/17.
// PERF-5B: IN 4/10/9, OUT 15/17/22, ROLLOVER 5/15/17.
const BUDGET = {
  IN: { pre: 4, tx: 10, post: 9 },
  OUT: { pre: 15, tx: 17, post: 22 },
  ROLLOVER: { pre: 5, tx: 15, post: 17 },
} as const;

function describeSql(sql: string): Statement {
  const text = sql.replace(/\s+/g, " ").trim();
  return { verb: (/^(\w+)/.exec(text)?.[1] || "?").toUpperCase(), tables: [...new Set([...text.matchAll(/"public"\."(\w+)"/g)].map((m) => m[1]!))] };
}

function splitPhases(statements: Statement[]): Phases {
  const insert = statements.findIndex((s) => s.verb === "INSERT" && s.tables.includes("AttendancePunch"));
  if (insert < 0) throw new Error("La fichada no insertó AttendancePunch");
  let begin = insert;
  while (begin >= 0 && statements[begin]!.verb !== "BEGIN") begin -= 1;
  let commit = insert;
  while (commit < statements.length && statements[commit]!.verb !== "COMMIT") commit += 1;
  return { pre: begin, tx: commit - begin + 1, post: statements.length - commit - 1, total: statements.length };
}

describe.skipIf(!url)("PERF-5 — fichada contra PostgreSQL local: resultado funcional y presupuesto de sentencias", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let device: Device;
  let originalPunchPhotoProvider: Modules["env"]["PUNCH_PHOTO_STORAGE_PROVIDER"];
  let recording: Statement[] | null = null;
  const ids: Record<string, string> = {};

  async function punch(employeeId: string, punchType: "IN" | "OUT") {
    // La presencia del dispositivo (touchIfStale, fire-and-forget) no debe ensuciar el conteo.
    await holder.clockDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    recording = [];
    const response = await fetch(`${baseUrl}/clock/photo-punch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `ClockDevice ${device.id}.${device.secret}` },
      body: JSON.stringify({ requestId: randomUUID(), employeeId, punchType, photo: PHOTO, faceValidationStatus: "VALID", faceDetectionScore: 0.97 }),
    });
    const json = (await response.json()) as { data?: any; error?: { code: string } };
    const statements = recording;
    recording = null;
    return { status: response.status, data: json.data, error: json.error, phases: splitPhases(statements), statements };
  }

  /** Retrocede la jornada abierta (inicio y fichada de ingreso) para producir minutos reales y salir del cooldown. */
  async function ageOpenShift(employeeId: string, minutes: number) {
    const shift = await holder.workShift.findFirstOrThrow({ where: { employeeId, status: "ABIERTO" } });
    const startAt = new Date(shift.startAt.getTime() - minutes * 60_000);
    await holder.workShift.update({ where: { id: shift.id }, data: { startAt } });
    await holder.attendancePunch.update({ where: { id: shift.startPunchId! }, data: { timestamp: startAt } });
    return shift.id;
  }

  /** Reemplaza ids conocidos por marcadores estables dentro de un JSON. */
  function placeholders(value: unknown, map: Record<string, string>): unknown {
    if (typeof value === "string") return map[value] ?? value;
    if (Array.isArray(value)) return value.map((item) => placeholders(item, map));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, placeholders(item, map)]));
    return value;
  }

  /** Estado funcional observable de una jornada, sin ids ni instantes. */
  async function functionalSnapshot(workShiftId: string) {
    const shift = await holder.workShift.findUniqueOrThrow({
      where: { id: workShiftId },
      include: {
        startPunch: { include: { photoFile: true } },
        endPunch: { include: { photoFile: true } },
        timeSegments: { include: { specialHourRuleApplications: true }, orderBy: { fromDateTime: "asc" } },
        timeEntries: { orderBy: { date: "asc" } },
      },
    });
    const punchView = (punchRow: typeof shift.startPunch) => punchRow && {
      type: punchRow.type,
      source: punchRow.source,
      deviceId: punchRow.deviceId === device.id,
      faceValidationStatus: punchRow.faceValidationStatus,
      photoProvider: punchRow.photoFile?.storageProvider ?? null,
      photoLinkedToPunch: punchRow.photoFile?.attendancePunchId === punchRow.id,
      photoPathMatchesFile: punchRow.photoStoragePath === punchRow.photoFile?.storageKey,
      thumbnailFileId: punchRow.thumbnailFileId,
      rawPhoto: (punchRow.rawPayload as any)?.photo && { storageFileIdMatches: (punchRow.rawPayload as any).photo.storageFileId === punchRow.photoFileId, thumbnailStatus: (punchRow.rawPayload as any).photo.thumbnailStatus },
    };
    const audits = await holder.auditLog.findMany({ where: { entity: "WorkShift", entityId: workShiftId }, orderBy: { createdAt: "asc" } });
    const alerts = await holder.shiftAlert.findMany({ where: { workShiftId }, orderBy: { type: "asc" } });
    const notifications = await holder.systemNotification.findMany({
      where: { OR: [{ entityType: "WorkShift", entityId: workShiftId }, { entityType: "ShiftAlert", entityId: { in: alerts.map((alert) => alert.id) } }] },
      orderBy: [{ type: "asc" }, { title: "asc" }],
    });
    const breakdowns = await holder.hourConceptBreakdown.findMany({ where: { employeeId: shift.employeeId, source: "AUTOMATIC" }, orderBy: { date: "asc" } });
    const breakdownAudits = await holder.auditLog.count({ where: { entity: "HourConceptBreakdown", entityId: shift.employeeId } });
    return {
      shift: { status: shift.status, source: shift.source, totalMinutes: shift.totalMinutes, crossesMidnight: shift.crossesMidnight, hourConceptName: shift.hourConceptName, shiftTemplateId: shift.shiftTemplateId, observation: shift.observation },
      startPunch: punchView(shift.startPunch),
      endPunch: punchView(shift.endPunch),
      timeSegments: shift.timeSegments.map((segment) => ({
        minutes: segment.minutes,
        hourConceptName: segment.hourConceptName,
        conceptStatus: segment.conceptStatus,
        isNight: segment.isNight,
        isSpecial: segment.isSpecial,
        ruleApplications: segment.specialHourRuleApplications.map((app) => ({ isWinner: app.isWinner, wasConflicting: app.wasConflicting, multiplierApplied: Number(app.multiplierApplied) })),
      })),
      timeEntries: shift.timeEntries.map((entry) => ({ hours: Number(entry.hours), totalMinutes: entry.totalMinutes, actualMinutes: entry.actualMinutes, appliedMultiplier: Number(entry.appliedMultiplier), status: entry.status, source: entry.source, observation: entry.observation })),
      audits: audits.map((log) => ({ action: log.action, description: log.description, userId: log.userId, after: placeholders(log.after, { [device.id]: "<device>", [shift.employeeId]: "<employee>", [workShiftId]: "<shift>" }) })),
      alerts: alerts.map((alert) => ({ type: alert.type, status: alert.status, severity: alert.severity })),
      notifications: notifications.map((item) => ({ type: item.type, title: item.title, message: item.message, entityType: item.entityType, link: item.link, priority: item.priority, recipientIsRrhh: item.recipientUserId === ids.rrhh })),
      breakdowns: breakdowns.map((row) => ({ minutes: row.minutes, hourConceptId: row.hourConceptId === ids.nightConcept, appliedMultiplier: Number(row.appliedMultiplier), status: row.status })),
      breakdownAudits,
    };
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("CLOCK_PERF_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, { timeEntriesRepository }, credentials] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../time-entries/timeEntries.repository"),
      import("../../shared/security/clockDeviceCredentials"),
    ]);
    m = { env, prisma, repository: timeEntriesRepository };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });
    // Cliente base de la app (shared/prisma/client lo publica fuera de production con eventos de query).
    const base = (globalThis as unknown as { prisma: PrismaClient<{ log: [{ emit: "event"; level: "query" }] }> }).prisma;
    base.$on("query", (event) => recording?.push(describeSql(event.query)));

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "WorkShift_one_open_per_employee" ON "WorkShift"("employeeId") WHERE status = 'ABIERTO' AND "endAt" IS NULL`);

    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    const night = await holder.hourConcept.create({ data: { code: "HC-NOCHE", name: "Hora nocturna IT", kind: "NOCTURNA", loadMode: "AUTOMATIC" } });
    ids.nightConcept = night.id;
    await holder.hourConceptRule.create({ data: { hourConceptId: night.id, startTime: "00:00", endTime: "23:59" } });
    await holder.doubleHourRule.create({ data: { name: "Especial IT", recurrenceType: "SEMANAL", fromDate: new Date("2026-01-01"), weekdays: [0, 1, 2, 3, 4, 5, 6], multiplier: 2, priority: 1, reason: "PERF-5 IT" } });
    ids.rrhh = (await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-perf5@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } })).id;
    for (const [index, key] of ["golden", "rollover"].entries()) {
      const employee = await holder.employee.create({ data: { legajo: `P5-${index + 1}`, cuil: `20-5${index + 1}`, dni: `5${index + 1}`, firstName: "Prueba", lastName: `PERF5 ${key}` } });
      ids[key] = employee.id;
      await holder.employeeHourConcept.create({ data: { employeeId: employee.id, hourConceptId: night.id } });
    }
    const secret = credentials.generateClockDeviceSecret();
    const created = await holder.clockDevice.create({ data: { name: "TEST PERF5", status: "ACTIVE", tokenHash: credentials.hashClockDeviceSecret(secret), activatedAt: new Date(), lastSeenAt: new Date() } });
    device = { id: created.id, secret };

    originalPunchPhotoProvider = env.PUNCH_PHOTO_STORAGE_PROVIDER;
    env.PUNCH_PHOTO_STORAGE_PROVIDER = "neon_object_storage";
    env.CLOCK_PUNCH_COOLDOWN_SECONDS = 60;
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterAll(async () => {
    if (m) m.env.PUNCH_PHOTO_STORAGE_PROVIDER = originalPunchPhotoProvider;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  const report: Record<string, Phases> = {};

  it("IN → OUT: jornada, horas, tramos, especiales, auditoría, alertas, notificaciones y desgloses", async () => {
    const entry = await punch(ids.golden!, "IN");
    expect(entry.status).toBe(201);
    report.IN = entry.phases;
    const workShiftId = entry.data.workShift.id as string;
    const afterIn = await functionalSnapshot(workShiftId);
    expect(afterIn).toMatchSnapshot("after IN");

    await ageOpenShift(ids.golden!, 90);
    const exit = await punch(ids.golden!, "OUT");
    expect(exit.status).toBe(201);
    report.OUT = exit.phases;
    expect(exit.data.workShift).toMatchObject({ id: workShiftId, totalMinutes: 90, totalHours: 1.5 });
    expect(await functionalSnapshot(workShiftId)).toMatchSnapshot("after OUT");
  });

  it("rollover: jornada vencida + IN → olvido de salida, jornada nueva, aviso y evaluación de entrada", async () => {
    const normal = (await holder.hourConcept.findFirstOrThrow({ where: { code: "HC-NORMAL" } }))!;
    await m.repository.createOpenWorkShift({ employeeId: ids.rollover!, hourConceptId: normal.id, hourConceptName: normal.name, source: "KIOSK", startAt: new Date(), punchEvidence: { deviceId: device.id, faceDetected: true, faceValidationStatus: "VALID" } });
    const oldShiftId = await ageOpenShift(ids.rollover!, 21 * 60);
    const entry = await punch(ids.rollover!, "IN");
    expect(entry.status).toBe(201);
    report.ROLLOVER = entry.phases;
    expect(entry.data.previousOpenShift).toMatchObject({ id: oldShiftId, status: "FALTA_SALIDA" });
    expect({ previous: await functionalSnapshot(oldShiftId), next: await functionalSnapshot(entry.data.workShift.id) }).toMatchSnapshot("rollover");
  });

  it("presupuesto de sentencias SQL por fase (techos; ver F12_PERF_5.md)", () => {
    console.info("PERF5_QUERY_BUDGET", JSON.stringify(report));
    for (const [kind, budget] of Object.entries(BUDGET)) {
      const actual = report[kind];
      expect(actual, kind).toBeDefined();
      expect(actual!.pre, `${kind} pre`).toBeLessThanOrEqual(budget.pre);
      expect(actual!.tx, `${kind} tx`).toBeLessThanOrEqual(budget.tx);
      expect(actual!.post, `${kind} post`).toBeLessThanOrEqual(budget.post);
    }
  });
});
