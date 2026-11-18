/**
 * Destinatarios de notificaciones operativas del legajo (RRHH + responsables
 * directos + supervisores Nivel 2 heredados) contra PostgreSQL REAL: el
 * resolver con sus filtros reales (estado de usuarios, vigencia de
 * TIME_RESPONSIBLE, roles cambiados) y los productores reales escribiendo
 * SystemNotification dentro de una transacción, como el post-proceso durable.
 *
 * Opt-in: sólo corre con `NOTIFICATION_RECIPIENTS_IT_DATABASE_URL` →
 * `localhost`, base `clock_it*` PROPIA con el schema de este commit
 * (migraciones aplicadas, nunca `db push`). VACÍA la base al empezar. Nunca usa
 * el DATABASE_URL del .env y verifica `current_database()`.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NOTIFICATION_RECIPIENTS_IT_DATABASE_URL;

type Modules = {
  prisma: typeof import("../../shared/prisma/client").prisma;
  recipients: typeof import("./employeeNotificationRecipients");
  runner: typeof import("../shifts/workShiftEvaluationRunner");
  dayOff: typeof import("../employee-day-offs/employeeDayOffActivity");
  timeEntries: typeof import("../time-entries/timeEntries.service");
  inactivity: typeof import("../time-entries/attendanceInactivity.service");
  workforce: typeof import("./workforce.service").workforceService;
  datetime: typeof import("../../shared/datetime/argentinaTime");
};

const TODAY = "2026-11-17";
const N1 = "NIVEL_1_RRHH";
const N2 = "NIVEL_2_SUPERVISION";
const N3 = "NIVEL_3_CARGA_HORARIA";

describe.skipIf(!url)("Destinatarios de notificaciones del legajo contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  const user: Record<string, string> = {};
  const employee: Record<string, string> = {};
  let shiftCounter = 0;

  async function createUser(key: string, role: string, status: "ACTIVO" | "INACTIVO" = "ACTIVO") {
    const created = await holder.user.create({ data: { name: key, email: `${key}@example.com`, passwordHash: "x", role: role as never, status } });
    user[key] = created.id;
  }

  const assign = (employeeKey: string, userKey: string, data: Record<string, unknown> = {}) =>
    holder.employeeAssignment.create({ data: { employeeId: employee[employeeKey]!, userId: user[userKey]!, type: "TIME_RESPONSIBLE", status: "ACTIVO", ...data } });

  const supervise = (supervisor: string, supervised: string) =>
    holder.userSupervisionAssignment.create({ data: { supervisorUserId: user[supervisor]!, supervisedUserId: user[supervised]! } });

  const names = (ids: string[]) => ids.map((id) => Object.keys(user).find((key) => user[key] === id) ?? id).sort();
  const resolve = async (employeeKey: string, dateKey = TODAY) => names(await m.recipients.resolveEmployeeNotificationRecipients(employee[employeeKey]!, dateKey));

  /** Filas de SystemNotification de una entidad: destinatarios (por nombre) y cuenta total. */
  async function notices(entityId: string) {
    const rows = await holder.systemNotification.findMany({ where: { entityId }, select: { recipientUserId: true, type: true } });
    return { recipients: names(rows.map((row) => row.recipientUserId)), count: rows.length, types: Array.from(new Set(rows.map((row) => row.type))) };
  }

  async function clockShift(employeeKey: string, startAt: Date) {
    shiftCounter += 1;
    return holder.workShift.create({ data: { employeeId: employee[employeeKey]!, source: "KIOSK", status: "PROCESADO", startAt, endAt: new Date(startAt.getTime() + 60 * 60_000), totalMinutes: 60 } });
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("NOTIFICATION_RECIPIENTS_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ prisma }, recipients, runner, dayOff, timeEntries, inactivity, { workforceService }, datetime] = await Promise.all([
      import("../../shared/prisma/client"),
      import("./employeeNotificationRecipients"),
      import("../shifts/workShiftEvaluationRunner"),
      import("../employee-day-offs/employeeDayOffActivity"),
      import("../time-entries/timeEntries.service"),
      import("../time-entries/attendanceInactivity.service"),
      import("./workforce.service"),
      import("../../shared/datetime/argentinaTime"),
    ]);
    m = { prisma, recipients, runner, dayOff, timeEntries, inactivity, workforce: workforceService, datetime };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    await createUser("rrhh", N1);
    await createUser("rrhhInactivo", N1, "INACTIVO");
    await createUser("joaquin", N3);
    await createUser("maria", N3);
    await createUser("eugenia", N2);
    await createUser("n2Inactiva", N2, "INACTIVO");
    await createUser("n2Ajena", N2);
    await createUser("n3Ajeno", N3);
    await createUser("n3Inactivo", N3, "INACTIVO");
    await createUser("exN3", N2); // tenía una supervisión como Nivel 3 y cambió de rol
    await createUser("exN2", N3); // supervisaba como Nivel 2 y cambió de rol
    await createUser("n3Vencido", N3);
    await createUser("n3Futuro", N3);
    await createUser("n3Vigente", N3);

    for (const [index, legajo] of ["OFICINA", "AJENO", "INACT", "EXN3", "EXN2", "VIGENCIA", "DOBLE", "DOS_N3", "FECHA", "REVOCA"].entries()) {
      const created = await holder.employee.create({ data: { legajo, cuil: `20-9${index}`, dni: `9${index}`, firstName: "Prueba", lastName: legajo } });
      employee[legajo] = created.id;
    }

    // Caso real: 01 Oficina → Joaquín (N3) ← Eugenia (N2). Más una N2 inactiva que también lo supervisa.
    await assign("OFICINA", "joaquin");
    await supervise("eugenia", "joaquin");
    await supervise("n2Inactiva", "joaquin");
    // N2 no relacionada: supervisa a otro N3, responsable de otro legajo.
    await assign("AJENO", "n3Ajeno");
    await supervise("n2Ajena", "n3Ajeno");
    // Responsable N3 inactivo: ni recibe ni genera herencia.
    await assign("INACT", "n3Inactivo");
    await supervise("eugenia", "n3Inactivo");
    // Relación desfasada (rol cambiado de cualquiera de los dos lados).
    await assign("EXN3", "exN3");
    await holder.userSupervisionAssignment.create({ data: { supervisorUserId: user.eugenia!, supervisedUserId: user.exN3! } });
    await assign("EXN2", "maria", { effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
    await holder.userSupervisionAssignment.create({ data: { supervisorUserId: user.exN2!, supervisedUserId: user.maria! } });
    // Vigencia de TIME_RESPONSIBLE (extremos inclusivos, @db.Date).
    await assign("VIGENCIA", "n3Vencido", { effectiveTo: new Date("2026-11-16T00:00:00.000Z") });
    await assign("VIGENCIA", "n3Futuro", { effectiveFrom: new Date("2026-11-18T00:00:00.000Z") });
    await assign("VIGENCIA", "n3Vigente", { effectiveFrom: new Date(`${TODAY}T00:00:00.000Z`), effectiveTo: new Date(`${TODAY}T00:00:00.000Z`) });
    await supervise("eugenia", "n3Vencido");
    // Eugenia directa + heredada (vía Joaquín) del mismo legajo.
    await assign("DOBLE", "eugenia");
    await assign("DOBLE", "joaquin");
    // Eugenia supervisa a dos N3 responsables del mismo legajo (María vía exN2 no cuenta: exN2 ya no es N2).
    await supervise("eugenia", "maria");
    await assign("DOS_N3", "joaquin");
    await assign("DOS_N3", "maria");
    // Fecha de referencia: Joaquín fue responsable hasta el 31/10.
    await assign("FECHA", "joaquin", { effectiveTo: new Date("2026-10-31T00:00:00.000Z") });
    // Legajo para la revocación (no comparte asignaciones con el resto).
    await assign("REVOCA", "joaquin");
  }, 60_000);

  afterAll(async () => {
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  describe("resolver contra PostgreSQL", () => {
    it("caso real 01 Oficina: RRHH activo + Joaquín + Eugenia; nunca RRHH inactivo ni N2 inactiva ni N2 ajena (1, 2, 3, 5, 6, 7)", async () => {
      expect(await resolve("OFICINA")).toEqual(["eugenia", "joaquin", "rrhh"]);
      expect(await resolve("AJENO")).toEqual(["n2Ajena", "n3Ajeno", "rrhh"]);
    });

    it("responsable N3 inactivo: no recibe y no genera herencia (8)", async () => {
      expect(await resolve("INACT")).toEqual(["rrhh"]);
    });

    it("relación existente pero el supervisado ya no es N3: recibe como directo, sin herencia (4, 9)", async () => {
      expect(await resolve("EXN3")).toEqual(["exN3", "rrhh"]);
    });

    it("relación existente pero el supervisor ya no es N2: no hereda (10)", async () => {
      // María también la supervisa Eugenia (N2): ella sí hereda; exN2 no.
      expect(await resolve("EXN2")).toEqual(["eugenia", "maria", "rrhh"]);
    });

    it("vigencia: vencida o futura no recibe ni hereda; vigente con extremos inclusivos sí (11, 12, 13); null/null ya cubierto por OFICINA (14)", async () => {
      expect(await resolve("VIGENCIA")).toEqual(["n3Vigente", "rrhh"]);
      expect(await resolve("VIGENCIA", "2026-11-16")).toEqual(["eugenia", "n3Vencido", "rrhh"]);
      expect(await resolve("VIGENCIA", "2026-11-18")).toEqual(["n3Futuro", "rrhh"]);
    });

    it("N2 directa y heredada, o que supervisa a dos responsables del mismo legajo: un solo userId (15, 16)", async () => {
      const doble = await m.recipients.resolveEmployeeNotificationRecipients(employee.DOBLE!, TODAY);
      expect(names(doble)).toEqual(["eugenia", "joaquin", "rrhh"]);
      const dos = await m.recipients.resolveEmployeeNotificationRecipients(employee.DOS_N3!, TODAY);
      expect(names(dos)).toEqual(["eugenia", "joaquin", "maria", "rrhh"]);
    });

    it("batch: un Map por legajo, igual al resultado individual", async () => {
      const keys = ["OFICINA", "INACT", "DOBLE"];
      const map = await m.recipients.resolveEmployeeNotificationRecipientsBatch(keys.map((key) => employee[key]!), TODAY);
      for (const key of keys) expect(names(map.get(employee[key]!)!)).toEqual(await resolve(key));
    });
  });

  describe("productores reales → SystemNotification", () => {
    it("ALERTA_FICHADA (alerta de turno, en la tx del post-proceso): RRHH + Joaquín + Eugenia, sin duplicados; Eugenia la ve en su listado", async () => {
      const shift = await clockShift("OFICINA", new Date("2026-11-17T11:20:00.000Z"));
      const alert = await m.prisma.$transaction((tx) => m.runner.createShiftAlert({ employeeId: employee.OFICINA!, workShiftId: shift.id, type: "INGRESO_TARDE", actualAt: shift.startAt, differenceMinutes: 20, db: tx }));

      expect(await notices(alert.id)).toEqual({ recipients: ["eugenia", "joaquin", "rrhh"], count: 3, types: ["ALERTA_FICHADA"] });

      // Frontend: la pantalla Notificaciones lista por recipientUserId = usuario autenticado.
      const listed = await m.workforce.notifications({ page: 1, take: 50 } as never, { id: user.eugenia!, role: N2 } as Express.AuthUser);
      expect(listed.items.some((item) => item.entityId === alert.id)).toBe(true);
    });

    it("ACTIVIDAD_EN_FRANCO: hereda Nivel 2 y un reintento del paso no duplica", async () => {
      const shift = await clockShift("OFICINA", new Date("2026-11-15T12:00:00.000Z"));
      const run = () => m.prisma.$transaction((tx) => m.dayOff.ensureDayOffActivityAlert(tx, { id: shift.id, employeeId: shift.employeeId, startAt: shift.startAt }));
      expect(await run()).toBe(true);
      const alert = await holder.shiftAlert.findFirstOrThrow({ where: { workShiftId: shift.id, type: "ACTIVIDAD_EN_FRANCO" } });
      expect(await notices(alert.id)).toEqual({ recipients: ["eugenia", "joaquin", "rrhh"], count: 3, types: ["ALERTA_FICHADA"] });

      expect(await run()).toBe(false);
      expect((await notices(alert.id)).count).toBe(3);
    });

    it("FALTA_SALIDA (post-proceso del rollover, en su tx): RRHH + Joaquín + Eugenia", async () => {
      const shift = await clockShift("OFICINA", new Date("2026-11-14T11:00:00.000Z"));
      await m.prisma.$transaction((tx) => m.timeEntries.notifyMissingExit(employee.OFICINA!, shift.id, shift.startAt, { db: tx, rethrow: true }));
      expect(await notices(shift.id)).toEqual({ recipients: ["eugenia", "joaquin", "rrhh"], count: 3, types: ["FALTA_SALIDA"] });
    });

    it("FALTA_INGRESO y SIN_ACTIVIDAD_REGISTRADA: RRHH + Joaquín + Eugenia; Eugenia directa+heredada en DOBLE una sola vez; reintento no duplica (notifiedAt)", async () => {
      const candidates = (keys: string[]) => keys.map((key) => ({ id: employee[key]!, legajo: key, firstName: "Prueba", lastName: key }));
      const persist = (dateKey: string, type: "FALTA_INGRESO" | "SIN_ACTIVIDAD_REGISTRADA", keys: string[]) =>
        m.inactivity.persistAndNotifyInactivityIncidents(m.datetime.argentinaCalendarDate(dateKey), dateKey, type, type, candidates(keys), () => "obs", () => "msg");

      const first = await persist("2026-11-13", "FALTA_INGRESO", ["OFICINA", "DOBLE"]);
      expect(first).toEqual({ detected: 2, notified: 6 });
      const incidents = await holder.attendanceInactivityIncident.findMany({ where: { operationalDate: m.datetime.argentinaCalendarDate("2026-11-13") } });
      const incidentOf = (key: string) => incidents.find((incident) => incident.employeeId === employee[key])!.id;
      expect(await notices(incidentOf("OFICINA"))).toEqual({ recipients: ["eugenia", "joaquin", "rrhh"], count: 3, types: ["FALTA_INGRESO"] });
      expect(await notices(incidentOf("DOBLE"))).toEqual({ recipients: ["eugenia", "joaquin", "rrhh"], count: 3, types: ["FALTA_INGRESO"] });

      expect(await persist("2026-11-13", "SIN_ACTIVIDAD_REGISTRADA", ["OFICINA", "DOBLE"])).toEqual({ detected: 2, notified: 0 });
      expect((await notices(incidentOf("OFICINA"))).count).toBe(3);

      await persist("2026-11-12", "SIN_ACTIVIDAD_REGISTRADA", ["OFICINA"]);
      const sinActividad = await holder.attendanceInactivityIncident.findFirstOrThrow({ where: { employeeId: employee.OFICINA!, operationalDate: m.datetime.argentinaCalendarDate("2026-11-12") } });
      expect(await notices(sinActividad.id)).toEqual({ recipients: ["eugenia", "joaquin", "rrhh"], count: 3, types: ["SIN_ACTIVIDAD_REGISTRADA"] });
    });

    it("fecha de referencia = fecha del hecho: un evento del 31/10 llega a Joaquín y Eugenia aunque la asignación ya venció; uno del 01/11 no", async () => {
      const before = await clockShift("FECHA", new Date("2026-10-31T12:00:00.000Z"));
      const after = await clockShift("FECHA", new Date("2026-11-01T12:00:00.000Z"));
      await m.prisma.$transaction((tx) => m.timeEntries.notifyMissingExit(employee.FECHA!, before.id, before.startAt, { db: tx, rethrow: true }));
      await m.prisma.$transaction((tx) => m.timeEntries.notifyMissingExit(employee.FECHA!, after.id, after.startAt, { db: tx, rethrow: true }));
      expect((await notices(before.id)).recipients).toEqual(["eugenia", "joaquin", "rrhh"]);
      expect((await notices(after.id)).recipients).toEqual(["rrhh"]);
    });

    it("revocación: sin Eugenia → Joaquín el evento nuevo no le llega; sin Joaquín → el legajo sólo RRHH; las notificaciones anteriores no cambian", async () => {
      const notify = async (startAt: Date) => {
        const shift = await clockShift("REVOCA", startAt);
        const alert = await m.prisma.$transaction((tx) => m.runner.createShiftAlert({ employeeId: employee.REVOCA!, workShiftId: shift.id, type: "INGRESO_TARDE", actualAt: startAt, db: tx }));
        return alert.id;
      };
      const original = await notify(new Date("2026-11-17T11:30:00.000Z"));
      expect((await notices(original)).recipients).toEqual(["eugenia", "joaquin", "rrhh"]);
      const eugeniaRowsBefore = await holder.systemNotification.count({ where: { recipientUserId: user.eugenia! } });

      await holder.userSupervisionAssignment.delete({ where: { supervisorUserId_supervisedUserId: { supervisorUserId: user.eugenia!, supervisedUserId: user.joaquin! } } });
      const afterSupervision = await notify(new Date("2026-11-17T12:30:00.000Z"));
      expect((await notices(afterSupervision)).recipients).toEqual(["joaquin", "rrhh"]);

      await holder.employeeAssignment.updateMany({ where: { employeeId: employee.REVOCA!, userId: user.joaquin! }, data: { status: "INACTIVO" } });
      const afterAssignment = await notify(new Date("2026-11-17T13:30:00.000Z"));
      expect((await notices(afterAssignment)).recipients).toEqual(["rrhh"]);

      // Sin backfill ni borrado: lo ya notificado queda igual.
      expect((await notices(original)).recipients).toEqual(["eugenia", "joaquin", "rrhh"]);
      expect(await holder.systemNotification.count({ where: { recipientUserId: user.eugenia! } })).toBe(eugeniaRowsBefore);
    });
  });
});
