import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import { positionApiService } from "./positionApiService";

vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

// Etapa 14H.7: getAssignedEmployees() no tenía dedupe/cache frontend (un
// apiRequest crudo) — quedó expuesto al doble-montaje de StrictMode al pasar
// a depender del `id` de la ruta directamente en PuestoDetailPage.tsx (para
// dispararse en paralelo con getById, en vez de esperar a que `position` ya
// estuviera seteado) — confirmado en el journey: 2 requests reales a GET
// /positions/:id/employees dentro de la ventana de "Ver detalle de puesto".
// Mismo patrón ya usado en workRegimeApiService.getWorkRegimeEmployees (14H.2).
describe("positionApiService.getAssignedEmployees — dedupe/cache frontend (Etapa 14H.7)", () => {
  const apiEmployee = {
    id: "employee-1",
    legajo: "100",
    cuil: "20-12345678-9",
    dni: "12345678",
    firstName: "Ana",
    lastName: "Prueba",
    status: "ACTIVO" as const,
    receiptCategory: null,
    internalCategory: null,
    position: { id: "pos-1", name: "Analista", code: "PUE-001" },
    sector: { id: "sector-1", name: "Campo" },
    costCenter: null,
    companies: [],
  };
  const employeesResponse = { data: [apiEmployee] };

  beforeEach(async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(invalidateCacheFamily).mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00.000Z"));
    await clearAllAppCaches("test setup");
  });

  afterEach(async () => {
    await clearAllAppCaches("test teardown");
    vi.useRealTimers();
  });

  it("dos llamadas concurrentes al mismo puesto generan un solo request real (dedupe in-flight — el bug de StrictMode confirmado en el journey)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    const [a, b] = await Promise.all([
      positionApiService.getAssignedEmployees("pos-1"),
      positionApiService.getAssignedEmployees("pos-1"),
    ]);

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada idéntica dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await positionApiService.getAssignedEmployees("pos-1");
    await positionApiService.getAssignedEmployees("pos-1");

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("cambiar de puesto es un cache miss nuevo (id forma parte de la key)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await positionApiService.getAssignedEmployees("pos-1");
    await positionApiService.getAssignedEmployees("pos-2");

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("no cambia el contrato: sigue devolviendo la lista mapeada de empleados", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    const result = await positionApiService.getAssignedEmployees("pos-1");

    expect(result).toEqual([
      expect.objectContaining({ id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Prueba" }),
    ]);
  });

  it.each([
    ["create", () => positionApiService.create({ id: "pos-1", code: "PUE-001", name: "Analista" } as never)],
    ["update", () => positionApiService.update({ id: "pos-1", code: "PUE-001", name: "Analista" } as never)],
    ["removeOrHide", () => positionApiService.removeOrHide("pos-1")],
  ])("%s invalida la familia 'positions'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "pos-1", code: "PUE-001", name: "Analista", status: "ACTIVO", createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" } });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("positions", expect.any(String));
  });

  it("después de invalidar 'positions' (p. ej. tras reasignar un empleado desde Legajos), getAssignedEmployees vuelve a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);
    await positionApiService.getAssignedEmployees("pos-1");
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await invalidateCacheFamily("positions", "unit test");

    await positionApiService.getAssignedEmployees("pos-1");
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
