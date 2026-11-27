/**
 * R3.1: toda escritura de un grupo invalida el catálogo de plantillas (caché
 * backend de workforce.cache.ts), que incluye código, nombre, orden y estado
 * del grupo de cada plantilla. La lectura de grupos no toca esa caché.
 */
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftTemplatesCache } from "../workforce-management/workforce.cache";
import { shiftGroupController } from "./shiftGroup.controller";

vi.mock("../../shared/prisma/client", () => ({ prisma: {} }));
vi.mock("./shiftGroup.service", () => ({
  shiftGroupService: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "g1" }),
    update: vi.fn().mockResolvedValue({ id: "g1" }),
    remove: vi.fn().mockResolvedValue({ id: "g1" }),
  },
}));

const req = (overrides: Partial<Request> = {}) => ({ params: { id: "g1" }, body: {}, query: {}, user: { id: "u1", role: "NIVEL_1_RRHH" }, headers: {}, get: () => undefined, ip: "127.0.0.1", ...overrides }) as unknown as Request;
const res = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};
const CACHED = [{ id: "template-1", shiftGroup: { id: "g1", name: "Nombre viejo" } }] as never;

beforeEach(() => {
  shiftTemplatesCache.clear();
  shiftTemplatesCache.set("catalog", CACHED);
});

describe("invalidación del catálogo de plantillas", () => {
  it.each(["create", "update", "remove"] as const)("%s vacía la caché", async (action) => {
    await shiftGroupController[action](req(), res());
    expect(shiftTemplatesCache.get("catalog")).toBeUndefined();
  });

  it("list no la toca", async () => {
    await shiftGroupController.list(req(), res());
    expect(shiftTemplatesCache.get("catalog")).toBe(CACHED);
  });
});
