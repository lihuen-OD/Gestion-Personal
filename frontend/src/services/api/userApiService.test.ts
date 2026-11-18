import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { orgStructureApiService } from "./orgStructureApiService";
import { userApiService } from "./userApiService";
import type { User } from "../../types";

vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});
vi.mock("./orgStructureApiService", () => ({ orgStructureApiService: { getCatalog: vi.fn() } }));

const apiUser = {
  id: "n2", name: "ENCARGADO PLANTA", email: "jefe@test.com", role: "NIVEL_2_SUPERVISION", status: "ACTIVO", employeeId: null,
  supervisedUsers: [{ id: "n3-a", name: "CARGA PLANTA", email: "planta@test.com", role: "NIVEL_3_CARGA_HORARIA", status: "ACTIVO" }],
  supervisorUsers: [],
};

const draft = (overrides: Partial<User> = {}): User => ({
  id: "n2", name: "ENCARGADO PLANTA", email: "jefe@test.com", password: "", role: "Nivel 2 - Supervisión / Gestión", status: "Activo",
  company: "", employeeId: "", supervisedUserIds: ["n3-a", "n3-b"], ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ companies: [] } as never);
  vi.mocked(apiRequest).mockResolvedValue({ data: apiUser });
});

describe("userApiService — supervisión Nivel 2 → Nivel 3", () => {
  it("mapea los supervisados con nombre, email y estado legibles", async () => {
    const user = await userApiService.getById("n2");
    expect(user.supervisedUserIds).toEqual(["n3-a"]);
    expect(user.supervisedUsers).toEqual([{ id: "n3-a", name: "CARGA PLANTA", email: "planta@test.com", status: "Activo" }]);
  });

  it("un Nivel 2 envía la lista completa en alta y edición", async () => {
    await userApiService.update(draft());
    expect(vi.mocked(apiRequest).mock.calls[0]![1]).toMatchObject({ method: "PATCH", body: { supervisedUserIds: ["n3-a", "n3-b"] } });
    await userApiService.create(draft({ supervisedUserIds: [] }));
    expect(vi.mocked(apiRequest).mock.calls[1]![1]).toMatchObject({ method: "POST", body: { supervisedUserIds: [] } });
  });

  it("otro rol no envía supervisados (el backend limpia las relaciones al cambiar de rol)", async () => {
    await userApiService.update(draft({ role: "Nivel 1 - RRHH" }));
    expect(vi.mocked(apiRequest).mock.calls[0]![1]!.body).not.toHaveProperty("supervisedUserIds");
  });

  it("la edición nunca manda contraseña en el PATCH", async () => {
    await userApiService.update(draft({ password: "nueva-clave-1" }));
    expect(vi.mocked(apiRequest).mock.calls[0]![1]!.body).not.toHaveProperty("password");
  });
});
