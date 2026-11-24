/**
 * R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9) contra PostgreSQL REAL: la API de
 * administración de rotaciones por HTTP (createApp + JWT de RRHH), con la grilla REAL de Planta
 * (plantaRotation.fixture.ts), el resolver de obligaciones real y los constraints reales
 * (EXCLUDE, únicos, RESTRICT). El reloj del proceso (`Date`) se fija para ubicar "hoy".
 *
 * Opt-in: sólo corre con `ROTATION_ADMIN_IT_DATABASE_URL` → `localhost`, base `clock_it*` PROPIA con
 * el schema de este commit. VACÍA la base antes de cada caso. Nunca usa el DATABASE_URL del .env y
 * verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANTA_ANCHOR, PLANTA_CREWS, PLANTA_EMPLOYEES, PLANTA_TEMPLATES, plantaDays } from "./plantaRotation.fixture";

const url = process.env.ROTATION_ADMIN_IT_DATABASE_URL;

const at = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00-03:00`);
const day = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

// Semana A: lunes 02/11/2026; Semana B: lunes 09/11/2026.
const FRI_PREV = "2026-10-30";
const MON_A = "2026-11-02";
const WED_A = "2026-11-04";
const THU_A = "2026-11-05";
const FRI_A = "2026-11-06";
const SAT_A = "2026-11-07";
const MON_B = "2026-11-09";
const MON_A2 = "2026-11-16";

type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  obligations: typeof import("./rotationObligation.service");
  errors: typeof import("./shiftRotationErrors");
};
type Api = { status: number; data: any; error: { code: string; message: string; details?: any } | undefined };

describe.skipIf(!url)("R4.6 — administración de rotaciones contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let rrhh: { id: string; email: string; role: string };
  let supervision: { id: string; email: string; role: string };
  let groupId = "";
  let otherGroupId = "";
  const employee: Record<string, string> = {};
  const templateId: Record<string, string> = {};

  async function call(method: string, path: string, body?: unknown, user = rrhh): Promise<Api> {
    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, m.env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await response.json()) as { data?: unknown; error?: Api["error"] };
    return { status: response.status, data: json.data, error: json.error };
  }
  const today = (dateKey: string, time = "09:00") => vi.setSystemTime(at(dateKey, time));

  /** Grilla de Planta en el formato de la API, con los ids reales de equipos y plantillas. */
  function plantaGrid(crewIds: Record<string, string>) {
    return plantaDays().map((fixture) => ({
      crewId: crewIds[fixture.crewId]!,
      cycleWeekIndex: fixture.cycleWeekIndex,
      weekday: fixture.weekday,
      kind: fixture.kind,
      blocks: fixture.blocks.map((block) => ({ blockIndex: block.blockIndex, shiftTemplateId: templateId[block.template.id]! })),
    }));
  }

  /** Planta completa por la API: rotación INACTIVA → 5 equipos → versión → altas desde `from`. */
  async function setupPlanta(from = MON_A, options: { activate?: boolean } = {}) {
    const created = await call("POST", "/shifts/rotations", { code: "planta", name: "Planta Mañana/Tarde", shiftGroupId: groupId });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ code: "PLANTA", status: "INACTIVO", health: "OK" });
    const rotationId = created.data.id as string;
    const crewIds: Record<string, string> = {};
    for (const [index, [key, fixtureId]] of Object.entries(PLANTA_CREWS).entries()) {
      const crew = await call("POST", `/shifts/rotations/${rotationId}/crews`, { code: key.replace("_", "-"), name: key.replace("_", " + "), sortOrder: index });
      expect(crew.status).toBe(201);
      crewIds[fixtureId] = crew.data.id;
    }
    const version = await call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: PLANTA_ANCHOR, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: plantaGrid(crewIds) });
    expect(version.status, JSON.stringify(version.error)).toBe(201);
    const members: Array<[string, string]> = [
      [PLANTA_EMPLOYEES.ROBERTO, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.ARIEL, PLANTA_CREWS.ROBERTO_ARIEL],
      [PLANTA_EMPLOYEES.CARLOS, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.WALTER, PLANTA_CREWS.CARLOS_WALTER],
      [PLANTA_EMPLOYEES.JUANCHI, PLANTA_CREWS.JUANCHI],
      [PLANTA_EMPLOYEES.JOSE, PLANTA_CREWS.JOSE],
      [PLANTA_EMPLOYEES.JOHANNA, PLANTA_CREWS.JOHANNA],
    ];
    for (const [person, crew] of members) {
      const added = await call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[crew]}/members`, { employeeIds: [employee[person]], effectiveFrom: from });
      expect(added.status, JSON.stringify(added.error)).toBe(201);
    }
    if (options.activate !== false) {
      const activated = await call("POST", `/shifts/rotations/${rotationId}/activate`);
      expect(activated.status, JSON.stringify(activated.error)).toBe(200);
    }
    return { rotationId, crewIds, versionId: version.data.id as string };
  }

  /** Bloques efectivos (obligación real R4.3b) de una persona en una fecha: "HH:MM-HH:MM". */
  async function blocksOf(person: string, dateKey: string) {
    const result = await m.obligations.resolveRotationObligations({ dateKeys: [dateKey], employeeIds: [employee[person]!] });
    const obligation = result.get(employee[person]!)?.get(dateKey);
    if (!obligation) return null;
    return obligation.blocks.map((block) => `${block.template.startTime}-${block.template.endTime}`);
  }

  const hashRows = async (sql: string) => createHash("sha256").update(JSON.stringify(await holder.$queryRawUnsafe(sql))).digest("hex");

  async function seed() {
    const tables = await m.prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await m.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);
    await holder.hourConcept.create({ data: { code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", systemRole: "NORMAL_BASE" } });
    const rrhhRow = await holder.user.create({ data: { name: "RRHH IT", email: "rrhh-r46@example.com", passwordHash: "x", role: "NIVEL_1_RRHH" } });
    const supRow = await holder.user.create({ data: { name: "Supervisión IT", email: "sup-r46@example.com", passwordHash: "x", role: "NIVEL_2_SUPERVISION" } });
    rrhh = { id: rrhhRow.id, email: rrhhRow.email, role: rrhhRow.role };
    supervision = { id: supRow.id, email: supRow.email, role: supRow.role };
    groupId = (await holder.shiftGroup.create({ data: { code: "PLANTA", name: "Planta" } })).id;
    otherGroupId = (await holder.shiftGroup.create({ data: { code: "OFICINA", name: "Oficina" } })).id;
    for (const [index, key] of Object.values(PLANTA_EMPLOYEES).entries()) {
      employee[key] = (await holder.employee.create({ data: { legajo: `R46-${index + 1}`, cuil: `20-8${index + 1}`, dni: `8${index + 1}`, firstName: "Prueba", lastName: key.replace("emp-", "") } })).id;
    }
    for (const template of Object.values(PLANTA_TEMPLATES)) {
      templateId[template.id] = (await holder.shiftTemplate.create({
        data: { code: template.code, name: template.code, startTime: template.startTime, endTime: template.endTime, crossesMidnight: template.crossesMidnight, shiftGroupId: groupId, entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20 },
      })).id;
    }
    templateId.OFICINA = (await holder.shiftTemplate.create({ data: { code: "OF-08-16", name: "Oficina", startTime: "08:00", endTime: "16:00", shiftGroupId: otherGroupId } })).id;
    // Juanjo: turno fijo L–V 07–15 (fuera de la rotación).
    await holder.shiftAssignment.create({ data: { employeeId: employee[PLANTA_EMPLOYEES.JUANJO]!, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]!, effectiveFrom: day("2026-10-01"), weekdays: [1, 2, 3, 4, 5] } });
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("ROTATION_ADMIN_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, obligations, errors] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("./rotationObligation.service"),
      import("./shiftRotationErrors"),
    ]);
    m = { env, prisma, obligations, errors };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
    vi.useFakeTimers({ toFake: ["Date"] });
  }, 60_000);

  beforeEach(async () => {
    today(FRI_PREV);
    await seed();
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  // ── Preparación, activación y fechas (punto 2) ──────────────────────────────

  it("Planta se prepara INACTIVA, recibe membresías futuras, se activa antes del inicio y rige desde el primer día (la tabla de §25)", async () => {
    const { rotationId } = await setupPlanta(MON_A, { activate: false });
    // Inactiva: nada resuelve todavía (rige el legacy para todos).
    expect(await blocksOf(PLANTA_EMPLOYEES.JOSE, FRI_A)).toBeNull();
    const detail = await call("GET", `/shifts/rotations/${rotationId}`, undefined, supervision);
    expect(detail.status).toBe(200);
    expect(detail.data).toMatchObject({ status: "INACTIVO", hasRuled: false, health: "OK" });
    expect(detail.data.members).toHaveLength(7);

    expect((await call("POST", `/shifts/rotations/${rotationId}/activate`)).status).toBe(200);
    // Hoy (viernes 30/10) y el fin de semana siguen en el legacy; el lunes 02/11 rige la rotación.
    expect(await blocksOf(PLANTA_EMPLOYEES.ROBERTO, "2026-10-31")).toBeNull();
    expect(await blocksOf(PLANTA_EMPLOYEES.ROBERTO, MON_A)).toEqual(["07:00-17:00"]);
    expect(await blocksOf(PLANTA_EMPLOYEES.CARLOS, MON_A)).toEqual(["17:00-03:00"]);
    expect(await blocksOf(PLANTA_EMPLOYEES.JOSE, FRI_A)).toEqual(["07:00-11:00", "19:00-07:00"]);
    expect(await blocksOf(PLANTA_EMPLOYEES.JUANCHI, MON_A)).toEqual([]);
    expect(await blocksOf(PLANTA_EMPLOYEES.ROBERTO, MON_B)).toEqual(["17:00-03:00"]);
    expect(await blocksOf(PLANTA_EMPLOYEES.JUANCHI, MON_B)).toEqual(["07:00-15:00"]);
    expect(await blocksOf(PLANTA_EMPLOYEES.ROBERTO, MON_A2)).toEqual(["07:00-17:00"]);
    // Juanjo sigue en el camino legacy (no es miembro).
    expect(await blocksOf(PLANTA_EMPLOYEES.JUANJO, MON_A)).toBeNull();
    const audit = await holder.auditLog.findMany({ where: { entity: "ShiftRotation", entityId: rotationId }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.action)).toEqual(["CREATE", "ACTIVATE"]);
    expect(audit[1]!.description).toContain("rige desde el 02/11/2026 para 7 persona(s)");
  });

  it("activar es rechazado si alguna membresía ya empezó (sin efecto retroactivo), con un mensaje claro", async () => {
    const { rotationId } = await setupPlanta(MON_A, { activate: false });
    today(MON_A);
    const response = await call("POST", `/shifts/rotations/${rotationId}/activate`);
    expect(response.status).toBe(409);
    expect(response.error?.code).toBe("ROTATION_ACTIVATION_RETROACTIVE");
    expect(response.error?.message).toContain("ya tendría efecto sobre fechas pasadas o de hoy");
    expect(response.error?.message).toContain("03/11/2026");
    expect((await holder.shiftRotation.findUniqueOrThrow({ where: { id: rotationId } })).status).toBe("INACTIVO");
    // En una rotación inactiva el alta nunca rigió: se cancela y se vuelve a dar desde mañana.
    const member = (await call("GET", `/shifts/rotations/${rotationId}/members`)).data[0];
    expect((await call("DELETE", `/shifts/rotations/${rotationId}/members/${member.id}`)).status).toBe(200);
  });

  it("validaciones de fecha: alta desde hoy rechazada; versión de una rotación ACTIVA desde hoy rechazada; versión que ya rigió bloqueada", async () => {
    const { rotationId, crewIds, versionId } = await setupPlanta();
    const crew = crewIds[PLANTA_CREWS.JOHANNA]!;
    const juanjo = employee[PLANTA_EMPLOYEES.JUANJO]!;
    const sameDay = await call("POST", `/shifts/rotations/${rotationId}/crews/${crew}/members`, { employeeIds: [juanjo], effectiveFrom: FRI_PREV });
    expect([sameDay.status, sameDay.error?.code]).toEqual([422, "ROTATION_DATE_TOO_EARLY"]);
    today(WED_A);
    const version = await call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: WED_A, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: plantaGrid(crewIds) });
    expect([version.status, version.error?.code]).toEqual([422, "ROTATION_DATE_TOO_EARLY"]);
    const locked = await call("PATCH", `/shifts/rotations/${rotationId}/versions/${versionId}`, { effectiveFrom: PLANTA_ANCHOR, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: plantaGrid(crewIds) });
    expect([locked.status, locked.error?.code]).toEqual([409, "ROTATION_VERSION_LOCKED"]);
    const deactivate = await call("POST", `/shifts/rotations/${rotationId}/deactivate`);
    expect([deactivate.status, deactivate.error?.code]).toEqual([409, "ROTATION_HAS_RULED"]);
  });

  it("la grilla incompleta, con turnos de otro grupo o con un equipo sin grilla nunca se guarda", async () => {
    const { rotationId, crewIds } = await setupPlanta(MON_A, { activate: false });
    const incomplete = plantaGrid(crewIds).filter((row) => !(row.crewId === crewIds[PLANTA_CREWS.JOSE] && row.cycleWeekIndex === 1 && row.weekday === 3));
    const missing = await call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: MON_A2, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: incomplete });
    expect([missing.status, missing.error?.code]).toEqual([422, "ROTATION_GRID_INVALID"]);
    expect(missing.error?.details.issues.map((issue: { code: string }) => issue.code)).toContain("DAY_MISSING");
    const foreign = plantaGrid(crewIds).map((row, index) => (index === 0 && row.kind === "SHIFT" ? { ...row, blocks: [{ blockIndex: 0, shiftTemplateId: templateId.OFICINA }] } : row));
    const other = await call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: MON_A2, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: foreign });
    expect([other.status, other.error?.code]).toEqual([422, "ROTATION_TEMPLATE_OTHER_GROUP"]);
    // Equipo nuevo sin grilla en la versión: el alta deja una configuración incompleta → rechazada.
    const crew = await call("POST", `/shifts/rotations/${rotationId}/crews`, { code: "EXTRA", name: "Equipo extra" });
    const added = await call("POST", `/shifts/rotations/${rotationId}/crews/${crew.data.id}/members`, { employeeIds: [employee[PLANTA_EMPLOYEES.JUANJO]], effectiveFrom: MON_A, closeFixedAssignments: true });
    expect([added.status, added.error?.code]).toEqual([409, "ROTATION_CONFIGURATION_CONFLICT"]);
    expect(added.error?.details.issues.map((issue: { code: string }) => issue.code)).toContain("CREW_WITHOUT_GRID");
    expect(await holder.shiftRotationCrewMember.count({ where: { crewId: crew.data.id } })).toBe(0);
  });

  // ── Membresías: Opción C, SIN_TURNO, superposición y concurrencia ───────────

  it("Opción C: turno fijo superpuesto → 409; con closeFixedAssignments se cierra en X−1 en la misma transacción", async () => {
    const { rotationId, crewIds } = await setupPlanta();
    const juanjo = employee[PLANTA_EMPLOYEES.JUANJO]!;
    const crew = crewIds[PLANTA_CREWS.JOHANNA]!;
    const blocked = await call("POST", `/shifts/rotations/${rotationId}/crews/${crew}/members`, { employeeIds: [juanjo], effectiveFrom: MON_B });
    expect([blocked.status, blocked.error?.code]).toEqual([409, "ROTATION_FIXED_ASSIGNMENT_OVERLAP"]);
    const closed = await call("POST", `/shifts/rotations/${rotationId}/crews/${crew}/members`, { employeeIds: [juanjo], effectiveFrom: MON_B, closeFixedAssignments: true });
    expect(closed.status, JSON.stringify(closed.error)).toBe(201);
    const assignment = await holder.shiftAssignment.findFirstOrThrow({ where: { employeeId: juanjo } });
    expect(assignment.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-11-08");
    expect(await blocksOf(PLANTA_EMPLOYEES.JUANJO, "2026-11-06")).toBeNull();
    expect(await blocksOf(PLANTA_EMPLOYEES.JUANJO, MON_B)).toEqual(["07:00-15:00"]);
  });

  it("SIN_TURNO y otra membresía superpuesta bloquean el alta; dos altas simultáneas de la misma persona: una sola gana", async () => {
    const { rotationId, crewIds } = await setupPlanta();
    const juanjo = employee[PLANTA_EMPLOYEES.JUANJO]!;
    await holder.shiftAssignment.updateMany({ where: { employeeId: juanjo }, data: { effectiveTo: day(FRI_PREV) } });
    const regime = await holder.workRegime.create({ data: { code: "SIN-TURNO", name: "Sin turno", kind: "SIN_TURNO" } });
    const sinTurno = await holder.employeeWorkRegime.create({ data: { employeeId: juanjo, workRegimeId: regime.id, effectiveFrom: day("2026-12-01") } });
    const blocked = await call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[PLANTA_CREWS.JOHANNA]}/members`, { employeeIds: [juanjo], effectiveFrom: MON_B });
    expect([blocked.status, blocked.error?.code]).toEqual([409, "ROTATION_SIN_TURNO_OVERLAP"]);
    await holder.employeeWorkRegime.delete({ where: { id: sinTurno.id } });
    const overlap = await call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[PLANTA_CREWS.JOHANNA]}/members`, { employeeIds: [employee[PLANTA_EMPLOYEES.JOSE]], effectiveFrom: MON_B });
    expect([overlap.status, overlap.error?.code]).toEqual([409, "ROTATION_MEMBERSHIP_OVERLAP"]);

    const [a, b] = await Promise.all([
      call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[PLANTA_CREWS.JOHANNA]}/members`, { employeeIds: [juanjo], effectiveFrom: MON_B }),
      call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[PLANTA_CREWS.JOSE]}/members`, { employeeIds: [juanjo], effectiveFrom: MON_B }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await holder.shiftRotationCrewMember.count({ where: { employeeId: juanjo } })).toBe(1);
  });

  it("los constraints reales se traducen a errores de dominio (23P01 EXCLUDE, 23001 RESTRICT)", async () => {
    const { crewIds } = await setupPlanta();
    try {
      await m.prisma.shiftRotationCrewMember.create({ data: { crewId: crewIds[PLANTA_CREWS.JOHANNA]!, employeeId: employee[PLANTA_EMPLOYEES.JOHANNA]!, effectiveFrom: day(MON_B) } });
      expect.unreachable();
    } catch (error) {
      expect(m.errors.rotationPersistenceError(error)?.code).toBe("ROTATION_MEMBERSHIP_OVERLAP");
    }
    try {
      await m.prisma.shiftTemplate.delete({ where: { id: templateId[PLANTA_TEMPLATES.T1907.id]! } });
      expect.unreachable();
    } catch (error) {
      expect(m.errors.rotationPersistenceError(error)?.code).toBe("ROTATION_REFERENCE_CONFLICT");
    }
  });

  // ── Versiones: el pasado no cambia ──────────────────────────────────────────

  it("versión nueva desde X: antes de X todo queda idéntico; desde X rige la nueva; dos versiones simultáneas: una sola gana", async () => {
    const { rotationId, crewIds, versionId } = await setupPlanta();
    today(THU_A);
    const beforeOld = await blocksOf(PLANTA_EMPLOYEES.ROBERTO, MON_B);
    const oldVersionSql = `SELECT v.id, v."effectiveFrom", v."cycleLengthWeeks", v."anchorWeekStart", d."crewId", d."cycleWeekIndex", d.weekday, d.kind, b."blockIndex", b."shiftTemplateId" FROM "ShiftRotationVersion" v JOIN "ShiftRotationDay" d ON d."versionId" = v.id LEFT JOIN "ShiftRotationBlock" b ON b."dayId" = d.id WHERE v.id = '${versionId}' ORDER BY d."crewId", d."cycleWeekIndex", d.weekday, b."blockIndex"`;
    const historyHash = await hashRows(oldVersionSql);
    // Nueva grilla desde el lunes 16/11: Roberto + Ariel con 07–15 todos los días de la semana A.
    const grid = plantaGrid(crewIds).map((row) => (row.crewId === crewIds[PLANTA_CREWS.ROBERTO_ARIEL] && row.cycleWeekIndex === 0 ? { ...row, kind: "SHIFT" as const, blocks: [{ blockIndex: 0, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]! }] } : row));
    const [first, second] = await Promise.all([
      call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: MON_A2, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: grid }),
      call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: MON_A2, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: grid }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await blocksOf(PLANTA_EMPLOYEES.ROBERTO, MON_B)).toEqual(beforeOld);
    expect(await blocksOf(PLANTA_EMPLOYEES.ROBERTO, MON_A)).toEqual(["07:00-17:00"]);
    expect(await blocksOf(PLANTA_EMPLOYEES.ROBERTO, MON_A2)).toEqual(["07:00-15:00"]);
    const old = await holder.shiftRotationVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(old.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-11-15");
    // La versión que rigió conserva inicio, ciclo, ancla y grilla completa (sólo cambió su fin).
    expect(await hashRows(oldVersionSql)).toBe(historyHash);
  });

  // ── Garantía 2: finalización con bloques nocturnos ──────────────────────────

  it("finalizar con último día = viernes A de José conserva el bloque 19:00–07:00 y el sábado deja de regir", async () => {
    const { rotationId } = await setupPlanta();
    today(WED_A);
    const preview = await call("POST", `/shifts/rotations/${rotationId}/finalize/preview`, { lastDay: FRI_A });
    expect(preview.status, JSON.stringify(preview.error)).toBe(200);
    expect(preview.data.closeMembers).toHaveLength(7);
    expect(preview.data.transitionOverlaps).toEqual([]);
    const finalized = await call("POST", `/shifts/rotations/${rotationId}/finalize`, { lastDay: FRI_A, confirm: true, confirmationToken: preview.data.confirmationToken });
    expect(finalized.status, JSON.stringify(finalized.error)).toBe(200);
    expect(await blocksOf(PLANTA_EMPLOYEES.JOSE, FRI_A)).toEqual(["07:00-11:00", "19:00-07:00"]);
    expect(await blocksOf(PLANTA_EMPLOYEES.JOSE, SAT_A)).toBeNull();
    expect(finalized.data.rotation.finalized).toBe(false);
  });

  it("finalizar con un turno fijo desde el sábado 03:00 (superpuesto con el 19–07 del viernes) → 409; desde las 07:00 se toca y es válido", async () => {
    const { rotationId } = await setupPlanta();
    today(WED_A);
    const jose = employee[PLANTA_EMPLOYEES.JOSE]!;
    const fixed = await holder.shiftAssignment.create({ data: { employeeId: jose, shiftTemplateId: templateId[PLANTA_TEMPLATES.T0311.id]!, effectiveFrom: day(SAT_A) } });
    const preview = await call("POST", `/shifts/rotations/${rotationId}/finalize/preview`, { lastDay: FRI_A });
    expect(preview.data.transitionOverlaps).toHaveLength(1);
    expect(preview.data.transitionOverlaps[0].outgoing).toContain("19:00–07:00");
    const rejected = await call("POST", `/shifts/rotations/${rotationId}/finalize`, { lastDay: FRI_A, confirm: true, confirmationToken: preview.data.confirmationToken });
    expect([rejected.status, rejected.error?.code]).toEqual([409, "ROTATION_TRANSITION_OVERLAP"]);
    await holder.shiftAssignment.update({ where: { id: fixed.id }, data: { shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id]! } });
    const preview2 = await call("POST", `/shifts/rotations/${rotationId}/finalize/preview`, { lastDay: FRI_A });
    expect(preview2.data.transitionOverlaps).toEqual([]);
    expect(preview2.data.restsAtTransition.find((rest: { employeeId: string }) => rest.employeeId === jose)?.restMinutes).toBe(0);
  });

  // ── Garantía 3: confirmación y conservación del historial ───────────────────

  it("finalizar con versión y alta futuras: la vista previa las lista, un cambio concurrente invalida el token y con el token vigente se borran con snapshot en el AuditLog", async () => {
    const { rotationId, crewIds, versionId } = await setupPlanta();
    today(WED_A);
    const future = await call("POST", `/shifts/rotations/${rotationId}/versions`, { effectiveFrom: MON_A2, cycleLengthWeeks: 2, anchorWeekStart: PLANTA_ANCHOR, days: plantaGrid(crewIds) });
    expect(future.status).toBe(201);
    await holder.shiftAssignment.updateMany({ where: { employeeId: employee[PLANTA_EMPLOYEES.JUANJO]! }, data: { effectiveTo: day(FRI_A) } });
    const futureMember = await call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[PLANTA_CREWS.JOHANNA]}/members`, { employeeIds: [employee[PLANTA_EMPLOYEES.JUANJO]], effectiveFrom: MON_A2 });
    expect(futureMember.status, JSON.stringify(futureMember.error)).toBe(201);
    const pastHash = await hashRows(`SELECT id, "effectiveFrom" FROM "ShiftRotationVersion" WHERE id = '${versionId}'`);

    const preview = await call("POST", `/shifts/rotations/${rotationId}/finalize/preview`, { lastDay: FRI_A });
    expect(preview.data.deleteVersions.map((row: { effectiveFrom: string }) => row.effectiveFrom)).toEqual([MON_A2]);
    expect(preview.data.cancelMembers.map((row: { employeeId: string }) => row.employeeId)).toEqual([employee[PLANTA_EMPLOYEES.JUANJO]]);
    const missingConfirm = await call("POST", `/shifts/rotations/${rotationId}/finalize`, { lastDay: FRI_A, confirmationToken: preview.data.confirmationToken });
    expect(missingConfirm.status).toBe(400);

    // Cambio concurrente entre la vista previa y la confirmación: baja de Johanna.
    const johanna = (await call("GET", `/shifts/rotations/${rotationId}/members`)).data.find((row: { employeeId: string }) => row.employeeId === employee[PLANTA_EMPLOYEES.JOHANNA]);
    expect((await call("POST", `/shifts/rotations/${rotationId}/members/${johanna.id}/close`, { lastDay: THU_A })).status).toBe(200);
    const stale = await call("POST", `/shifts/rotations/${rotationId}/finalize`, { lastDay: FRI_A, confirm: true, confirmationToken: preview.data.confirmationToken });
    expect([stale.status, stale.error?.code]).toEqual([409, "ROTATION_FINALIZE_STALE"]);
    expect(await holder.shiftRotationVersion.count({ where: { rotationId } })).toBe(2);

    const fresh = await call("POST", `/shifts/rotations/${rotationId}/finalize/preview`, { lastDay: FRI_A });
    const done = await call("POST", `/shifts/rotations/${rotationId}/finalize`, { lastDay: FRI_A, confirm: true, confirmationToken: fresh.data.confirmationToken });
    expect(done.status, JSON.stringify(done.error)).toBe(200);
    expect(await holder.shiftRotationVersion.count({ where: { rotationId } })).toBe(1);
    expect(await hashRows(`SELECT id, "effectiveFrom" FROM "ShiftRotationVersion" WHERE id = '${versionId}'`)).toBe(pastHash);
    const deletedVersion = await holder.auditLog.findFirstOrThrow({ where: { entity: "ShiftRotationVersion", action: "DELETE" } });
    expect((deletedVersion.before as { days: unknown[] }).days).toHaveLength(plantaDays().length);
    expect(deletedVersion.description).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    const deletedMember = await holder.auditLog.findFirstOrThrow({ where: { entity: "ShiftRotationCrewMember", action: "DELETE" } });
    expect(deletedMember.before).toMatchObject({ employeeId: employee[PLANTA_EMPLOYEES.JUANJO], effectiveFrom: MON_A2 });
    // Las membresías que rigieron se cerraron (no se borraron).
    expect(await holder.shiftRotationCrewMember.count({ where: { crew: { rotationId } } })).toBe(7);
  });

  // ── Protecciones inversas y garantía 1 ────────────────────────────────────

  it("turnos fijos y SIN_TURNO no se pueden superponer; alta fija vs. membresía concurrente tiene un solo ganador", async () => {
    const { rotationId, crewIds } = await setupPlanta();
    const jose = employee[PLANTA_EMPLOYEES.JOSE]!;
    const fixed = await call("POST", "/shifts/assignments", {
      employeeIds: [jose],
      shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id],
      effectiveFrom: MON_B,
      weekdays: [],
    });
    expect([fixed.status, fixed.error?.code]).toEqual([409, "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION"]);

    const regime = await call("POST", "/work-regimes", { code: "SIN-R46", name: "Sin turno R4.6", kind: "SIN_TURNO" });
    expect(regime.status).toBe(201);
    const sinTurno = await call("POST", `/employees/${jose}/work-regimes`, { workRegimeId: regime.data.id, effectiveFrom: MON_B });
    expect([sinTurno.status, sinTurno.error?.code]).toEqual([409, "WORK_REGIME_OVERLAPS_ROTATION"]);

    const concurrent = await holder.employee.create({ data: { legajo: "R46-CONC", cuil: "20-999", dni: "999", firstName: "Con", lastName: "Currente" } });
    const [assignment, membership] = await Promise.all([
      call("POST", "/shifts/assignments", { employeeIds: [concurrent.id], shiftTemplateId: templateId[PLANTA_TEMPLATES.T0715.id], effectiveFrom: MON_B, weekdays: [] }),
      call("POST", `/shifts/rotations/${rotationId}/crews/${crewIds[PLANTA_CREWS.JOHANNA]}/members`, { employeeIds: [concurrent.id], effectiveFrom: MON_B }),
    ]);
    expect([assignment.status, membership.status].sort()).toEqual([201, 409]);
    expect(await holder.shiftAssignment.count({ where: { employeeId: concurrent.id, status: "HABILITADO" } }) + await holder.shiftRotationCrewMember.count({ where: { employeeId: concurrent.id } })).toBe(1);
  });

  it("protege grupos y plantillas de rotación aun antes de regir", async () => {
    await setupPlanta(MON_A, { activate: false });
    const group = await call("DELETE", `/shifts/groups/${groupId}`);
    expect([group.status, group.error?.code]).toEqual([409, "SHIFT_GROUP_IN_USE"]);
    const template = await call("DELETE", `/workforce/shift-templates/${templateId[PLANTA_TEMPLATES.T1907.id]}`);
    expect([template.status, template.error?.code]).toEqual([409, "SHIFT_TEMPLATE_IN_ROTATION"]);
  });

  it("una plantilla fija histórica sólo cambia de horario mediante preview + confirmación y conserva dependencias futuras", async () => {
    const person = await holder.employee.create({ data: { legajo: "R46-FIJO", cuil: "20-777", dni: "777", firstName: "Fija", lastName: "Histórica" } });
    const old = await holder.shiftTemplate.create({
      data: {
        code: "FIJO-OLD", name: "Fijo histórico", shiftGroupId: otherGroupId, startTime: "08:00", endTime: "16:00",
        entryToleranceBeforeMinutes: 11, entryToleranceAfterMinutes: 12, exitToleranceBeforeMinutes: 13, exitToleranceAfterMinutes: 14,
      },
    });
    await holder.shiftAssignment.create({ data: { employeeId: person.id, shiftTemplateId: old.id, effectiveFrom: day("2026-10-01"), weekdays: [1, 2, 3, 4, 5] } });
    await holder.holidayWorkAssignment.create({ data: { employeeId: person.id, shiftTemplateId: old.id, date: day("2026-12-08") } });

    for (const body of [{ startTime: "09:00" }, { status: "INACTIVO" }, { shiftGroupId: groupId }]) {
      const response = await call("PATCH", `/workforce/shift-templates/${old.id}`, body);
      expect(response.status).toBe(409);
      expect(response.error?.code).toMatch(/^SHIFT_TEMPLATE_(?:SCHEDULE|HISTORY)_LOCKED$/);
    }
    const removed = await call("DELETE", `/workforce/shift-templates/${old.id}`);
    expect([removed.status, removed.error?.code]).toEqual([409, "SHIFT_TEMPLATE_HISTORY_LOCKED"]);

    const body = { effectiveFrom: MON_B, startTime: "09:00", endTime: "17:00", code: "FIJO-NEW", name: "Fijo nuevo" };
    const preview = await call("POST", `/workforce/shift-templates/${old.id}/replace-schedule/preview`, body);
    expect(preview.status, JSON.stringify(preview.error)).toBe(200);
    expect(preview.data).toMatchObject({ complete: false, assignments: [expect.objectContaining({ action: "SPLIT" })] });
    expect(preview.data.pendingDependencies.holidayAssignments).toHaveLength(1);

    const noAck = await call("POST", `/workforce/shift-templates/${old.id}/replace-schedule`, { ...body, confirmationToken: preview.data.confirmationToken });
    expect([noAck.status, noAck.error?.code]).toEqual([409, "SHIFT_TEMPLATE_REPLACEMENT_DEPENDENCIES"]);
    const holidayHash = await hashRows(`SELECT id, date, "employeeId", "shiftTemplateId", status FROM "HolidayWorkAssignment" WHERE "shiftTemplateId" = '${old.id}'`);
    const replaced = await call("POST", `/workforce/shift-templates/${old.id}/replace-schedule`, {
      ...body,
      confirmationToken: preview.data.confirmationToken,
      acknowledgePendingDependencies: true,
    });
    expect(replaced.status, JSON.stringify(replaced.error)).toBe(201);
    expect(replaced.data).toMatchObject({ assignments: 1, complete: false, template: { code: "FIJO-NEW", startTime: "09:00", endTime: "17:00" } });
    expect(replaced.data.template).toMatchObject({ entryToleranceBeforeMinutes: 11, entryToleranceAfterMinutes: 12, exitToleranceBeforeMinutes: 13, exitToleranceAfterMinutes: 14 });
    expect(await hashRows(`SELECT id, date, "employeeId", "shiftTemplateId", status FROM "HolidayWorkAssignment" WHERE "shiftTemplateId" = '${old.id}'`)).toBe(holidayHash);
    const assignments = await holder.shiftAssignment.findMany({ where: { employeeId: person.id }, orderBy: { effectiveFrom: "asc" } });
    expect(assignments.map((row) => [row.shiftTemplateId, row.effectiveFrom.toISOString().slice(0, 10), row.effectiveTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      [old.id, "2026-10-01", "2026-11-08"],
      [replaced.data.template.id, MON_B, null],
    ]);
    const listed = await call("GET", "/workforce/shift-templates");
    expect(listed.data.find((row: { id: string }) => row.id === old.id)).toMatchObject({ inUseFromTomorrow: true });
    expect(await holder.auditLog.count({ where: { entity: { in: ["ShiftTemplate", "ShiftAssignment"] }, description: { contains: "FIJO-NEW" } } })).toBe(2);
  });

  it("permisos: Supervisión lee pero no escribe", async () => {
    const created = await call("POST", "/shifts/rotations", { code: "X1", name: "Prueba", shiftGroupId: groupId }, supervision);
    expect(created.status).toBe(403);
    expect((await call("GET", "/shifts/rotations", undefined, supervision)).status).toBe(200);
  });
});
