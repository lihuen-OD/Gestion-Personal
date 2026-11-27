import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, formatApiErrorMessage } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import { shiftGroupApiService } from "./shiftGroupApiService";
import { workforceApiService } from "./workforceApiService";

vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});
vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

const request = vi.mocked(apiRequest);

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllAppCaches("test");
});

describe("shiftGroupApiService", () => {
  it("list: GET /shifts/groups con dedupe y caché (familia workforce-config)", async () => {
    request.mockResolvedValue({ data: [] });
    await Promise.all([shiftGroupApiService.list(), shiftGroupApiService.list()]);
    await shiftGroupApiService.list();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/shifts/groups", { apiCache: false });
  });

  it.each([
    ["create", () => shiftGroupApiService.create({ code: "PLANTA", name: "Planta", sortOrder: 10 }), "/shifts/groups", { method: "POST", body: { code: "PLANTA", name: "Planta", sortOrder: 10 }, silentErrors: true }],
    ["update", () => shiftGroupApiService.update("g1", { status: "INACTIVO" }), "/shifts/groups/g1", { method: "PATCH", body: { status: "INACTIVO" }, silentErrors: true }],
    ["remove", () => shiftGroupApiService.remove("g1"), "/shifts/groups/g1", { method: "DELETE", silentErrors: true }],
  ] as const)("%s: llama al endpoint sin aviso global e invalida workforce-config", async (_name, call, path, options) => {
    request.mockResolvedValue({ data: { id: "g1" } });
    await call();
    expect(request).toHaveBeenCalledWith(path, options);
    expect(invalidateCacheFamily).toHaveBeenCalledWith("workforce-config", expect.any(String));
  });

  it("caché: crear un grupo hace que el catálogo de turnos (que trae el grupo) se vuelva a pedir", async () => {
    request.mockResolvedValue({ data: [] });
    await workforceApiService.shiftTemplates();
    await workforceApiService.shiftTemplates();
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ data: { id: "g1" } });
    await shiftGroupApiService.create({ code: "PLANTA", name: "Planta", sortOrder: 10 });
    await workforceApiService.shiftTemplates();
    expect(request).toHaveBeenLastCalledWith("/workforce/shift-templates", { apiCache: false });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("caché: asignar grupo a un turno vuelve a pedir el catálogo de grupos (cantidad de turnos)", async () => {
    request.mockResolvedValue({ data: [] });
    await shiftGroupApiService.list();
    request.mockResolvedValueOnce({ data: { id: "t1" } });
    await workforceApiService.updateShiftTemplate("t1", { shiftGroupId: "g1" });
    await shiftGroupApiService.list();
    expect(request).toHaveBeenLastCalledWith("/shifts/groups", { apiCache: false });
  });
});

describe("mensajes de error al usuario (sin códigos internos)", () => {
  it.each([
    ["SHIFT_GROUP_DUPLICATE", "Ya existe un grupo con ese código o nombre."],
    ["SHIFT_GROUP_IN_USE", "Este grupo tiene turnos asociados. Podés inactivarlo, pero no eliminarlo."],
    ["SHIFT_GROUP_INACTIVE", "El grupo elegido está inactivo: no se le pueden asociar turnos nuevos. Elegí un grupo activo o «Sin grupo»."],
  ])("%s → mensaje humano", (code, message) => {
    const formatted = formatApiErrorMessage({ error: { code, message: "Texto del backend 0b6f3f8e-8c1a-4a77-9d3b-2d6f2f1b9a10" } });
    expect(formatted).toBe(message);
    expect(formatted).not.toMatch(/SHIFT_GROUP|[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
