/**
 * R3.1: permisos y validación de las rutas de grupos de turnos con el router
 * real (`shiftsRouter`). Lectura: los 3 roles operativos; escritura: sólo
 * RRHH. Los handlers están mockeados: acá se prueba el ruteo, no el servicio.
 */
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../shared/errors/AppError";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));
vi.mock("../../middlewares/auth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "user-1", email: "user@example.com", name: "Usuario", role: req.header("x-test-role") as never };
    next();
  },
}));
const handled = vi.fn();
vi.mock("./shiftGroup.controller", () => {
  const handler = (name: string) => (req: express.Request, res: express.Response) => {
    handled(name, req.body, req.query);
    res.json({ data: name });
  };
  return { shiftGroupController: { list: handler("list"), create: handler("create"), update: handler("update"), remove: handler("remove") } };
});

const GROUP_ID = "0b6f3f8e-8c1a-4a77-9d3b-2d6f2f1b9a10";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { shiftsRouter } = await import("./shifts.routes");
  const app = express();
  app.use(express.json());
  app.use("/api/shifts", shiftsRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof AppError ? error.statusCode : 500;
    res.status(status).json({ code: error instanceof AppError ? error.code : "INTERNAL" });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => {
  server?.close();
});
beforeEach(() => handled.mockClear());

async function call(method: string, path: string, role: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/shifts${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as { data?: string; code?: string } };
}

const ROLES = ["NIVEL_1_RRHH", "NIVEL_2_SUPERVISION", "NIVEL_3_CARGA_HORARIA"];

describe("GET /groups", () => {
  it.each(ROLES)("%s puede listar", async (role) => {
    expect((await call("GET", "/groups", role)).status).toBe(200);
  });

  it("valida el filtro de estado", async () => {
    expect((await call("GET", "/groups?status=BORRADO", "NIVEL_1_RRHH")).status).toBe(400);
    expect(handled).not.toHaveBeenCalled();
  });
});

describe("escritura sólo RRHH", () => {
  const writes = [
    ["POST", "/groups", { code: "PLANTA", name: "Planta" }],
    ["PATCH", `/groups/${GROUP_ID}`, { status: "INACTIVO" }],
    ["DELETE", `/groups/${GROUP_ID}`, undefined],
  ] as const;

  it.each(writes)("%s %s → 200 para RRHH", async (method, path, body) => {
    expect((await call(method, path, "NIVEL_1_RRHH", body)).status).toBe(200);
  });

  it.each(writes.flatMap(([method, path, body]) => ["NIVEL_2_SUPERVISION", "NIVEL_3_CARGA_HORARIA"].map((role) => [method, path, body, role] as const)))(
    "%s %s → 403 para %s",
    async (method, path, body, role) => {
      const response = await call(method, path, role, body);
      expect(response).toEqual({ status: 403, body: { code: "FORBIDDEN" } });
      expect(handled).not.toHaveBeenCalled();
    },
  );
});

describe("validación del body", () => {
  it("POST normaliza código y nombre antes del handler", async () => {
    await call("POST", "/groups", "NIVEL_1_RRHH", { code: "  MA ", name: " Medio   Ambiente " });
    expect(handled).toHaveBeenCalledWith("create", { code: "MA", name: "Medio Ambiente", sortOrder: 0 }, expect.anything());
  });

  it.each([
    ["POST", "/groups", { code: "P", name: "Planta" }],
    ["POST", "/groups", { code: "PLANTA" }],
    ["PATCH", `/groups/${GROUP_ID}`, {}],
    ["PATCH", `/groups/${GROUP_ID}`, { sortOrder: -3 }],
  ] as const)("%s %s con body inválido → 400", async (method, path, body) => {
    expect((await call(method, path, "NIVEL_1_RRHH", body)).status).toBe(400);
    expect(handled).not.toHaveBeenCalled();
  });
});
