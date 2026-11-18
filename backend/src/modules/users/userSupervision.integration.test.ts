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

    for (const [index, legajo] of ["A", "B", "C", "D", "E", "F", "G", "H", "X", "OLD"].entries()) {
      const created = await holder.employee.create({ data: { legajo, cuil: `20-8${index}`, dni: `8${index}`, firstName: "Prueba", lastName: `Alcance ${legajo}` } });
      employee[legajo] = created.id;
    }
    // CARGA PLANTA: A, B, C. CARGA PAÑOL: D, E y C (C está en los dos).
    for (const legajo of ["A", "B", "C"]) await assign(legajo, cargaA);
    for (const legajo of ["D", "E", "C"]) await assign(legajo, cargaB);
    // CARGA OFICINA (no supervisado): X.
    await assign("X", cargaC);
    // Asignación directa histórica del Nivel 2 (compatibilidad): H.
    await assign("H", encargado);
    // Asignaciones de A fuera de vigencia: nunca dan alcance.
    await assign("OLD", cargaA, { effectiveTo: new Date("2020-01-31T00:00:00.000Z") });
    await assign("G", cargaA, { status: "INACTIVO" });

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
    it("RRHH ve todos los legajos sin necesitar relaciones (1, 13)", async () => {
      expect(await visibleLegajos(rrhh)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "OLD", "X"]);
    });

    it("Nivel 3 ve sólo sus asignaciones vigentes y no hereda las de otros Nivel 3 (2, 10)", async () => {
      expect(await visibleLegajos(cargaA)).toEqual(["A", "B", "C"]);
      expect(await visibleLegajos(cargaC)).toEqual(["X"]);
    });

    it("Nivel 2 sin supervisados conserva sólo sus asignaciones directas (8)", async () => {
      expect(await visibleLegajos(encargado)).toEqual(["H"]);
    });

    it("Nivel 2 que supervisa A ve los legajos de A más los directos (3, 8)", async () => {
      await supervise(encargado, cargaA);
      await clearReadCaches();
      expect(await visibleLegajos(encargado)).toEqual(["A", "B", "C", "H"]);
    });

    it("Nivel 2 que supervisa A y B ve la unión, con C una sola vez, y nada de un Nivel 3 no supervisado (4, 5, 9)", async () => {
      await supervise(encargado, cargaB);
      await clearReadCaches();
      const legajos = await visibleLegajos(encargado);
      expect(legajos).toEqual(["A", "B", "C", "D", "E", "H"]);
      expect(legajos.filter((legajo) => legajo === "C")).toHaveLength(1);
      expect(legajos).not.toContain("X");
      const summary = await m.employees.summary({ id: encargado.id, role: encargado.role } as Express.AuthUser);
      expect(summary.total).toBe(6);
      const options = await api(encargado, "GET", "/employees/options?take=200");
      expect((options.json!.data as unknown[]).length).toBe(6);
    });

    it("el detalle de un legajo fuera de alcance responde 404, igual que uno inexistente (9)", async () => {
      expect((await api(encargado, "GET", `/employees/${employee.A}`)).status).toBe(200);
      expect((await api(encargado, "GET", `/employees/${employee.X}`)).status).toBe(404);
    });

    it("es dinámico: agregar F a A lo suma al Nivel 2 y quitarlo lo saca, sin tocar al Nivel 2 (6, 7)", async () => {
      const relationsBefore = await holder.userSupervisionAssignment.count({ where: { supervisorUserId: encargado.id } });
      const added = await assign("F", cargaA);
      await clearReadCaches();
      expect(await visibleLegajos(encargado)).toContain("F");
      await holder.employeeAssignment.delete({ where: { id: added.id } });
      await clearReadCaches();
      expect(await visibleLegajos(encargado)).not.toContain("F");
      // Quitar una asignación vigente de A también la saca del Nivel 2.
      await holder.employeeAssignment.updateMany({ where: { employeeId: employee.B, userId: cargaA.id }, data: { status: "INACTIVO" } });
      await clearReadCaches();
      expect(await visibleLegajos(encargado)).not.toContain("B");
      await holder.employeeAssignment.updateMany({ where: { employeeId: employee.B, userId: cargaA.id }, data: { status: "ACTIVO" } });
      await clearReadCaches();
      expect(await holder.userSupervisionAssignment.count({ where: { supervisorUserId: encargado.id } })).toBe(relationsBefore);
      expect(await holder.employeeAssignment.count({ where: { userId: encargado.id } })).toBe(1);
    });

    it("una relación desfasada con un supervisado que ya no es Nivel 3 no abre alcance", async () => {
      await holder.user.update({ where: { id: cargaB.id }, data: { role: "NIVEL_1_RRHH" } });
      await clearReadCaches();
      expect(await visibleLegajos(encargado)).toEqual(["A", "B", "C", "H"]);
      await holder.user.update({ where: { id: cargaB.id }, data: { role: "NIVEL_3_CARGA_HORARIA" } });
      await clearReadCaches();
      expect(await visibleLegajos(encargado)).toEqual(["A", "B", "C", "D", "E", "H"]);
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
      // Nivel 3 supervisado → Nivel 2: deja de estar supervisado; el Nivel 2 pierde ese alcance.
      expect((await api(rrhh, "PATCH", `/users/${cargaB.id}`, { role: "NIVEL_2_SUPERVISION" })).status).toBe(200);
      expect(await holder.userSupervisionAssignment.count({ where: { supervisedUserId: cargaB.id } })).toBe(0);
      expect(await visibleLegajos(encargado)).toEqual(["A", "B", "C", "H"]);
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

    it("revocación: B supervisa A, A tiene E; al quitar A→E desde Legajos, la siguiente consulta de B ya no lo ve", async () => {
      // A (Nivel 3) recibe E por el write path real.
      expect((await putAssignments("REV", [cargaR.id])).status).toBe(200);
      // B (Nivel 2 que supervisa A) ve E en consumidores cacheados.
      expect(await visibleLegajos(jefeR)).toEqual(["REV"]);
      expect(await detailStatus(jefeR, "REV")).toBe(200);
      expect(await hoursLegajos(jefeR)).toEqual(["REV"]);
      // Dashboard es sólo de Nivel 1 desde 2026-11-17: Nivel 2 no lo lee por API.
      expect((await api(jefeR, "GET", "/dashboard/metrics")).status).toBe(403);

      // Las respuestas están cacheadas: un cambio hecho directo en la base
      // (sin pasar por la API) todavía no se ve.
      await holder.employeeAssignment.create({ data: { employeeId: legajo("STALE"), userId: cargaR.id, type: "TIME_RESPONSIBLE", status: "ACTIVO" } });
      expect(await visibleLegajos(jefeR)).toEqual(["REV"]);
      expect(await hoursLegajos(jefeR)).toEqual(["REV"]);

      // Se quita A→E desde Legajos: sin esperar TTL ni dormir.
      expect((await putAssignments("REV", [])).status).toBe(200);
      expect(await visibleLegajos(jefeR)).toEqual(["STALE"]);
      expect(await detailStatus(jefeR, "REV")).toBe(404);
      expect(await hoursLegajos(jefeR)).toEqual(["STALE"]);
      // También el responsable directo.
      expect(await visibleLegajos(cargaR)).toEqual(["STALE"]);
    });

    it("incorporación: A no tiene E; al agregar A→E desde Legajos, la siguiente consulta de B lo ve", async () => {
      // B ya tiene su listado y su detalle de E (404) cacheados.
      expect(await visibleLegajos(jefeR)).toEqual(["STALE"]);
      expect(await detailStatus(jefeR, "ADD")).toBe(404);
      expect(await hoursLegajos(jefeR)).toEqual(["STALE"]);

      expect((await putAssignments("ADD", [cargaR.id])).status).toBe(200);

      expect(await visibleLegajos(jefeR)).toEqual(["ADD", "STALE"]);
      expect(await detailStatus(jefeR, "ADD")).toBe(200);
      expect(await hoursLegajos(jefeR)).toEqual(["ADD", "STALE"]);
      expect(await visibleLegajos(cargaR)).toEqual(["ADD", "STALE"]);
    });
  });
  describe("Nivel 3 inactivo: deja de transmitir alcance al Nivel 2, sin borrar la relación (invalidación inmediata por /users)", () => {
    let cargaI: AppUser;
    let jefeI: AppUser;
    const period = new Date().toISOString().slice(0, 7);
    const hoursLegajos = async (user: AppUser) => {
      const { status, json } = await api(user, "GET", `/time-entries/period-employees?period=${period}&take=100`);
      expect(status).toBe(200);
      return (json!.data as Array<{ employee: { legajo: string } }>).map((item) => item.employee.legajo).sort();
    };
    const detailStatus = async (user: AppUser, key: string) => (await api(user, "GET", `/employees/${employee[key]}`)).status;
    const setStatus = async (target: AppUser, status: "ACTIVO" | "INACTIVO") => expect((await api(rrhh, "PATCH", `/users/${target.id}`, { status })).status).toBe(200);

    beforeAll(async () => {
      cargaI = await createUser("CARGA INACTIVABLE", "NIVEL_3_CARGA_HORARIA");
      jefeI = await createUser("JEFE INACTIVABLE", "NIVEL_2_SUPERVISION");
      for (const [index, key] of ["INA", "DIRI"].entries()) {
        const created = await holder.employee.create({ data: { legajo: key, cuil: `20-6${index}`, dni: `6${index}`, firstName: "Prueba", lastName: `Inactivo ${key}` } });
        employee[key] = created.id;
      }
      await assign("INA", cargaI);
      await assign("DIRI", jefeI);
      await supervise(jefeI, cargaI);
      await clearReadCaches();
    });

    it("ACTIVO → INACTIVO → ACTIVO: el Nivel 2 pierde y recupera los legajos heredados en la consulta siguiente; sus directos no cambian; la relación se conserva (1, 2, 3, 5, 8)", async () => {
      // (1) Nivel 3 activo: el Nivel 2 hereda INA y conserva su directo DIRI (respuestas quedan cacheadas).
      expect(await visibleLegajos(jefeI)).toEqual(["DIRI", "INA"]);
      expect(await detailStatus(jefeI, "INA")).toBe(200);
      expect(await hoursLegajos(jefeI)).toEqual(["DIRI", "INA"]);
      // (6) El Nivel 3 ve su propio alcance directo.
      expect(await visibleLegajos(cargaI)).toEqual(["INA"]);

      // (2, 8) Se inactiva por el write path real: sin esperar TTL.
      await setStatus(cargaI, "INACTIVO");
      expect(await visibleLegajos(jefeI)).toEqual(["DIRI"]);
      expect(await detailStatus(jefeI, "INA")).toBe(404);
      expect(await hoursLegajos(jefeI)).toEqual(["DIRI"]);
      // La relación no se borra al inactivar.
      expect(await holder.userSupervisionAssignment.count({ where: { supervisorUserId: jefeI.id, supervisedUserId: cargaI.id } })).toBe(1);
      // RRHH sigue global (7).
      expect(await visibleLegajos(rrhh)).toEqual(expect.arrayContaining(["DIRI", "INA"]));

      // (3, 8) Se reactiva: vuelve a heredar en la consulta siguiente.
      await setStatus(cargaI, "ACTIVO");
      expect(await visibleLegajos(jefeI)).toEqual(["DIRI", "INA"]);
      expect(await detailStatus(jefeI, "INA")).toBe(200);
      expect(await hoursLegajos(jefeI)).toEqual(["DIRI", "INA"]);
    });

    it("relación existente con un supervisado que ya no tiene rol Nivel 3 (aunque esté ACTIVO): no hereda (4)", async () => {
      await holder.user.update({ where: { id: cargaI.id }, data: { role: "NIVEL_1_RRHH" } });
      await clearReadCaches();
      expect(await visibleLegajos(jefeI)).toEqual(["DIRI"]);
      await holder.user.update({ where: { id: cargaI.id }, data: { role: "NIVEL_3_CARGA_HORARIA" } });
      await clearReadCaches();
      expect(await visibleLegajos(jefeI)).toEqual(["DIRI", "INA"]);
    });
  });
});
