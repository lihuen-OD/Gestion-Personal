/**
 * R8.2/R8.3 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §26): lecturas y
 * escrituras de turnos con alcance por grupo y por legajo, contra PostgreSQL
 * REAL y por HTTP.
 *
 * Usuarios: RRHH (N1); Stefi (N2, Planta); Eugenia (N2, Taller y Maquinaria);
 * Joaquín (N3, supervisado por las dos); Vacío (N2 sin grupos ni supervisados).
 * Los alcances se cargan con fixtures directos: todavía no existe la API para
 * asignarlos (R8.4) y nadie recibe acceso por defecto.
 *
 * Opt-in: sólo corre con `SHIFT_GROUP_SCOPE_IT_DATABASE_URL` → `localhost`,
 * base `clock_it*` PROPIA con el schema de este commit (migraciones aplicadas,
 * nunca `db push`). VACÍA la base al empezar. Nunca usa el DATABASE_URL del
 * .env y verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SHIFT_GROUP_SCOPE_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

type AppUser = { id: string; email: string; role: string; name: string };
type Json = { data?: unknown; meta?: Record<string, unknown>; error?: { code: string; message: string } } | null;

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe.skipIf(!url)("R8 — turnos con alcance por grupo y por legajo (PostgreSQL local)", () => {
  let prisma: typeof import("../../shared/prisma/client").prisma;
  let jwtSecret: string;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;

  const users: Record<"rrhh" | "stefi" | "eugenia" | "joaquin" | "vacio", AppUser> = {} as never;
  const group: Record<"planta" | "taller" | "maquinaria" | "oficina", string> = {} as never;
  const template: Record<"planta" | "taller" | "maquinaria" | "oficina" | "suelto", string> = {} as never;
  const rotation: Record<"planta" | "taller", string> = {} as never;
  const employee: Record<"visible" | "hidden" | "taller" | "libre" | "libre2" | "hidden2", string> = {} as never;
  let plantaVersionLikeId = "";

  const token = (user: AppUser) => jwt.sign({ sub: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: "15m" });

  async function api(user: AppUser, method: string, path: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token(user)}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Json, text };
  }

  async function get(user: AppUser, path: string) {
    const result = await api(user, "GET", path);
    return result;
  }

  async function groupCodes(user: AppUser) {
    const { status, json } = await get(user, "/shifts/groups");
    expect(status).toBe(200);
    return (json!.data as Array<{ code: string }>).map((item) => item.code).sort();
  }

  async function templateCodes(user: AppUser) {
    const { status, json } = await get(user, "/workforce/shift-templates");
    expect(status).toBe(200);
    return (json!.data as Array<{ code: string }>).map((item) => item.code).sort();
  }

  async function rotationCodes(user: AppUser, query = "") {
    const { status, json } = await get(user, `/shifts/rotations${query}`);
    expect(status).toBe(200);
    return (json!.data as Array<{ code: string }>).map((item) => item.code).sort();
  }

  async function createUser(key: keyof typeof users, name: string, role: string) {
    const created = await holder.user.create({ data: { name, email: `${key}@r8.local`, passwordHash: "x", role: role as never } });
    users[key] = { id: created.id, email: created.email, role: created.role, name: created.name };
  }

  const scopeRow = (user: AppUser, groupId: string) => holder.userShiftGroupScope.create({ data: { userId: user.id, shiftGroupId: groupId, createdByUserId: users.rrhh.id } });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("SHIFT_GROUP_SCOPE_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, client] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
    ]);
    prisma = client.prisma;
    jwtSecret = env.JWT_ACCESS_SECRET;
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    await createUser("rrhh", "RRHH IT", "NIVEL_1_RRHH");
    await createUser("stefi", "Stefi IT", "NIVEL_2_SUPERVISION");
    await createUser("eugenia", "Eugenia IT", "NIVEL_2_SUPERVISION");
    await createUser("joaquin", "Joaquin IT", "NIVEL_3_CARGA_HORARIA");
    await createUser("vacio", "Vacio IT", "NIVEL_2_SUPERVISION");

    for (const [key, code, name, sortOrder] of [["planta", "PLANTA", "Planta", 10], ["taller", "TALLER", "Taller", 20], ["maquinaria", "MAQUINARIA", "Maquinaria", 30], ["oficina", "OFICINA", "Oficina", 40]] as const) {
      group[key] = (await holder.shiftGroup.create({ data: { code, name, sortOrder } })).id;
    }
    for (const [key, code, groupKey, start, end] of [
      ["planta", "PLANTA-01", "planta", "07:00", "15:00"],
      ["taller", "TALLER-01", "taller", "08:00", "16:00"],
      ["maquinaria", "MAQ-01", "maquinaria", "09:00", "17:00"],
      ["oficina", "OFI-01", "oficina", "09:00", "18:00"],
      ["suelto", "SUELTO-01", null, "10:00", "18:00"],
    ] as const) {
      template[key] = (await holder.shiftTemplate.create({ data: { code, name: `Turno ${code}`, startTime: start, endTime: end, shiftGroupId: groupKey ? group[groupKey] : null } })).id;
    }

    // Legajos: "visible", "taller", "libre" y "libre2" asignados directamente a
    // Stefi y a Eugenia (Nivel 2); Joaquín (Nivel 3) los hereda por
    // supervisión; "hidden" sin responsable horario.
    for (const [key, legajo, lastName] of [["visible", "R8-1", "Uno"], ["hidden", "R8-2", "Oculto"], ["taller", "R8-3", "Tres"], ["libre", "R8-4", "Cuatro"], ["libre2", "R8-5", "Cinco"], ["hidden2", "R8-6", "Escondido"]] as const) {
      employee[key] = (await holder.employee.create({ data: { legajo, cuil: `20-9${legajo}`, dni: `9${legajo}`, firstName: "Prueba", lastName } })).id;
    }
    for (const key of ["visible", "taller", "libre", "libre2"] as const) {
      for (const responsible of [users.stefi, users.eugenia]) {
        await holder.employeeAssignment.create({ data: { employeeId: employee[key], userId: responsible.id, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
      }
    }
    await holder.userSupervisionAssignment.create({ data: { supervisorUserId: users.stefi.id, supervisedUserId: users.joaquin.id } });
    await holder.userSupervisionAssignment.create({ data: { supervisorUserId: users.eugenia.id, supervisedUserId: users.joaquin.id } });

    // Alcances (fixtures: todavía no hay API, R8.4).
    await scopeRow(users.stefi, group.planta);
    await scopeRow(users.eugenia, group.taller);
    await scopeRow(users.eugenia, group.maquinaria);
    // Fila desfasada de un Nivel 3: nunca da alcance (sólo hereda).
    await scopeRow(users.joaquin, group.oficina);

    // Rotaciones: Planta con "visible" y "hidden"; Taller con "taller".
    for (const [key, code, groupKey] of [["planta", "ROT-PLANTA", "planta"], ["taller", "ROT-TALLER", "taller"]] as const) {
      rotation[key] = (await holder.shiftRotation.create({ data: { code, name: `Rotación ${code}`, shiftGroupId: group[groupKey], status: "INACTIVO" } })).id;
    }
    const plantaCrew = await holder.shiftRotationCrew.create({ data: { rotationId: rotation.planta, code: "A", name: "Equipo A" } });
    const tallerCrew = await holder.shiftRotationCrew.create({ data: { rotationId: rotation.taller, code: "A", name: "Equipo A" } });
    await holder.shiftRotationCrewMember.create({ data: { crewId: plantaCrew.id, employeeId: employee.visible, effectiveFrom: day("2027-01-07") } });
    await holder.shiftRotationCrewMember.create({ data: { crewId: plantaCrew.id, employeeId: employee.hidden, effectiveFrom: day("2027-01-07") } });
    await holder.shiftRotationCrewMember.create({ data: { crewId: tallerCrew.id, employeeId: employee.taller, effectiveFrom: day("2027-01-07") } });

    // "visible": fijo de Taller antes de entrar a la rotación (vista previa) y
    // fijo de Maquinaria superpuesto con la membresía (aviso de configuración).
    await holder.shiftAssignment.create({ data: { employeeId: employee.visible, shiftTemplateId: template.taller, effectiveFrom: day("2027-01-01"), effectiveTo: day("2027-01-06") } });
    await holder.shiftAssignment.create({ data: { employeeId: employee.visible, shiftTemplateId: template.maquinaria, effectiveFrom: day("2027-01-07") } });
    await holder.shiftAssignment.create({ data: { employeeId: employee.visible, shiftTemplateId: template.planta, effectiveFrom: day("2026-01-01"), effectiveTo: day("2026-12-31") } });
    // Escrituras (R8.3): "hidden2" (sin responsable) con un fijo de Planta y
    // "libre2" con un fijo de Taller que se superpone con su futura alta.
    await holder.shiftAssignment.create({ data: { employeeId: employee.hidden2, shiftTemplateId: template.planta, effectiveFrom: day("2026-01-01") } });
    await holder.shiftAssignment.create({ data: { employeeId: employee.libre2, shiftTemplateId: template.taller, effectiveFrom: day("2027-01-01") } });
    plantaVersionLikeId = "00000000-0000-4000-8000-000000000000";

    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma?.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  describe("catálogos", () => {
    it("RRHH ve todo, incluida la plantilla sin grupo", async () => {
      expect(await groupCodes(users.rrhh)).toEqual(["MAQUINARIA", "OFICINA", "PLANTA", "TALLER"]);
      expect(await templateCodes(users.rrhh)).toEqual(["MAQ-01", "OFI-01", "PLANTA-01", "SUELTO-01", "TALLER-01"]);
      expect(await rotationCodes(users.rrhh)).toEqual(["ROT-PLANTA", "ROT-TALLER"]);
    });

    it("Nivel 2 con un grupo (Stefi): sólo Planta", async () => {
      expect(await groupCodes(users.stefi)).toEqual(["PLANTA"]);
      expect(await templateCodes(users.stefi)).toEqual(["PLANTA-01"]);
      expect(await rotationCodes(users.stefi)).toEqual(["ROT-PLANTA"]);
    });

    it("Nivel 2 con varios grupos (Eugenia): Taller y Maquinaria, nunca Planta", async () => {
      expect(await groupCodes(users.eugenia)).toEqual(["MAQUINARIA", "TALLER"]);
      expect(await templateCodes(users.eugenia)).toEqual(["MAQ-01", "TALLER-01"]);
      expect(await rotationCodes(users.eugenia)).toEqual(["ROT-TALLER"]);
    });

    it("Nivel 3 (Joaquín) hereda la unión de sus dos Nivel 2; su fila propia (Oficina) no da alcance", async () => {
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "PLANTA", "TALLER"]);
      expect(await templateCodes(users.joaquin)).toEqual(["MAQ-01", "PLANTA-01", "TALLER-01"]);
      expect(await rotationCodes(users.joaquin)).toEqual(["ROT-PLANTA", "ROT-TALLER"]);
    });

    it("Nivel 2 sin grupos: listas vacías, nunca acceso global", async () => {
      expect(await groupCodes(users.vacio)).toEqual([]);
      expect(await templateCodes(users.vacio)).toEqual([]);
      expect(await rotationCodes(users.vacio)).toEqual([]);
      const summary = await get(users.vacio, "/shifts/assignments/summary");
      expect(summary.json!.data).toEqual([]);
    });

    it("filtrar rotaciones por un grupo ajeno devuelve vacío", async () => {
      expect(await rotationCodes(users.stefi, `?shiftGroupId=${group.taller}`)).toEqual([]);
    });
  });

  describe("referencias por ID a grupos ajenos", () => {
    it("detalle, versión, miembros y vista previa de una rotación ajena responden igual que inexistentes (404)", async () => {
      const paths = [
        `/shifts/rotations/${rotation.taller}`,
        `/shifts/rotations/${rotation.taller}/versions/${plantaVersionLikeId}`,
        `/shifts/rotations/${rotation.taller}/members`,
        `/shifts/expected?rotationId=${rotation.taller}&from=2027-01-04&to=2027-01-10`,
      ];
      for (const path of paths) {
        const foreign = await get(users.stefi, path);
        expect(foreign.status, path).toBe(404);
        expect(foreign.json!.error!.code).toBe("ROTATION_NOT_FOUND");
        expect(foreign.text).not.toContain("ROT-TALLER");
      }
      const missing = await get(users.stefi, `/shifts/rotations/${plantaVersionLikeId}`);
      expect(missing.status).toBe(404);
      expect(missing.json!.error).toEqual((await get(users.stefi, `/shifts/rotations/${rotation.taller}`)).json!.error);
    });

    it("asignaciones filtradas por una plantilla ajena: lista vacía", async () => {
      const foreign = await get(users.stefi, `/shifts/assignments?shiftTemplateId=${template.taller}`);
      expect(foreign.status).toBe(200);
      expect(foreign.json!.data).toEqual([]);
      const own = await get(users.stefi, `/shifts/assignments?shiftTemplateId=${template.planta}`);
      expect((own.json!.data as unknown[]).length).toBe(1);
    });

    it("resumen de asignaciones: sólo plantillas de sus grupos", async () => {
      const summary = await get(users.stefi, "/shifts/assignments/summary");
      expect((summary.json!.data as Array<{ shiftTemplateId: string }>).map((row) => row.shiftTemplateId)).toEqual([template.planta]);
    });

  });

  describe("personas dentro de una rotación propia", () => {
    it("detalle: oculta al miembro fuera del alcance de legajos, informa cuántos y no lo nombra en avisos", async () => {
      const { status, json, text } = await get(users.stefi, `/shifts/rotations/${rotation.planta}`);
      expect(status).toBe(200);
      const data = json!.data as { members: Array<{ legajo: string }>; hiddenMemberCount: number; issues: Array<{ code: string; message: string; employeeId?: string }> };
      expect(data.members.map((member) => member.legajo)).toEqual(["R8-1"]);
      expect(data.hiddenMemberCount).toBe(1);
      expect(text).not.toContain("R8-2");
      expect(text).not.toContain("Oculto");
      expect(text).not.toContain(employee.hidden);
      expect(data.issues.some((issue) => issue.message.startsWith("Una persona fuera de tu alcance"))).toBe(true);
      // Turno fijo de Maquinaria superpuesto: Stefi no administra Maquinaria.
      expect(text).not.toContain("MAQ-01");
      expect(text).not.toContain("relatedShiftGroupId");
      expect(data.issues.find((issue) => issue.code === "FIXED_ASSIGNMENT_OVERLAP")?.message).toContain("de otro grupo");
    });

    it("Joaquín administra Maquinaria: ve el código del fijo superpuesto", async () => {
      const { json } = await get(users.joaquin, `/shifts/rotations/${rotation.planta}`);
      const issues = (json!.data as { issues: Array<{ code: string; message: string }> }).issues;
      expect(issues.find((issue) => issue.code === "FIXED_ASSIGNMENT_OVERLAP")?.message).toContain("MAQ-01");
    });

    it("RRHH ve a todos los miembros y todo el detalle", async () => {
      const { json, text } = await get(users.rrhh, `/shifts/rotations/${rotation.planta}`);
      const data = json!.data as { members: Array<{ legajo: string }>; hiddenMemberCount: number };
      expect(data.members.map((member) => member.legajo).sort()).toEqual(["R8-1", "R8-2"]);
      expect(data.hiddenMemberCount).toBe(0);
      expect(text).toContain("MAQ-01");
    });

    it("lista de miembros: mismos criterios, con meta.hiddenCount", async () => {
      const scoped = await get(users.stefi, `/shifts/rotations/${rotation.planta}/members`);
      expect((scoped.json!.data as Array<{ legajo: string }>).map((member) => member.legajo)).toEqual(["R8-1"]);
      expect(scoped.json!.meta).toEqual({ hiddenCount: 1 });
      const all = await get(users.rrhh, `/shifts/rotations/${rotation.planta}/members`);
      expect((all.json!.data as unknown[]).length).toBe(2);
      expect(all.json!.meta).toEqual({ hiddenCount: 0 });
    });

    it("vista previa: sólo legajos del alcance; el fijo de otro grupo sin id ni código", async () => {
      const { status, json, text } = await get(users.stefi, `/shifts/expected?rotationId=${rotation.planta}&from=2027-01-04&to=2027-01-10`);
      expect(status).toBe(200);
      const rows = json!.data as Array<{ employee: { legajo: string }; days: Array<{ date: string; effective: { blocks: Array<{ template: { id: string | null; code: string | null; startTime: string }; templateHidden?: boolean }> } }> }>;
      expect(rows.map((row) => row.employee.legajo)).toEqual(["R8-1"]);
      const monday = rows[0]!.days.find((cell) => cell.date === "2027-01-04")!;
      expect(monday.effective.blocks).toHaveLength(1);
      expect(monday.effective.blocks[0]).toMatchObject({ template: { id: null, code: null, startTime: "08:00" }, templateHidden: true });
      expect(text).not.toContain("TALLER-01");
      expect(text).not.toContain(template.taller);
      expect(text).not.toContain(template.maquinaria);

      const rrhh = await get(users.rrhh, `/shifts/expected?rotationId=${rotation.planta}&from=2027-01-04&to=2027-01-10`);
      expect(rrhh.text).toContain("TALLER-01");
      expect((rrhh.json!.data as unknown[]).length).toBe(2);
    });

    it("Eugenia (Taller) en su rotación ve el fijo de Taller con código", async () => {
      const { json } = await get(users.eugenia, `/shifts/rotations/${rotation.taller}/members`);
      expect((json!.data as Array<{ legajo: string }>).map((member) => member.legajo)).toEqual(["R8-3"]);
    });
  });

  describe("cambios de alcance: rigen en la request siguiente (sin cachés que conserven permisos)", () => {
    it("revocar Planta a Stefi: 404 inmediato y catálogo vacío aunque estuviera cacheado", async () => {
      expect(await templateCodes(users.stefi)).toEqual(["PLANTA-01"]);
      await holder.userShiftGroupScope.deleteMany({ where: { userId: users.stefi.id, shiftGroupId: group.planta } });

      expect(await templateCodes(users.stefi)).toEqual([]);
      expect(await groupCodes(users.stefi)).toEqual([]);
      expect((await get(users.stefi, `/shifts/rotations/${rotation.planta}`)).status).toBe(404);
      expect((await get(users.stefi, "/shifts/assignments/summary")).json!.data).toEqual([]);
      // Joaquín pierde Planta también (heredaba de Stefi).
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "TALLER"]);

      await scopeRow(users.stefi, group.planta);
      expect(await templateCodes(users.stefi)).toEqual(["PLANTA-01"]);
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "PLANTA", "TALLER"]);
    });

    it("quitar a Joaquín de los supervisados de Eugenia: pierde Taller y Maquinaria", async () => {
      await holder.userSupervisionAssignment.deleteMany({ where: { supervisorUserId: users.eugenia.id, supervisedUserId: users.joaquin.id } });
      expect(await groupCodes(users.joaquin)).toEqual(["PLANTA"]);
      expect((await get(users.joaquin, `/shifts/rotations/${rotation.taller}`)).status).toBe(404);
      await holder.userSupervisionAssignment.create({ data: { supervisorUserId: users.eugenia.id, supervisedUserId: users.joaquin.id } });
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "PLANTA", "TALLER"]);
    });

    it("Eugenia INACTIVA deja de transmitir; al reactivarla vuelve", async () => {
      await holder.user.update({ where: { id: users.eugenia.id }, data: { status: "INACTIVO" } });
      expect(await groupCodes(users.joaquin)).toEqual(["PLANTA"]);
      await holder.user.update({ where: { id: users.eugenia.id }, data: { status: "ACTIVO" } });
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "PLANTA", "TALLER"]);
    });

    it("un Nivel 2 que pasa a Nivel 3 deja de usar sus filas y deja de transmitirlas", async () => {
      await holder.user.update({ where: { id: users.eugenia.id }, data: { role: "NIVEL_3_CARGA_HORARIA" } });
      // Esperar el caché de 5 s del usuario autenticado (auth.service) no hace
      // falta: el rol de Eugenia se lee en la regla del Nivel 3 (Joaquín).
      expect(await groupCodes(users.joaquin)).toEqual(["PLANTA"]);
      await holder.user.update({ where: { id: users.eugenia.id }, data: { role: "NIVEL_2_SUPERVISION" } });
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "PLANTA", "TALLER"]);
    });
  });
  describe("escrituras (R8.3)", () => {
    const tpl = (code: string, shiftGroupId: string | null) => ({ code, name: `Turno ${code}`, shiftGroupId, startTime: "07:00", endTime: "15:00", entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20 });
    const grid = (crewId: string, templateId: string) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ crewId, cycleWeekIndex: 0, weekday, kind: weekday === 0 || weekday === 6 ? "REST" : "SHIFT", blocks: weekday === 0 || weekday === 6 ? [] : [{ blockIndex: 0, shiftTemplateId: templateId }] }));
    let plantaTwo = "";
    let ownRotation = "";
    let ownCrew = "";

    it("plantillas: Stefi crea y edita en Planta; Taller, sin grupo o ajena → 403/404", async () => {
      const created = await api(users.stefi, "POST", "/workforce/shift-templates", tpl("PLANTA-02", group.planta));
      expect(created.status, created.text).toBe(201);
      plantaTwo = (created.json!.data as { id: string }).id;
      expect((await api(users.stefi, "POST", "/workforce/shift-templates", tpl("TALLER-09", group.taller))).json!.error!.code).toBe("SHIFT_GROUP_FORBIDDEN");
      expect((await api(users.stefi, "POST", "/workforce/shift-templates", tpl("SUELTO-09", null))).status).toBe(403);

      expect((await api(users.stefi, "PATCH", `/workforce/shift-templates/${plantaTwo}`, { name: "Planta dos" })).status).toBe(200);
      expect((await api(users.stefi, "PATCH", `/workforce/shift-templates/${plantaTwo}`, { shiftGroupId: group.taller })).status).toBe(403);
      expect((await api(users.stefi, "PATCH", `/workforce/shift-templates/${plantaTwo}`, { shiftGroupId: null })).status).toBe(403);
      const foreign = await api(users.stefi, "PATCH", `/workforce/shift-templates/${template.taller}`, { name: "Robado" });
      expect([foreign.status, foreign.json!.error!.code]).toEqual([404, "SHIFT_TEMPLATE_NOT_FOUND"]);
      expect((await api(users.stefi, "DELETE", `/workforce/shift-templates/${template.taller}`)).status).toBe(404);
      expect((await api(users.stefi, "DELETE", `/workforce/shift-templates/${template.suelto}`)).status).toBe(404);
      expect((await holder.shiftTemplate.findUniqueOrThrow({ where: { id: template.taller } })).name).toBe("Turno TALLER-01");

      const disposable = await api(users.stefi, "POST", "/workforce/shift-templates", tpl("PLANTA-03", group.planta));
      expect((await api(users.stefi, "DELETE", `/workforce/shift-templates/${(disposable.json!.data as { id: string }).id}`)).status).toBe(200);
    });

    it("plantillas: Nivel 2 sin grupos no crea nada; RRHH conserva acceso total", async () => {
      expect((await api(users.vacio, "POST", "/workforce/shift-templates", tpl("PLANTA-08", group.planta))).status).toBe(403);
      expect((await api(users.rrhh, "PATCH", `/workforce/shift-templates/${template.suelto}`, { name: "Turno SUELTO-01" })).status).toBe(200);
    });

    it("asignaciones fijas: alta en su plantilla; plantilla ajena o sin grupo → 404; masiva mezclada → 403 sin escribir", async () => {
      const ok = await api(users.stefi, "POST", "/shifts/assignments", { employeeIds: [employee.libre], shiftTemplateId: plantaTwo, effectiveFrom: "2027-06-01" });
      expect(ok.status, ok.text).toBe(201);
      for (const shiftTemplateId of [template.taller, template.suelto]) {
        const denied = await api(users.stefi, "POST", "/shifts/assignments", { employeeIds: [employee.libre], shiftTemplateId, effectiveFrom: "2027-06-01" });
        expect([denied.status, denied.json!.error!.code]).toEqual([404, "SHIFT_TEMPLATE_NOT_FOUND"]);
      }
      const before = await holder.shiftAssignment.count();
      const mixed = await api(users.stefi, "POST", "/shifts/assignments", { employeeIds: [employee.libre2, employee.hidden2], shiftTemplateId: plantaTwo, effectiveFrom: "2027-06-01" });
      expect([mixed.status, mixed.json!.error!.code]).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
      expect(await holder.shiftAssignment.count()).toBe(before);
      expect((await api(users.vacio, "POST", "/shifts/assignments", { employeeIds: [employee.libre], shiftTemplateId: template.planta, effectiveFrom: "2027-06-01" })).status).toBe(404);
    });

    it("asignaciones fijas por id: de otro grupo o de un legajo fuera de alcance → 404; RRHH sí", async () => {
      const foreign = await holder.shiftAssignment.findFirstOrThrow({ where: { employeeId: employee.visible, shiftTemplateId: template.taller } });
      const hiddenRow = await holder.shiftAssignment.findFirstOrThrow({ where: { employeeId: employee.hidden2, shiftTemplateId: template.planta } });
      for (const id of [foreign.id, hiddenRow.id]) {
        expect((await api(users.stefi, "PATCH", `/shifts/assignments/${id}`, { observation: "x" })).json!.error!.code).toBe("SHIFT_ASSIGNMENT_NOT_FOUND");
        expect((await api(users.stefi, "DELETE", `/shifts/assignments/${id}`)).status).toBe(404);
      }
      expect((await api(users.rrhh, "PATCH", `/shifts/assignments/${hiddenRow.id}`, { observation: "RRHH" })).status).toBe(200);
    });

    it("superposición con una rotación de otro grupo: código y nombre ajenos ocultos (RRHH los ve)", async () => {
      const body = { employeeIds: [employee.taller], shiftTemplateId: plantaTwo, effectiveFrom: "2027-02-01" };
      const scoped = await api(users.stefi, "POST", "/shifts/assignments", body);
      expect([scoped.status, scoped.json!.error!.code]).toEqual([409, "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION"]);
      expect(scoped.text).not.toContain("ROT-TALLER");
      const full = await api(users.rrhh, "POST", "/shifts/assignments", body);
      expect(full.text).toContain("ROT-TALLER");
    });

    it("rotaciones: Stefi crea, configura y versiona en Planta; Taller o ajena → 403/404", async () => {
      const denied = await api(users.stefi, "POST", "/shifts/rotations", { code: "ROT-X", name: "Otra rotación", shiftGroupId: group.taller });
      expect([denied.status, denied.json!.error!.code]).toEqual([403, "SHIFT_GROUP_FORBIDDEN"]);
      const created = await api(users.stefi, "POST", "/shifts/rotations", { code: "ROT-STEFI", name: "Rotación de Stefi", shiftGroupId: group.planta });
      expect(created.status, created.text).toBe(201);
      ownRotation = (created.json!.data as { id: string }).id;
      expect((await holder.auditLog.findFirstOrThrow({ where: { entity: "ShiftRotation", entityId: ownRotation, action: "CREATE" } })).userId).toBe(users.stefi.id);

      expect((await api(users.stefi, "PATCH", `/shifts/rotations/${ownRotation}`, { shiftGroupId: group.taller })).status).toBe(403);
      const crew = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews`, { code: "A", name: "Equipo A" });
      expect(crew.status, crew.text).toBe(201);
      ownCrew = (crew.json!.data as { id: string }).id;

      const foreignGrid = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/versions`, { effectiveFrom: "2027-03-01", cycleLengthWeeks: 1, anchorWeekStart: "2027-03-01", days: grid(ownCrew, template.taller) });
      expect([foreignGrid.status, foreignGrid.json!.error!.code]).toEqual([422, "ROTATION_TEMPLATE_OTHER_GROUP"]);
      expect(foreignGrid.text).not.toContain("TALLER");
      expect((await api(users.rrhh, "POST", `/shifts/rotations/${ownRotation}/versions`, { effectiveFrom: "2027-03-01", cycleLengthWeeks: 1, anchorWeekStart: "2027-03-01", days: grid(ownCrew, template.taller) })).text).toContain("TALLER-01");

      const version = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/versions`, { effectiveFrom: "2027-03-01", cycleLengthWeeks: 1, anchorWeekStart: "2027-03-01", days: grid(ownCrew, plantaTwo) });
      expect(version.status, version.text).toBe(201);

      for (const [method, path, body] of [
        ["PATCH", `/shifts/rotations/${rotation.taller}`, { name: "Otro nombre" }],
        ["DELETE", `/shifts/rotations/${rotation.taller}`, undefined],
        ["POST", `/shifts/rotations/${rotation.taller}/activate`, undefined],
        ["POST", `/shifts/rotations/${rotation.taller}/crews`, { code: "Z", name: "Zeta" }],
        ["POST", `/shifts/rotations/${rotation.taller}/finalize/preview`, { lastDay: "2027-12-31" }],
      ] as const) {
        const response = await api(users.stefi, method, path, body);
        expect([response.status, response.json!.error!.code], `${method} ${path}`).toEqual([404, "ROTATION_NOT_FOUND"]);
      }
      expect((await holder.shiftRotation.findUniqueOrThrow({ where: { id: rotation.taller } })).name).toBe("Rotación ROT-TALLER");
    });

    it("membresías: masiva mezclada → 403 sin escribir; otra rotación ajena → mensaje sin detalle", async () => {
      const mixed = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews/${ownCrew}/members`, { employeeIds: [employee.libre, employee.hidden], effectiveFrom: "2027-03-01" });
      expect([mixed.status, mixed.json!.error!.code]).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
      expect(await holder.shiftRotationCrewMember.count({ where: { crewId: ownCrew } })).toBe(0);

      const overlap = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews/${ownCrew}/members`, { employeeIds: [employee.taller], effectiveFrom: "2027-03-01" });
      expect([overlap.status, overlap.json!.error!.code]).toEqual([409, "ROTATION_MEMBERSHIP_OVERLAP"]);
      expect(overlap.text).not.toContain("ROT-TALLER");
    });

    it("R8.7: conflicto con planificación de su propio grupo y personas de su alcance → mensaje completo", async () => {
      // "visible" ya es miembro de ROT-PLANTA (Planta) desde el 07/01/2027.
      const membership = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews/${ownCrew}/members`, { employeeIds: [employee.visible], effectiveFrom: "2027-03-01" });
      expect([membership.status, membership.json!.error!.code]).toEqual([409, "ROTATION_MEMBERSHIP_OVERLAP"]);
      expect(membership.json!.error!.message).toContain("ROT-PLANTA");
      const fixed = await api(users.stefi, "POST", "/shifts/assignments", { employeeIds: [employee.visible], shiftTemplateId: plantaTwo, effectiveFrom: "2027-02-01" });
      expect([fixed.status, fixed.json!.error!.code]).toEqual([409, "SHIFT_ASSIGNMENT_OVERLAPS_ROTATION"]);
      expect(fixed.json!.error!.message).toContain("ROT-PLANTA");
    });

    it("cerrar fijos de otro grupo al dar el alta: rechazado sin tocarlos y sin nombrar el turno ajeno", async () => {
      const withoutClose = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews/${ownCrew}/members`, { employeeIds: [employee.libre2], effectiveFrom: "2027-03-01" });
      expect([withoutClose.status, withoutClose.json!.error!.code]).toEqual([409, "ROTATION_FIXED_ASSIGNMENT_OVERLAP"]);
      expect(withoutClose.text).not.toContain("TALLER-01");
      const withClose = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews/${ownCrew}/members`, { employeeIds: [employee.libre2], effectiveFrom: "2027-03-01", closeFixedAssignments: true });
      expect([withClose.status, withClose.json!.error!.code]).toEqual([409, "ROTATION_FIXED_ASSIGNMENT_OUT_OF_SCOPE"]);
      expect((await holder.shiftAssignment.findFirstOrThrow({ where: { employeeId: employee.libre2, shiftTemplateId: template.taller } })).effectiveTo).toBeNull();
    });

    it("membresías: alta (cerrando un fijo de su propio grupo) y cancelación; miembro fuera del alcance → 404", async () => {
      // "libre" tiene PLANTA-02 desde el 01/06/2027: es de Planta, así que el
      // mensaje lo nombra y Stefi puede cerrarlo con la Opción C.
      const overlapOwn = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews/${ownCrew}/members`, { employeeIds: [employee.libre], effectiveFrom: "2027-03-01" });
      expect([overlapOwn.status, overlapOwn.text.includes("PLANTA-02")]).toEqual([409, true]);
      const added = await api(users.stefi, "POST", `/shifts/rotations/${ownRotation}/crews/${ownCrew}/members`, { employeeIds: [employee.libre], effectiveFrom: "2027-03-01", closeFixedAssignments: true });
      expect(added.status, added.text).toBe(201);
      expect((await holder.shiftAssignment.findFirstOrThrow({ where: { employeeId: employee.libre, shiftTemplateId: plantaTwo } })).status).toBe("DESHABILITADO");
      const memberId = (added.json!.data as { members: Array<{ id: string }> }).members[0]!.id;
      expect((await api(users.stefi, "DELETE", `/shifts/rotations/${ownRotation}/members/${memberId}`)).status).toBe(200);

      const hiddenMember = await holder.shiftRotationCrewMember.findFirstOrThrow({ where: { employeeId: employee.hidden } });
      for (const [method, path, body] of [
        ["POST", `/shifts/rotations/${rotation.planta}/members/${hiddenMember.id}/close`, { lastDay: "2027-12-31" }],
        ["DELETE", `/shifts/rotations/${rotation.planta}/members/${hiddenMember.id}`, undefined],
      ] as const) {
        const response = await api(users.stefi, method, path, body);
        expect([response.status, response.text.includes("Oculto")], `${method} ${path}`).toEqual([404, false]);
      }
      expect(await holder.shiftRotationCrewMember.count({ where: { id: hiddenMember.id } })).toBe(1);
    });

    it("finalizar una rotación con miembros fuera del alcance → 403 antes que cualquier otra validación (RRHH sí llega)", async () => {
      const scoped = await api(users.stefi, "POST", `/shifts/rotations/${rotation.planta}/finalize/preview`, { lastDay: "2027-12-31" });
      expect([scoped.status, scoped.json!.error!.code]).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
      expect(scoped.text).not.toContain("Oculto");
      expect((await api(users.rrhh, "POST", `/shifts/rotations/${rotation.planta}/finalize/preview`, { lastDay: "2027-12-31" })).json!.error!.code).toBe("ROTATION_NOT_ACTIVE");
    });

    it("reemplazo de horario: afecta un legajo fuera del alcance → 403; plantilla ajena → 404", async () => {
      const effectiveFrom = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      const body = { effectiveFrom, startTime: "06:00", endTime: "14:00", code: "PLANTA-01B", name: "Planta temprano" };
      const scoped = await api(users.stefi, "POST", `/workforce/shift-templates/${template.planta}/replace-schedule/preview`, body);
      expect([scoped.status, scoped.json!.error!.code]).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
      expect(scoped.text).not.toContain("Escondido");
      expect((await api(users.stefi, "POST", `/workforce/shift-templates/${template.taller}/replace-schedule/preview`, body)).status).toBe(404);
      const own = await api(users.stefi, "POST", `/workforce/shift-templates/${plantaTwo}/replace-schedule/preview`, { ...body, code: "PLANTA-02B" });
      expect(own.status, own.text).toBe(200);
      expect((await api(users.rrhh, "POST", `/workforce/shift-templates/${template.planta}/replace-schedule/preview`, body)).status).toBe(200);
    });

    it("Nivel 3 hereda la escritura; al quitar la supervisión la pierde en la request siguiente", async () => {
      const created = await api(users.joaquin, "POST", "/shifts/rotations", { code: "ROT-JOAQ", name: "Rotación de Joaquín", shiftGroupId: group.taller });
      expect(created.status, created.text).toBe(201);
      await holder.userSupervisionAssignment.deleteMany({ where: { supervisorUserId: users.eugenia.id, supervisedUserId: users.joaquin.id } });
      const denied = await api(users.joaquin, "POST", "/shifts/rotations", { code: "ROT-JOAQ2", name: "Otra", shiftGroupId: group.taller });
      expect([denied.status, denied.json!.error!.code]).toEqual([403, "SHIFT_GROUP_FORBIDDEN"]);
      expect((await api(users.joaquin, "PATCH", `/shifts/rotations/${(created.json!.data as { id: string }).id}`, { name: "Otro nombre" })).status).toBe(404);
      await holder.userSupervisionAssignment.create({ data: { supervisorUserId: users.eugenia.id, supervisedUserId: users.joaquin.id } });
      expect((await api(users.joaquin, "PATCH", `/shifts/rotations/${(created.json!.data as { id: string }).id}`, { name: "Rotación de Joaquín" })).status).toBe(200);
    });

    it("revocar Planta a Stefi: sus escrituras sobre Planta responden 404/403 de inmediato", async () => {
      await holder.userShiftGroupScope.deleteMany({ where: { userId: users.stefi.id, shiftGroupId: group.planta } });
      expect((await api(users.stefi, "PATCH", `/shifts/rotations/${ownRotation}`, { name: "Otro nombre" })).status).toBe(404);
      expect((await api(users.stefi, "POST", "/workforce/shift-templates", tpl("PLANTA-07", group.planta))).status).toBe(403);
      await scopeRow(users.stefi, group.planta);
      expect((await api(users.stefi, "PATCH", `/shifts/rotations/${ownRotation}`, { name: "Rotación de Stefi" })).status).toBe(200);
    });

    it("grupos y convocatorias siguen siendo sólo de RRHH", async () => {
      expect((await api(users.stefi, "POST", "/shifts/groups", { code: "NUEVO", name: "Nuevo" })).status).toBe(403);
      expect((await api(users.stefi, "PATCH", `/shifts/groups/${group.planta}`, { name: "Planta" })).status).toBe(403);
      expect((await api(users.joaquin, "PUT", "/shifts/holiday-work/assignments", { date: "2027-05-01", assignments: [] })).status).toBe(403);
    });
  });
  describe("efectos indirectos sobre legajos fuera del alcance (R8.3)", () => {
    const tpl = (code: string) => ({ code, name: `Turno ${code}`, shiftGroupId: group.planta, startTime: "07:00", endTime: "15:00", entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20 });
    const day7 = (crewId: string, templateId: string) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ crewId, cycleWeekIndex: 0, weekday, kind: "SHIFT", blocks: [{ blockIndex: 0, shiftTemplateId: templateId }] }));

    it("plantilla: tolerancias, horario o estado de un turno que usa un legajo ajeno → 403 sin cambios; nombre sí", async () => {
      // PLANTA-01 lo usa "hidden2" (fijo HABILITADO vigente, sin responsable).
      for (const body of [{ entryToleranceAfterMinutes: 25 }, { startTime: "06:30" }, { status: "INACTIVO" }, { absoluteOpenShiftLimitMinutes: 900 }]) {
        const response = await api(users.stefi, "PATCH", `/workforce/shift-templates/${template.planta}`, body);
        expect([response.status, response.json!.error!.code], JSON.stringify(body)).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
        expect(response.text).not.toContain("Escondido");
      }
      const stored = await holder.shiftTemplate.findUniqueOrThrow({ where: { id: template.planta } });
      expect([stored.entryToleranceAfterMinutes, stored.startTime, stored.status, stored.absoluteOpenShiftLimitMinutes]).toEqual([10, "07:00", "ACTIVO", 1200]);
      expect((await api(users.stefi, "PATCH", `/workforce/shift-templates/${template.planta}`, { name: "Planta mañana" })).status).toBe(200);
      expect((await api(users.rrhh, "PATCH", `/workforce/shift-templates/${template.planta}`, { entryToleranceAfterMinutes: 12 })).status).toBe(200);
    });

    it("plantilla: sólo cuentan los afectados reales (un fijo DESHABILITADO o vencido no bloquea)", async () => {
      const created = await api(users.stefi, "POST", "/workforce/shift-templates", tpl("PLANTA-05"));
      const id = (created.json!.data as { id: string }).id;
      await holder.shiftAssignment.create({ data: { employeeId: employee.hidden2, shiftTemplateId: id, status: "DESHABILITADO", effectiveFrom: day("2027-01-01") } });
      await holder.shiftAssignment.create({ data: { employeeId: employee.hidden, shiftTemplateId: id, effectiveFrom: day("2025-01-01"), effectiveTo: day("2025-12-31") } });
      expect((await api(users.stefi, "PATCH", `/workforce/shift-templates/${id}`, { entryToleranceAfterMinutes: 15 })).status).toBe(200);
    });

    it("plantilla: borrarla dejaría sin turno una convocatoria futura de un legajo ajeno → 403", async () => {
      const created = await api(users.stefi, "POST", "/workforce/shift-templates", tpl("PLANTA-06"));
      const id = (created.json!.data as { id: string }).id;
      await holder.holidayWorkAssignment.create({ data: { employeeId: employee.hidden2, shiftTemplateId: id, date: day("2027-05-01") } });
      const response = await api(users.stefi, "DELETE", `/workforce/shift-templates/${id}`);
      expect([response.status, response.json!.error!.code]).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
      expect(await holder.shiftTemplate.count({ where: { id } })).toBe(1);
    });

    it("rotación: activar con un miembro ajeno → 403 antes que otras validaciones (RRHH llega a ellas)", async () => {
      const scoped = await api(users.stefi, "POST", `/shifts/rotations/${rotation.planta}/activate`);
      expect([scoped.status, scoped.json!.error!.code]).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
      expect(scoped.text).not.toContain("Oculto");
      expect((await api(users.rrhh, "POST", `/shifts/rotations/${rotation.planta}/activate`)).json!.error!.code).toBe("ROTATION_NOT_READY");
      expect((await holder.shiftRotation.findUniqueOrThrow({ where: { id: rotation.planta } })).status).toBe("INACTIVO");
    });

    it("rotación ACTIVA: desactivar, versionar o cambiar el estado de un equipo con un miembro ajeno → 403 sin cambios", async () => {
      await holder.shiftRotation.update({ where: { id: rotation.planta }, data: { status: "ACTIVO" } });
      try {
        const crew = await holder.shiftRotationCrew.findFirstOrThrow({ where: { rotationId: rotation.planta } });
        for (const [method, path, body] of [
          ["POST", `/shifts/rotations/${rotation.planta}/deactivate`, undefined],
          ["POST", `/shifts/rotations/${rotation.planta}/versions`, { effectiveFrom: "2027-02-01", cycleLengthWeeks: 1, anchorWeekStart: "2027-02-01", days: day7(crew.id, template.planta) }],
          ["PATCH", `/shifts/rotations/${rotation.planta}/crews/${crew.id}`, { status: "INACTIVO" }],
        ] as const) {
          const response = await api(users.stefi, method, path, body);
          expect([response.status, response.json!.error!.code], `${method} ${path}`).toEqual([403, "EMPLOYEE_SCOPE_FORBIDDEN"]);
        }
        expect(await holder.shiftRotationVersion.count({ where: { rotationId: rotation.planta } })).toBe(0);
        expect((await holder.shiftRotationCrew.findUniqueOrThrow({ where: { id: crew.id } })).status).toBe("ACTIVO");
        // Cambios descriptivos siguen siendo sólo de grupo.
        expect((await api(users.stefi, "PATCH", `/shifts/rotations/${rotation.planta}/crews/${crew.id}`, { name: "Equipo A" })).status).toBe(200);
      } finally {
        await holder.shiftRotation.update({ where: { id: rotation.planta }, data: { status: "INACTIVO" } });
      }
    });

    it("rotación: una membresía ajena ya terminada no cuenta como afectada", async () => {
      const own = await holder.shiftRotation.findFirstOrThrow({ where: { code: "ROT-STEFI" }, include: { crews: true } });
      await holder.shiftRotationCrewMember.create({ data: { crewId: own.crews[0]!.id, employeeId: employee.hidden, effectiveFrom: day("2026-01-01"), effectiveTo: day("2026-01-31") } });
      const response = await api(users.stefi, "POST", `/shifts/rotations/${own.id}/activate`);
      // Llega a la validación funcional (membresía ya empezada), no al alcance.
      expect(response.json!.error!.code).toBe("ROTATION_ACTIVATION_RETROACTIVE");
      expect(response.text).not.toContain("Oculto");
    });
  });
  describe("administración de alcances desde Usuarios (R8.4)", () => {
    type UserResponse = { id: string; role: string; status: string; shiftGroups: Array<{ code: string }>; inheritedShiftGroups: Array<{ group: { code: string }; viaSupervisors: Array<{ name: string }> }> };
    const codes = (groups: Array<{ code: string }>) => groups.map((group) => group.code).sort();
    const inherited = (user: UserResponse) => user.inheritedShiftGroups.map((item) => `${item.group.code}<${item.viaSupervisors.map((via) => via.name).sort().join("+")}`).sort();
    const getUser = async (id: string) => (await api(users.rrhh, "GET", `/users/${id}`)).json!.data as UserResponse;
    const me = async (user: AppUser) => (await api(user, "GET", "/auth/me")).json!.data as { shiftGroupAccess: { all: boolean; groupIds: string[] } };
    let gabi: AppUser;

    it("RRHH crea un Nivel 2 con cero grupos y le asigna varios; rigen en la request siguiente y quedan auditados", async () => {
      const created = await api(users.rrhh, "POST", "/users", { name: "Gabi IT", email: "gabi@r8.local", password: "secreto123", role: "NIVEL_2_SUPERVISION", shiftGroupIds: [] });
      expect(created.status, created.text).toBe(201);
      const data = created.json!.data as UserResponse;
      gabi = { id: data.id, email: "gabi@r8.local", role: data.role, name: "Gabi IT" };
      expect([data.shiftGroups, data.inheritedShiftGroups]).toEqual([[], []]);
      expect(await groupCodes(gabi)).toEqual([]);

      const updated = await api(users.rrhh, "PATCH", `/users/${gabi.id}`, { shiftGroupIds: [group.planta, group.oficina] });
      expect(updated.status, updated.text).toBe(200);
      expect(codes((updated.json!.data as UserResponse).shiftGroups)).toEqual(["OFICINA", "PLANTA"]);
      expect(await groupCodes(gabi)).toEqual(["OFICINA", "PLANTA"]);
      expect((await me(gabi)).shiftGroupAccess).toEqual({ all: false, groupIds: [group.oficina, group.planta].sort() });

      const audit = await holder.auditLog.findFirstOrThrow({ where: { entity: "UserShiftGroupScope", entityId: gabi.id }, orderBy: { createdAt: "desc" } });
      expect(audit.userId).toBe(users.rrhh.id);
      expect(audit.before).toEqual({ shiftGroups: [] });
      expect((audit.after as { shiftGroups: Array<{ code: string }> }).shiftGroups.map((item) => item.code)).toEqual(["PLANTA", "OFICINA"]);
      expect(audit.description).not.toContain(group.planta);
      expect((await holder.userShiftGroupScope.findFirstOrThrow({ where: { userId: gabi.id, shiftGroupId: group.planta } })).createdByUserId).toBe(users.rrhh.id);
    });

    it("validaciones: repetidos, inexistentes, rol N1/N3 y alta de N3 con grupos → 400 sin cambios", async () => {
      const duplicated = await api(users.rrhh, "PATCH", `/users/${gabi.id}`, { shiftGroupIds: [group.planta, group.planta] });
      expect([duplicated.status, duplicated.json!.error!.code]).toEqual([400, "VALIDATION_ERROR"]);
      const missing = await api(users.rrhh, "PATCH", `/users/${gabi.id}`, { shiftGroupIds: [group.planta, "00000000-0000-4000-8000-000000000000"] });
      expect([missing.status, missing.json!.error!.code]).toEqual([400, "USER_SHIFT_GROUP_INVALID"]);
      for (const target of [users.rrhh, users.joaquin]) {
        const response = await api(users.rrhh, "PATCH", `/users/${target.id}`, { shiftGroupIds: [group.planta] });
        expect([response.status, response.json!.error!.code]).toEqual([400, "USER_SHIFT_GROUPS_REQUIRE_SUPERVISOR_ROLE"]);
      }
      const n3 = await api(users.rrhh, "POST", "/users", { name: "Nuevo N3", email: "n3nuevo@r8.local", password: "secreto123", role: "NIVEL_3_CARGA_HORARIA", shiftGroupIds: [group.planta] });
      expect(n3.json!.error!.code).toBe("USER_SHIFT_GROUPS_REQUIRE_SUPERVISOR_ROLE");
      expect(codes((await getUser(gabi.id)).shiftGroups)).toEqual(["OFICINA", "PLANTA"]);
      expect(await holder.userShiftGroupScope.count({ where: { userId: users.joaquin.id, shiftGroupId: group.planta } })).toBe(0);
      // Sólo RRHH administra usuarios.
      expect((await api(users.stefi, "PATCH", `/users/${gabi.id}`, { shiftGroupIds: [] })).status).toBe(403);
    });

    it("el Nivel 3 ve los grupos heredados con sus supervisores de origen", async () => {
      expect(inherited(await getUser(users.joaquin.id))).toEqual(["MAQUINARIA<Eugenia IT", "PLANTA<Stefi IT", "TALLER<Eugenia IT"]);
      // Agregar a Joaquín a los supervisados de Gabi suma OFICINA y un segundo origen para PLANTA.
      await api(users.rrhh, "PATCH", `/users/${gabi.id}`, { supervisedUserIds: [users.joaquin.id] });
      expect(inherited(await getUser(users.joaquin.id))).toEqual(["MAQUINARIA<Eugenia IT", "OFICINA<Gabi IT", "PLANTA<Gabi IT+Stefi IT", "TALLER<Eugenia IT"]);
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "OFICINA", "PLANTA", "TALLER"]);
      expect((await me(users.joaquin)).shiftGroupAccess.groupIds).toHaveLength(4);
      // Su propia fila desfasada (fixture) no aparece ni como asignada.
      expect((await getUser(users.joaquin.id)).shiftGroups).toEqual([]);
    });

    it("revocación inmediata: quitar grupos a Gabi corta su acceso y el heredado de Joaquín", async () => {
      await api(users.rrhh, "PATCH", `/users/${gabi.id}`, { shiftGroupIds: [group.planta] });
      expect(await groupCodes(gabi)).toEqual(["PLANTA"]);
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "PLANTA", "TALLER"]);
      expect((await me(gabi)).shiftGroupAccess.groupIds).toEqual([group.planta]);
    });

    it("inactivar a un Nivel 2 conserva sus grupos sin efecto; reactivarlo los restituye", async () => {
      await api(users.rrhh, "PATCH", `/users/${users.eugenia.id}`, { status: "INACTIVO" });
      expect(await holder.userShiftGroupScope.count({ where: { userId: users.eugenia.id } })).toBe(2);
      expect(codes((await getUser(users.eugenia.id)).shiftGroups)).toEqual(["MAQUINARIA", "TALLER"]);
      expect(await groupCodes(users.joaquin)).toEqual(["PLANTA"]);
      expect(inherited(await getUser(users.joaquin.id))).toEqual(["PLANTA<Gabi IT+Stefi IT"]);

      await api(users.rrhh, "PATCH", `/users/${users.eugenia.id}`, { status: "ACTIVO" });
      expect(await groupCodes(users.joaquin)).toEqual(["MAQUINARIA", "PLANTA", "TALLER"]);
    });

    it("un Nivel 2 que pasa a Nivel 3 pierde sus grupos en la misma transacción, auditado", async () => {
      const changed = await api(users.rrhh, "PATCH", `/users/${gabi.id}`, { role: "NIVEL_3_CARGA_HORARIA" });
      expect(changed.status, changed.text).toBe(200);
      expect((changed.json!.data as UserResponse).shiftGroups).toEqual([]);
      expect(await holder.userShiftGroupScope.count({ where: { userId: gabi.id } })).toBe(0);
      const audit = await holder.auditLog.findFirstOrThrow({ where: { entity: "UserShiftGroupScope", entityId: gabi.id, description: { contains: "dejó de ser Nivel 2" } } });
      expect(audit.after).toEqual({ shiftGroups: [] });
      expect(await groupCodes({ ...gabi, role: "NIVEL_3_CARGA_HORARIA" })).toEqual([]);
    });

    it("login y /auth/me exponen shiftGroupAccess (RRHH: todos)", async () => {
      const login = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "gabi@r8.local", password: "secreto123" }) });
      expect(login.status).toBe(200);
      expect(((await login.json()) as { user: { shiftGroupAccess: unknown } }).user.shiftGroupAccess).toEqual({ all: false, groupIds: [] });
      expect((await me(users.rrhh)).shiftGroupAccess).toEqual({ all: true, groupIds: [] });
      expect((await me(users.stefi)).shiftGroupAccess).toEqual({ all: false, groupIds: [group.planta] });
    });

    it("un grupo asignado a responsables (sin turnos ni rotaciones) no se elimina", async () => {
      const solo = await holder.shiftGroup.create({ data: { code: "SOLO", name: "Solo", sortOrder: 90 } });
      await scopeRow(users.stefi, solo.id);
      const removed = await api(users.rrhh, "DELETE", `/shifts/groups/${solo.id}`);
      expect([removed.status, removed.json!.error!.code]).toEqual([409, "SHIFT_GROUP_IN_USE"]);
      expect(removed.json!.error!.message).toContain("responsable");
    });
  });
});
