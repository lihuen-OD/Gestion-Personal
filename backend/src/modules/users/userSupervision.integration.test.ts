/**
 * Alcance Nivel 2 → Nivel 3 (UserSupervisionAssignment) contra PostgreSQL REAL:
 * `employeeAccessWhere` ejecutado por consumidores reales (HTTP /employees,
 * /employees/options, /employees/:id y el resumen de legajos) y el módulo
 * Usuarios por HTTP (validaciones, transacción, auditoría, errores de negocio).
 *
 * Opt-in: sólo corre con `USER_SUPERVISION_IT_DATABASE_URL` → `localhost`, base
 * `clock_it*` PROPIA con el schema de este commit (migraciones aplicadas, nunca
 * `db push`). VACÍA la base al empezar. Nunca usa el DATABASE_URL del .env y
 * verifica `current_database()`.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.USER_SUPERVISION_IT_DATABASE_URL;

vi.mock("../../shared/storage/neonObjectStorage.provider", async () => ({
  neonObjectStorageProvider: (await import("../../shared/testing/inMemoryObjectStorage")).inMemoryObjectStorage.provider,
}));

type AppUser = { id: string; email: string; role: string; name: string };
type Modules = {
  env: typeof import("../../config/env").env;
  prisma: typeof import("../../shared/prisma/client").prisma;
  employees: typeof import("../employees/employees.service").employeesService;
};

describe.skipIf(!url)("Supervisión Nivel 2 → Nivel 3 contra PostgreSQL local", () => {
  let m: Modules;
  let holder: PrismaClient;
  let server: Server;
  let baseUrl: string;
  const employee: Record<string, string> = {};
  let rrhh: AppUser;
  let cargaA: AppUser;
  let cargaB: AppUser;
  let cargaC: AppUser;
  let jefeB: AppUser;
  let jefeC: AppUser;
  let encargado: AppUser;

  const token = (user: AppUser) => jwt.sign({ sub: user.id, email: user.email, role: user.role }, m.env.JWT_ACCESS_SECRET, { expiresIn: "15m" });

  async function api(user: AppUser, method: string, path: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token(user)}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => null) as { data?: unknown; error?: { code: string; message: string } } | null;
    return { status: response.status, json };
  }

  /**
   * Legajos visibles por un consumidor real: GET /employees (RRHH/Nivel 2) o
   * GET /employees/options (los tres roles; es lo que usa Nivel 3).
   */
  async function visibleLegajos(user: AppUser) {
    const path = user.role === "NIVEL_3_CARGA_HORARIA" ? "/employees/options?take=200" : "/employees?take=200";
    const { status, json } = await api(user, "GET", path);
    expect(status).toBe(200);
    return (json!.data as Array<{ legajo: string }>).map((item) => item.legajo).sort();
  }

  /**
   * Cambios hechos directo en la base (no por la API): se limpian las cachés
   * de lectura igual que lo haría el endpoint que escribe esos datos.
   */
  async function clearReadCaches() {
    (await import("../employees/employees.controller")).clearEmployeeReadCaches();
  }

  async function createUser(name: string, role: string) {
    const created = await holder.user.create({ data: { name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`, passwordHash: "x", role: role as never } });
    return { id: created.id, email: created.email, role: created.role, name: created.name };
  }

  const assign = (legajo: string, user: AppUser, data: Record<string, unknown> = {}) =>
    holder.employeeAssignment.create({ data: { employeeId: employee[legajo]!, userId: user.id, type: "TIME_RESPONSIBLE", status: "ACTIVO", ...data } });

  const supervise = (supervisor: AppUser, supervised: AppUser) =>
    holder.userSupervisionAssignment.create({ data: { supervisorUserId: supervisor.id, supervisedUserId: supervised.id } });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("clock_it")) {
      throw new Error("USER_SUPERVISION_IT_DATABASE_URL debe ser localhost/clock_it*.");
    }
    process.env.DATABASE_URL = url;
    delete (globalThis as { prisma?: unknown }).prisma;
    const [{ createApp }, { env }, { prisma }, { employeesService }] = await Promise.all([
      import("../../app"),
      import("../../config/env"),
      import("../../shared/prisma/client"),
      import("../employees/employees.service"),
    ]);
    m = { env, prisma, employees: employeesService };
    const [connected] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
    if (!connected?.db.startsWith("clock_it")) throw new Error(`La app quedó conectada a ${connected?.db}, no a clock_it*: se aborta sin escribir.`);
    holder = new PrismaClient({ datasourceUrl: url });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((table) => `"${table.name}"`).join(", ")}`);

    rrhh = await createUser("RRHH IT", "NIVEL_1_RRHH");
    cargaA = await createUser("CARGA PLANTA", "NIVEL_3_CARGA_HORARIA");
    cargaB = await createUser("CARGA PANOL", "NIVEL_3_CARGA_HORARIA");
    cargaC = await createUser("CARGA OFICINA", "NIVEL_3_CARGA_HORARIA");
    encargado = await createUser("ENCARGADO PLANTA", "NIVEL_2_SUPERVISION");
    jefeB = await createUser("ENCARGADO PANOL", "NIVEL_2_SUPERVISION");
    jefeC = await createUser("ENCARGADO OFICINA", "NIVEL_2_SUPERVISION");

    for (const [index, legajo] of ["A", "B", "C", "D", "E", "F", "G", "H", "X", "OLD"].entries()) {
      const created = await holder.employee.create({ data: { legajo, cuil: `20-8${index}`, dni: `8${index}`, firstName: "Prueba", lastName: `Alcance ${legajo}` } });
      employee[legajo] = created.id;
    }
    // Regla: N2 recibe legajos directos; N3 hereda los de sus N2 ACTIVOS.
    // ENCARGADO PLANTA: A, B, C. ENCARGADO PAÑOL: D, E y C (C está en los dos).
    for (const legajo of ["A", "B", "C"]) await assign(legajo, encargado);
    for (const legajo of ["D", "E", "C"]) await assign(legajo, jefeB);
    // ENCARGADO OFICINA (no supervisa a CARGA PLANTA): X.
    await assign("X", jefeC);
    // Fila directa histórica de un Nivel 3: H. Nunca abre alcance.
    await assign("H", cargaA);
    // Asignaciones de ENCARGADO PLANTA fuera de vigencia: nunca dan alcance.
    await assign("OLD", encargado, { effectiveTo: new Date("2020-01-31T00:00:00.000Z") });
    await assign("G", encargado, { status: "INACTIVO" });
    // CARGA PAÑOL supervisado por ENCARGADO PLANTA (relaciones HTTP más abajo).
    await supervise(encargado, cargaB);

    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${env.API_PREFIX}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await m?.prisma.$disconnect();
    await holder?.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  describe("employeeAccessWhere en consumidores reales", () => {
    it("RRHH ve todos los legajos sin necesitar relaciones", async () => {
      expect(await visibleLegajos(rrhh)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "OLD", "X"]);
    });

    it("Nivel 2 ve sólo sus asignaciones directas vigentes y no hereda de otros", async () => {
      expect(await visibleLegajos(encargado)).toEqual(["A", "B", "C"]);
      expect(await visibleLegajos(jefeC)).toEqual(["X"]);
    });

    it("Nivel 3 sin Nivel 2 que lo supervise no ve nada, aunque tenga una fila directa propia", async () => {
      expect(await visibleLegajos(cargaA)).toEqual([]);
    });

    it("Nivel 3 supervisado por un Nivel 2 hereda sus legajos (no su fila propia)", async () => {
      await supervise(encargado, cargaA);
      await clearReadCaches();
      expect(await visibleLegajos(cargaA)).toEqual(["A", "B", "C"]);
    });

    it("Nivel 3 con dos Nivel 2 ve la unión, con C una sola vez, y nada de un Nivel 2 que no lo supervisa", async () => {
      await supervise(jefeB, cargaA);
      await clearReadCaches();
      const legajos = await visibleLegajos(cargaA);
      expect(legajos).toEqual(["A", "B", "C", "D", "E"]);
      expect(legajos.filter((legajo) => legajo === "C")).toHaveLength(1);
      expect(legajos).not.toContain("X");
      expect(legajos).not.toContain("H");
      const summary = await m.employees.summary({ id: cargaA.id, role: cargaA.role } as Express.AuthUser);
      expect(summary.total).toBe(5);
    });

    it("el detalle de un legajo fuera de alcance responde 404, igual que uno inexistente", async () => {
      expect((await api(encargado, "GET", `/employees/${employee.A}`)).status).toBe(200);
      expect((await api(encargado, "GET", `/employees/${employee.X}`)).status).toBe(404);
    });

    it("es dinámico: agregar F al Nivel 2 lo suma al Nivel 3 y quitarlo lo saca, sin copiar asignaciones", async () => {
      const relationsBefore = await holder.userSupervisionAssignment.count({ where: { supervisedUserId: cargaA.id } });
      const added = await assign("F", encargado);
      await clearReadCaches();
      expect(await visibleLegajos(cargaA)).toContain("F");
      await holder.employeeAssignment.delete({ where: { id: added.id } });
      await clearReadCaches();
      expect(await visibleLegajos(cargaA)).not.toContain("F");
      // Inactivar una asignación del Nivel 2 también la saca del Nivel 3.
      await holder.employeeAssignment.updateMany({ where: { employeeId: employee.B, userId: encargado.id }, data: { status: "INACTIVO" } });
      await clearReadCaches();
      expect(await visibleLegajos(cargaA)).not.toContain("B");
      await holder.employeeAssignment.updateMany({ where: { employeeId: employee.B, userId: encargado.id }, data: { status: "ACTIVO" } });
      await clearReadCaches();
      expect(await holder.userSupervisionAssignment.count({ where: { supervisedUserId: cargaA.id } })).toBe(relationsBefore);
      // El Nivel 3 sigue sin filas propias nuevas (sólo la histórica H).
      expect(await holder.employeeAssignment.count({ where: { userId: cargaA.id } })).toBe(1);
    });

    it("una relación desfasada con un supervisor que ya no es Nivel 2 no transmite alcance", async () => {
      await holder.user.update({ where: { id: jefeB.id }, data: { role: "NIVEL_1_RRHH" } });
      await clearReadCaches();
      expect(await visibleLegajos(cargaA)).toEqual(["A", "B", "C"]);
      await holder.user.update({ where: { id: jefeB.id }, data: { role: "NIVEL_2_SUPERVISION" } });
      await clearReadCaches();
      expect(await visibleLegajos(cargaA)).toEqual(["A", "B", "C", "D", "E"]);
    });
  });

  describe("Usuarios: relaciones y errores de negocio por HTTP", () => {
    it("crea un Nivel 2 con varios Nivel 3, lo devuelve con sus supervisados y audita con nombres (alta válida, 20)", async () => {
      const created = await api(rrhh, "POST", "/users", {
        name: "ENCARGADO DEPOSITO", email: "deposito@example.com", password: "secreto123", role: "NIVEL_2_SUPERVISION", supervisedUserIds: [cargaA.id, cargaC.id],
      });
      expect(created.status).toBe(201);
      const data = created.json!.data as { id: string; supervisedUsers: Array<{ name: string }> };
      expect(data.supervisedUsers.map((user) => user.name)).toEqual(["CARGA OFICINA", "CARGA PLANTA"]);
      expect(JSON.stringify(created.json)).not.toContain("passwordHash");
      const audit = await holder.auditLog.findFirstOrThrow({ where: { entity: "UserSupervisionAssignment", entityId: data.id } });
      expect(audit.description).toContain("ENCARGADO DEPOSITO");
      expect(audit.description).toContain("CARGA PLANTA");
      expect(audit.description).not.toContain(cargaA.id);
      expect(JSON.stringify(await holder.auditLog.findMany({ where: { entityId: data.id } }))).not.toContain("secreto123");
    });

    it("editar quita uno y conserva el resto; la vista del Nivel 2 se actualiza", async () => {
      const deposito = await holder.user.findUniqueOrThrow({ where: { email: "deposito@example.com" } });
      const response = await api(rrhh, "PATCH", `/users/${deposito.id}`, { supervisedUserIds: [cargaA.id] });
      expect(response.status).toBe(200);
      expect(await holder.userSupervisionAssignment.findMany({ where: { supervisorUserId: deposito.id }, select: { supervisedUserId: true } })).toEqual([{ supervisedUserId: cargaA.id }]);
      const audit = await holder.auditLog.findFirstOrThrow({ where: { entity: "UserSupervisionAssignment", entityId: deposito.id, description: { contains: "se quitaron" } } });
      expect(audit.description).toContain("CARGA OFICINA");
    });

    it("un Nivel 3 nunca puede ser supervisor y un Nivel 2 no puede supervisar a otro Nivel 2 (11, 12)", async () => {
      const asCarga = await api(rrhh, "PATCH", `/users/${cargaC.id}`, { supervisedUserIds: [cargaA.id] });
      expect(asCarga).toMatchObject({ status: 400, json: { error: { code: "USER_SUPERVISION_REQUIRES_SUPERVISOR_ROLE" } } });
      const nivel2 = await api(rrhh, "PATCH", `/users/${encargado.id}`, { supervisedUserIds: [cargaA.id, (await holder.user.findUniqueOrThrow({ where: { email: "deposito@example.com" } })).id] });
      expect(nivel2).toMatchObject({ status: 400, json: { error: { code: "USER_SUPERVISION_INVALID_TARGET" } } });
      // Nada cambió: la validación corre antes de escribir.
      expect(await holder.userSupervisionAssignment.count({ where: { supervisorUserId: encargado.id } })).toBe(2);
    });

    it("relaciones duplicadas: la API las rechaza y la base las impide (14)", async () => {
      const duplicated = await api(rrhh, "PATCH", `/users/${encargado.id}`, { supervisedUserIds: [cargaA.id, cargaA.id] });
      expect(duplicated.status).toBe(400);
      await expect(supervise(encargado, cargaA)).rejects.toMatchObject({ code: "P2002" });
      await expect(holder.$executeRawUnsafe(`INSERT INTO "UserSupervisionAssignment" (id, "supervisorUserId", "supervisedUserId") VALUES ('self', '${encargado.id}', '${encargado.id}')`)).rejects.toThrow(/not_self_check/);
    });

    it("cambiar de rol no deja relaciones inválidas, en ambos sentidos (15)", async () => {
      const deposito = await holder.user.findUniqueOrThrow({ where: { email: "deposito@example.com" } });
      // Nivel 2 → Nivel 1: deja de supervisar.
      expect((await api(rrhh, "PATCH", `/users/${deposito.id}`, { role: "NIVEL_1_RRHH" })).status).toBe(200);
      expect(await holder.userSupervisionAssignment.count({ where: { supervisorUserId: deposito.id } })).toBe(0);
      // Nivel 3 supervisado → Nivel 2: deja de estar supervisado y no hereda nada; el Nivel 2 conserva lo suyo.
      expect((await api(rrhh, "PATCH", `/users/${cargaB.id}`, { role: "NIVEL_2_SUPERVISION" })).status).toBe(200);
      expect(await holder.userSupervisionAssignment.count({ where: { supervisedUserId: cargaB.id } })).toBe(0);
      expect(await visibleLegajos({ ...cargaB, role: "NIVEL_2_SUPERVISION" })).toEqual([]);
      expect(await visibleLegajos(encargado)).toEqual(["A", "B", "C"]);
      const audit = await holder.auditLog.findFirstOrThrow({ where: { entity: "UserSupervisionAssignment", entityId: encargado.id, description: { contains: "dejó de ser Nivel 3" } } });
      expect(audit.description).toContain("CARGA PANOL");
    });

    it("empleado ya vinculado: 409 EMPLOYEE_ALREADY_LINKED_TO_USER en alta y edición; mismo empleado o null son válidos (16, 17, 18)", async () => {
      expect((await api(rrhh, "PATCH", `/users/${cargaA.id}`, { employeeId: employee.A })).status).toBe(200);

      const duplicateCreate = await api(rrhh, "POST", "/users", { name: "Otra cuenta", email: "otra@example.com", password: "secreto123", role: "NIVEL_3_CARGA_HORARIA", employeeId: employee.A });
      expect(duplicateCreate).toMatchObject({ status: 409, json: { error: { code: "EMPLOYEE_ALREADY_LINKED_TO_USER", message: "Este empleado ya está vinculado a otro usuario." } } });
      expect(await holder.user.count({ where: { email: "otra@example.com" } })).toBe(0);

      const duplicateUpdate = await api(rrhh, "PATCH", `/users/${cargaC.id}`, { employeeId: employee.A });
      expect(duplicateUpdate).toMatchObject({ status: 409, json: { error: { code: "EMPLOYEE_ALREADY_LINKED_TO_USER" } } });

      expect((await api(rrhh, "PATCH", `/users/${cargaA.id}`, { name: "CARGA PLANTA", employeeId: employee.A })).status).toBe(200);
      expect((await api(rrhh, "PATCH", `/users/${cargaA.id}`, { employeeId: null })).status).toBe(200);
      expect((await holder.user.findUniqueOrThrow({ where: { id: cargaA.id } })).employeeId).toBeNull();
    });

    it("una edición sin contraseña no la exige ni la cambia (19)", async () => {
      const before = await holder.user.findUniqueOrThrow({ where: { id: cargaC.id } });
      const response = await api(rrhh, "PATCH", `/users/${cargaC.id}`, { name: "CARGA OFICINA", email: "carga.oficina@example.com", role: "NIVEL_3_CARGA_HORARIA", status: "ACTIVO", companyId: null, employeeId: null });
      expect(response.status).toBe(200);
      expect((await holder.user.findUniqueOrThrow({ where: { id: cargaC.id } })).passwordHash).toBe(before.passwordHash);
    });
  });

  describe("invalidación inmediata del alcance al cambiar TIME_RESPONSIBLE desde Legajos (sin esperar TTL)", () => {
    let cargaR: AppUser;
    let jefeR: AppUser;
    const legajo = (key: string) => employee[key]!;

    const putAssignments = (key: string, userIds: string[]) => api(rrhh, "PUT", `/employees/${legajo(key)}/assignments`, {
      assignments: userIds.map((userId) => ({ type: "TIME_RESPONSIBLE", userId, status: "ACTIVO" })),
    });
    const detailStatus = async (user: AppUser, key: string) => (await api(user, "GET", `/employees/${legajo(key)}`)).status;
    /**
     * Carga de horas → "Por persona" (GET /time-entries/period-employees):
     * consumidor cacheado por usuario de OTRO módulo, que antes de
     * invalidateEmployeeScopeCaches no se limpiaba al cambiar asignaciones.
     */
    const period = new Date().toISOString().slice(0, 7);
    const hoursLegajos = async (user: AppUser) => {
      const { status, json } = await api(user, "GET", `/time-entries/period-employees?period=${period}&take=100`);
      expect(status).toBe(200);
      return (json!.data as Array<{ employee: { legajo: string } }>).map((item) => item.employee.legajo).sort();
    };

    beforeAll(async () => {
      cargaR = await createUser("CARGA REVOCACION", "NIVEL_3_CARGA_HORARIA");
      jefeR = await createUser("JEFE REVOCACION", "NIVEL_2_SUPERVISION");
      await supervise(jefeR, cargaR);
      for (const [index, key] of ["REV", "ADD", "STALE"].entries()) {
        const created = await holder.employee.create({ data: { legajo: key, cuil: `20-7${index}`, dni: `7${index}`, firstName: "Prueba", lastName: `Cache ${key}` } });
        employee[key] = created.id;
      }
    });

    it("revocación: B (N2) tiene E y supervisa a A (N3); al quitar B→E desde Legajos, la siguiente consulta de ambos ya no lo ve", async () => {
      // B (Nivel 2) recibe E por el write path real.
      expect((await putAssignments("REV", [jefeR.id])).status).toBe(200);
      expect(await visibleLegajos(jefeR)).toEqual(["REV"]);
      expect(await detailStatus(jefeR, "REV")).toBe(200);
      expect(await hoursLegajos(jefeR)).toEqual(["REV"]);
      // A (Nivel 3 supervisado por B) lo hereda en consumidores cacheados.
      expect(await visibleLegajos(cargaR)).toEqual(["REV"]);
      expect(await hoursLegajos(cargaR)).toEqual(["REV"]);
      // Dashboard es sólo de Nivel 1 desde 2026-11-17: Nivel 2 no lo lee por API.
      expect((await api(jefeR, "GET", "/dashboard/metrics")).status).toBe(403);

      // Las respuestas están cacheadas: un cambio hecho directo en la base
      // (sin pasar por la API) todavía no se ve.
      await holder.employeeAssignment.create({ data: { employeeId: legajo("STALE"), userId: jefeR.id, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
      expect(await visibleLegajos(cargaR)).toEqual(["REV"]);
      expect(await hoursLegajos(cargaR)).toEqual(["REV"]);

      // Se quita B→E desde Legajos: sin esperar TTL ni dormir.
      expect((await putAssignments("REV", [])).status).toBe(200);
      expect(await visibleLegajos(cargaR)).toEqual(["STALE"]);
      expect(await hoursLegajos(cargaR)).toEqual(["STALE"]);
      expect(await visibleLegajos(jefeR)).toEqual(["STALE"]);
      expect(await detailStatus(jefeR, "REV")).toBe(404);
    });

    it("incorporación: B no tiene E; al agregar B→E desde Legajos, la siguiente consulta de A lo ve", async () => {
      expect(await visibleLegajos(cargaR)).toEqual(["STALE"]);
      expect(await detailStatus(jefeR, "ADD")).toBe(404);
      expect(await hoursLegajos(cargaR)).toEqual(["STALE"]);

      expect((await putAssignments("ADD", [jefeR.id])).status).toBe(200);

      expect(await visibleLegajos(cargaR)).toEqual(["ADD", "STALE"]);
      expect(await hoursLegajos(cargaR)).toEqual(["ADD", "STALE"]);
      expect(await detailStatus(jefeR, "ADD")).toBe(200);
      expect(await visibleLegajos(jefeR)).toEqual(["ADD", "STALE"]);
    });

    it("el responsable de carga debe ser un Nivel 2 activo: un Nivel 3 o un nombre suelto → 422 sin escribir", async () => {
      const before = await holder.employeeAssignment.count({ where: { employeeId: legajo("ADD") } });
      const asN3 = await putAssignments("ADD", [cargaR.id]);
      expect([asN3.status, asN3.json!.error!.code]).toEqual([422, "TIME_RESPONSIBLE_REQUIRES_N2_USER"]);
      const nameOnly = await api(rrhh, "PUT", `/employees/${legajo("ADD")}/assignments`, { assignments: [{ type: "TIME_RESPONSIBLE", personName: "Wicky Stefania" }] });
      expect([nameOnly.status, nameOnly.json!.error!.code]).toEqual([422, "TIME_RESPONSIBLE_REQUIRES_N2_USER"]);
      expect(await holder.employeeAssignment.count({ where: { employeeId: legajo("ADD") } })).toBe(before);
    });
  });
  describe("Nivel 2 inactivo: deja de transmitir alcance al Nivel 3, sin borrar la relación (invalidación inmediata por /users)", () => {
    let cargaI: AppUser;
    let jefeI: AppUser;
    const period = new Date().toISOString().slice(0, 7);
    const hoursLegajos = async (user: AppUser) => {
      const { status, json } = await api(user, "GET", `/time-entries/period-employees?period=${period}&take=100`);
      expect(status).toBe(200);
      return (json!.data as Array<{ employee: { legajo: string } }>).map((item) => item.employee.legajo).sort();
    };
    const setStatus = async (target: AppUser, status: "ACTIVO" | "INACTIVO") => expect((await api(rrhh, "PATCH", `/users/${target.id}`, { status })).status).toBe(200);

    beforeAll(async () => {
      cargaI = await createUser("CARGA INACTIVABLE", "NIVEL_3_CARGA_HORARIA");
      jefeI = await createUser("JEFE INACTIVABLE", "NIVEL_2_SUPERVISION");
      const created = await holder.employee.create({ data: { legajo: "INA", cuil: "20-60", dni: "60", firstName: "Prueba", lastName: "Inactivo INA" } });
      employee.INA = created.id;
      await assign("INA", jefeI);
      await supervise(jefeI, cargaI);
      await clearReadCaches();
    });

    it("ACTIVO → INACTIVO → ACTIVO: el Nivel 3 pierde y recupera los legajos heredados en la consulta siguiente; la relación se conserva", async () => {
      expect(await visibleLegajos(cargaI)).toEqual(["INA"]);
      expect(await hoursLegajos(cargaI)).toEqual(["INA"]);

      await setStatus(jefeI, "INACTIVO");
      expect(await visibleLegajos(cargaI)).toEqual([]);
      expect(await hoursLegajos(cargaI)).toEqual([]);
      expect(await holder.userSupervisionAssignment.count({ where: { supervisorUserId: jefeI.id, supervisedUserId: cargaI.id } })).toBe(1);
      expect(await visibleLegajos(rrhh)).toEqual(expect.arrayContaining(["INA"]));

      await setStatus(jefeI, "ACTIVO");
      expect(await visibleLegajos(cargaI)).toEqual(["INA"]);
      expect(await hoursLegajos(cargaI)).toEqual(["INA"]);
    });

    it("relación existente con un supervisor que ya no tiene rol Nivel 2 (aunque esté ACTIVO): no hereda", async () => {
      await holder.user.update({ where: { id: jefeI.id }, data: { role: "NIVEL_1_RRHH" } });
      await clearReadCaches();
      expect(await visibleLegajos(cargaI)).toEqual([]);
      await holder.user.update({ where: { id: jefeI.id }, data: { role: "NIVEL_2_SUPERVISION" } });
      await clearReadCaches();
      expect(await visibleLegajos(cargaI)).toEqual(["INA"]);
    });
  });
});
