import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import {
  extendedShiftAlertHoursToMinutes,
  extendedShiftAlertMinutesToHours,
  mapAssignmentFromApi,
  mapWorkRegimeEmployeeAssociationFromApi,
  mapWorkRegimeFromApi,
  workRegimeApiService,
} from "./workRegimeApiService";

// Etapa 14H.2: sólo los describe blocks de más abajo (getWorkRegimeEmployees/
// assign/updateAssignment/closeAssignment) usan `apiRequest` de verdad — el
// resto de este archivo (mapeo puro) nunca lo invoca, así que mockearlo acá
// no afecta a ningún test preexistente (mismo criterio ya usado en
// timeEntryApiService.test.ts/attendanceApiService.test.ts, 14G.9).
vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

const apiRegime = {
  id: "regime-1",
  code: "CAMPANA",
  name: "Campaña",
  kind: "TURNO_FLEXIBLE" as const,
  alertOnOutOfShift: false,
  openShiftOverflowAction: "ALERT_ONLY" as const,
  extendedShiftAlertMinutes: null,
  description: null,
  status: "ACTIVO" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("mapWorkRegimeFromApi", () => {
  it("preserves every field from the backend response", () => {
    const regime = mapWorkRegimeFromApi(apiRegime);
    expect(regime).toEqual({
      id: "regime-1",
      code: "CAMPANA",
      name: "Campaña",
      kind: "TURNO_FLEXIBLE",
      alertOnOutOfShift: false,
      openShiftOverflowAction: "ALERT_ONLY",
      extendedShiftAlertMinutes: null,
      description: null,
      status: "ACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("defaults a missing description to null instead of undefined", () => {
    const { description: _omitted, ...withoutDescription } = apiRegime;
    const regime = mapWorkRegimeFromApi(withoutDescription as typeof apiRegime);
    expect(regime.description).toBeNull();
  });

  it("Etapa 10D — preserva extendedShiftAlertMinutes cuando el backend lo manda", () => {
    const regime = mapWorkRegimeFromApi({ ...apiRegime, extendedShiftAlertMinutes: 900 });
    expect(regime.extendedShiftAlertMinutes).toBe(900);
  });

  it("Etapa 10D — extendedShiftAlertMinutes ausente se normaliza a null, no a undefined", () => {
    const { extendedShiftAlertMinutes: _omitted, ...withoutField } = apiRegime;
    const regime = mapWorkRegimeFromApi(withoutField as typeof apiRegime);
    expect(regime.extendedShiftAlertMinutes).toBeNull();
  });
});

describe("extendedShiftAlertMinutesToHours / extendedShiftAlertHoursToMinutes — Etapa 10D (UI en horas, backend en minutos)", () => {
  it("convierte minutos a horas enteras (redondeando)", () => {
    expect(extendedShiftAlertMinutesToHours(900)).toBe(15);
    expect(extendedShiftAlertMinutesToHours(90)).toBe(2); // redondea 1.5 -> 2
  });

  it("null se muestra como campo vacío en la UI, nunca como 0", () => {
    expect(extendedShiftAlertMinutesToHours(null)).toBe("");
  });

  it("0 minutos se muestra como 0 horas, no como vacío (0 explícito != sin configurar)", () => {
    expect(extendedShiftAlertMinutesToHours(0)).toBe(0);
  });

  it("convierte horas a minutos al guardar", () => {
    expect(extendedShiftAlertHoursToMinutes(15)).toBe(900);
    expect(extendedShiftAlertHoursToMinutes(0)).toBe(0);
  });

  it("campo vacío se guarda como null, nunca se coacciona a 0", () => {
    expect(extendedShiftAlertHoursToMinutes("")).toBeNull();
  });

  it("round-trip: convertir minutos a horas y de vuelta a minutos no pierde el valor (para horas enteras)", () => {
    const originalMinutes = 720;
    const hours = extendedShiftAlertMinutesToHours(originalMinutes);
    expect(extendedShiftAlertHoursToMinutes(hours)).toBe(originalMinutes);
  });
});

describe("mapAssignmentFromApi", () => {
  it("maps a closed assignment (effectiveTo set) including the nested work regime", () => {
    const assignment = mapAssignmentFromApi({
      id: "assignment-1",
      employeeId: "employee-1",
      workRegimeId: "regime-1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-06-30T00:00:00.000Z",
      assignedByUserId: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      workRegime: apiRegime,
    });

    expect(assignment.effectiveTo).toBe("2026-06-30T00:00:00.000Z");
    expect(assignment.workRegime.code).toBe("CAMPANA");
  });

  it("maps an open-ended assignment (no effectiveTo) to null, not undefined", () => {
    const assignment = mapAssignmentFromApi({
      id: "assignment-2",
      employeeId: "employee-1",
      workRegimeId: "regime-1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      workRegime: apiRegime,
    });

    expect(assignment.effectiveTo).toBeNull();
    expect(assignment.assignedByUserId).toBeNull();
  });
});

describe("mapWorkRegimeEmployeeAssociationFromApi — empleados asociados al régimen (Etapa 8G)", () => {
  const apiAssociation = {
    id: "assignment-1",
    employeeId: "employee-1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    vigencyStatus: "current" as const,
    employee: {
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO" as const,
      sector: { id: "sector-1", name: "Campo" },
      costCenter: null,
      companies: [],
    },
  };

  it("mapea vigencyStatus y los datos del empleado asociado sin inventar nada", () => {
    const association = mapWorkRegimeEmployeeAssociationFromApi(apiAssociation);
    expect(association.vigencyStatus).toBe("current");
    expect(association.employee.legajo).toBe("100");
    expect(association.employee.sector).toEqual({ id: "sector-1", name: "Campo" });
  });

  it("effectiveTo ausente se normaliza a null, no a undefined", () => {
    const { effectiveTo: _omitted, ...withoutEffectiveTo } = apiAssociation;
    const association = mapWorkRegimeEmployeeAssociationFromApi(withoutEffectiveTo as typeof apiAssociation);
    expect(association.effectiveTo).toBeNull();
  });
});

// Etapa 14H.2: getWorkRegimeEmployees() no tenía dedupe/cache frontend — el
// journey 14H.1 confirmó 4 requests duplicadas (StrictMode) dentro de la
// ventana de "Filtrar vigencia de empleados asociados" (2878ms). Mismo
// patrón ya usado 7 veces en la serie 14G (shift alerts/notifications/
// time-entries/closures/corrections/attendance/home-summary).
describe("workRegimeApiService.getWorkRegimeEmployees — dedupe/cache frontend (Etapa 14H.2)", () => {
  const apiAssociation = {
    id: "assignment-1",
    employeeId: "employee-1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    vigencyStatus: "current" as const,
    employee: {
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO" as const,
      sector: { id: "sector-1", name: "Campo" },
      costCenter: null,
      companies: [],
    },
  };
  const employeesResponse = { data: [apiAssociation], meta: { total: 1, pageSize: 50, page: 1, hasMore: false } };

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

  it("dos llamadas concurrentes con el mismo régimen/filtros generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    const [a, b] = await Promise.all([
      workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "all" }),
      workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "all" }),
    ]);

    expect(a.items).toHaveLength(1);
    expect(b.items).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada idéntica dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current" });
    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current" });

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("cambiar el filtro de vigencia es un cache miss nuevo (status forma parte de la key)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current" });
    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "all" });

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("cambiar de régimen es un cache miss nuevo (regimeId forma parte de la key)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current" });
    await workRegimeApiService.getWorkRegimeEmployees("regime-2", { status: "current" });

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("cambiar de página es un cache miss nuevo (paginación forma parte de la key)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current", page: 1 });
    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current", page: 2 });

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("no cambia el contrato: sigue devolviendo { items, meta } con el mismo shape mapeado", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    const result = await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "all" });

    expect(result).toEqual({
      items: [mapWorkRegimeEmployeeAssociationFromApi(apiAssociation)],
      meta: employeesResponse.meta,
    });
  });

  it.each([
    ["assign", () => workRegimeApiService.assign("employee-1", { workRegimeId: "regime-1", effectiveFrom: "2026-09-08" })],
    ["updateAssignment", () => workRegimeApiService.updateAssignment("employee-1", "assignment-1", { effectiveFrom: "2026-09-08" })],
    ["closeAssignment", () => workRegimeApiService.closeAssignment("employee-1", "assignment-1", "2026-09-08")],
  ])("%s invalida la familia 'work-regimes'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "assignment-1", employeeId: "employee-1", workRegimeId: "regime-1", effectiveFrom: "2026-09-08T00:00:00.000Z", effectiveTo: null, assignedByUserId: null, createdAt: "2026-09-08T00:00:00.000Z", workRegime: apiRegime } });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("work-regimes", expect.any(String));
  });

  it("después de invalidar 'work-regimes' (p. ej. tras asignar), getWorkRegimeEmployees vuelve a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);
    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current" });
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await invalidateCacheFamily("work-regimes", "unit test");

    await workRegimeApiService.getWorkRegimeEmployees("regime-1", { status: "current" });
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
