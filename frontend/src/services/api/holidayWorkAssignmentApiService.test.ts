import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import { holidayWorkAssignmentApiService } from "./holidayWorkAssignmentApiService";

// Etapa 14H.4: sólo el describe de más abajo (getHolidayDates) usa
// `apiRequest` de verdad — este servicio no tenía ningún test previo.
vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

// Etapa 14H.4: getHolidayDates() no tenía dedupe/cache frontend -- el
// journey 14H.1/14H.3 confirmó 2 requests duplicadas (StrictMode) al entrar
// a Asignaciones de feriados. Mismo patrón ya usado 9+ veces en las series
// 14G/14H.
describe("holidayWorkAssignmentApiService.getHolidayDates — dedupe/cache frontend (Etapa 14H.4)", () => {
  const datesResponse = { data: [{ date: "2026-12-25", rules: [{ id: "rule-1", name: "Navidad" }] }] };

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

  it("dos llamadas concurrentes con el mismo rango generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(datesResponse);

    const [a, b] = await Promise.all([
      holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31"),
      holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31"),
    ]);

    expect(a).toEqual(datesResponse.data);
    expect(b).toEqual(datesResponse.data);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(datesResponse);

    await holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31");
    await holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31");

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("cambiar de mes (from/to) es un cache miss nuevo", async () => {
    vi.mocked(apiRequest).mockResolvedValue(datesResponse);

    await holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31");
    await holidayWorkAssignmentApiService.getHolidayDates("2027-01-01", "2027-01-31");

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("no cambia el contrato: sigue devolviendo el array de HolidayDate sin envolver", async () => {
    vi.mocked(apiRequest).mockResolvedValue(datesResponse);

    const result = await holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31");

    expect(result).toEqual(datesResponse.data);
  });

  // Etapa 14H.3: workforceApiService.createDoubleHourRule/updateDoubleHourRule/
  // removeDoubleHourRule ya invalidan "workforce-config" -- getHolidayDates()
  // comparte esa misma familia a propósito (§ arriba), así que se invalida
  // sola sin código nuevo en este servicio. Este test confirma esa
  // integración entre los dos servicios, no reimplementa la invalidación.
  it("al invalidar 'workforce-config' (p. ej. tras editar una regla de Horas Especiales), getHolidayDates vuelve a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue(datesResponse);
    await holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31");
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await invalidateCacheFamily("workforce-config", "unit test");

    await holidayWorkAssignmentApiService.getHolidayDates("2026-12-01", "2026-12-31");
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("guardar una convocatoria (saveAssignments) NO invalida 'workforce-config' -- las fechas de feriado no cambian por convocar gente", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    await holidayWorkAssignmentApiService.saveAssignments("2026-12-25", [{ employeeId: "employee-1", status: "ACTIVA" }]);

    expect(invalidateCacheFamily).not.toHaveBeenCalled();
  });
});
