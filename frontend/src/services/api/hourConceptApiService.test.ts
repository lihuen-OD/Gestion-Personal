import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import {
  buildHourConceptEmployeePath,
  buildHourConceptEmployeesPath,
  buildHourConceptPath,
  buildHourConceptRemovePath,
  hourConceptApiService,
  mapHourConceptEmployeeAssociationFromApi,
  mapHourConceptFromApi,
  mapToApi,
} from "./hourConceptApiService";
import type { HourConcept } from "../../types/hourConcept.types";

// Etapa 14H.5: sólo el describe de más abajo (getHourConceptEmployees/
// enableEmployees/disableEmployee) usa `apiRequest` de verdad — el resto de
// este archivo (mapeo puro) nunca lo invoca.
vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

describe("mapHourConceptEmployeeAssociationFromApi — empleados habilitados para el concepto (Etapa 8G)", () => {
  it("mapea employeeId y los datos del empleado habilitado", () => {
    const association = mapHourConceptEmployeeAssociationFromApi({
      employeeId: "employee-1",
      employee: {
        id: "employee-1",
        legajo: "100",
        cuil: "20-12345678-9",
        firstName: "Ana",
        lastName: "Prueba",
        status: "ACTIVO",
        sector: null,
        costCenter: { id: "cc-1", name: "Administración" },
        companies: [{ id: "company-1", name: "OD" }],
      },
    });

    expect(association).toEqual({
      employeeId: "employee-1",
      employee: {
        id: "employee-1",
        legajo: "100",
        cuil: "20-12345678-9",
        firstName: "Ana",
        lastName: "Prueba",
        status: "ACTIVO",
        sector: null,
        costCenter: { id: "cc-1", name: "Administración" },
        companies: [{ id: "company-1", name: "OD" }],
      },
    });
  });
});

// Etapa 8L: HourConcept perdió los campos decorativos (description, notes,
// allowedLoadRoles, approvalRoles, finnegansLinks, createdBy, updatedBy,
// history, rules) porque no existían en schema.prisma y se perdían
// silenciosamente al guardar. Etapa 8N: además, countsAsWorked (que SÍ
// existe en schema.prisma y SÍ se usa en backend) se sacó del frontend por
// decisión de producto — todo concepto horario cuenta como trabajado, así
// que deja de ser configurable desde esta pantalla. mapHourConceptFromApi ya
// no lo mapea, aunque la API lo siga devolviendo.
describe("mapHourConceptFromApi — solo campos reales y expuestos en esta pantalla (Etapa 8L/8N)", () => {
  it("mapea únicamente los campos que persiste el backend y se muestran en pantalla, sin inventar ninguno", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      countsAsWorked: true,
      loadMode: "AUTOMATIC",
      systemRole: null,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(concept).toEqual({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      loadMode: "AUTOMATIC",
      systemRole: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("no mapea countsAsWorked aunque la API lo devuelva (Etapa 8N: no debe aparecer en frontend)", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-2",
      code: "HOR-002",
      name: "Sereno",
      kind: "SERENO",
      status: "ACTIVO",
      countsAsWorked: false,
      loadMode: "AUTOMATIC",
      systemRole: null,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(concept).not.toHaveProperty("countsAsWorked");
  });

  // Etapa 8Q (auditoría UI/UX): igual que countsAsWorked — la API lo sigue
  // devolviendo (existe en schema.prisma desde la Etapa 8P), pero esta
  // pantalla ya no ofrece "ver eliminados", así que no se mapea al frontend.
  it("no mapea deletedAt aunque la API lo devuelva", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-3",
      code: "HOR-003",
      name: "Guardia",
      kind: "GUARDIA",
      status: "INACTIVO",
      countsAsWorked: true,
      loadMode: "AUTOMATIC",
      systemRole: null,
      deletedAt: "2026-08-20T12:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(concept).not.toHaveProperty("deletedAt");
  });

  it("no reconstruye description/notes/roles/history con valores hardcodeados", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      countsAsWorked: true,
      loadMode: "AUTOMATIC",
      systemRole: null,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(concept).not.toHaveProperty("description");
    expect(concept).not.toHaveProperty("notes");
    expect(concept).not.toHaveProperty("allowedLoadRoles");
    expect(concept).not.toHaveProperty("approvalRoles");
    expect(concept).not.toHaveProperty("finnegansLinks");
    expect(concept).not.toHaveProperty("createdBy");
    expect(concept).not.toHaveProperty("updatedBy");
    expect(concept).not.toHaveProperty("history");
    expect(concept).not.toHaveProperty("rules");
  });
});

describe("mapToApi — el payload de create/update solo envía campos reales y editables en esta pantalla (Etapa 8L/8N)", () => {
  const concept: HourConcept = {
    id: "concept-1",
    code: "HOR-001",
    name: "Guardia",
    kind: "GUARDIA",
    status: "ACTIVO",
    loadMode: "AUTOMATIC",
    systemRole: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("envía los campos editables del concepto adicional", () => {
    expect(mapToApi(concept)).toEqual({
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      loadMode: "AUTOMATIC",
    });
  });

  it("no envía createdAt/updatedAt ni ningún campo decorativo", () => {
    const payload = mapToApi(concept);
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
    expect(payload).not.toHaveProperty("description");
    expect(payload).not.toHaveProperty("notes");
  });

  // Etapa 8N: countsAsWorked ya no existe en HourConcept (frontend) y
  // mapToApi no lo envía nunca — ni hardcodeado a true, ni desde el
  // concepto. Omitir la clave (en vez de forzar true) evita pisar en
  // silencio un valor real que el concepto ya tuviera en la base al editar.
  it("nunca envía countsAsWorked, ni hardcodeado ni de ninguna otra forma", () => {
    const payload = mapToApi(concept);
    expect(payload).not.toHaveProperty("countsAsWorked");
  });
});

describe("buildHourConceptPath — endpoint real de update/updateStatus/remove (Etapa 8O)", () => {
  it("arma /hour-concepts/:id", () => {
    expect(buildHourConceptPath("concept-abc")).toBe("/hour-concepts/concept-abc");
  });

  it("usa el id real pasado, no un valor fijo", () => {
    expect(buildHourConceptPath("otro-concepto")).toBe("/hour-concepts/otro-concepto");
  });
});

// Etapa 8P: el primer intento de eliminar nunca manda force — si el backend
// tiene uso histórico responde 409 y recién ahí, tras una segunda
// confirmación explícita del usuario, se reintenta con force=true.
describe("buildHourConceptRemovePath — delete sin uso vs eliminación forzada con uso histórico (Etapa 8P)", () => {
  it("sin force: solo /hour-concepts/:id (primer intento, sin uso => delete físico directo)", () => {
    expect(buildHourConceptRemovePath("concept-1")).toBe("/hour-concepts/concept-1");
  });

  it("force=false explícito se comporta igual que ausente", () => {
    expect(buildHourConceptRemovePath("concept-1", false)).toBe("/hour-concepts/concept-1");
  });

  it("force=true: agrega ?force=true (segunda confirmación tras 409 HOUR_CONCEPT_IN_USE)", () => {
    expect(buildHourConceptRemovePath("concept-1", true)).toBe("/hour-concepts/concept-1?force=true");
  });
});

describe("buildHourConceptEmployeesPath / buildHourConceptEmployeePath — endpoints reales de agregar/quitar (Etapa 8N)", () => {
  it("arma /hour-concepts/:id/employees para habilitar (POST)", () => {
    expect(buildHourConceptEmployeesPath("concept-abc")).toBe("/hour-concepts/concept-abc/employees");
  });

  it("arma /hour-concepts/:id/employees/:employeeId para quitar (DELETE)", () => {
    expect(buildHourConceptEmployeePath("concept-abc", "employee-1")).toBe("/hour-concepts/concept-abc/employees/employee-1");
  });

  it("usa los ids reales pasados, no valores fijos", () => {
    expect(buildHourConceptEmployeesPath("otro-concepto")).toBe("/hour-concepts/otro-concepto/employees");
    expect(buildHourConceptEmployeePath("otro-concepto", "otro-empleado")).toBe("/hour-concepts/otro-concepto/employees/otro-empleado");
  });
});

// Etapa 14H.5: getHourConceptEmployees() no tenía dedupe/cache frontend — se
// dispara al abrir "Editar" en un concepto existente (AssociatedEmployeesPanel
// embedded), un montaje fresco cada vez que StrictMode duplica en dev. Mismo
// patrón ya usado 10+ veces en las series 14G/14H.
describe("hourConceptApiService.getHourConceptEmployees — dedupe/cache frontend (Etapa 14H.5)", () => {
  const employeesResponse = {
    data: [{ employeeId: "employee-1", employee: { id: "employee-1", legajo: "100", cuil: "20-12345678-9", firstName: "Ana", lastName: "Prueba", status: "ACTIVO" as const, sector: null, costCenter: null, companies: [] } }],
    meta: { total: 1, pageSize: 20, page: 1, hasMore: false },
  };

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

  it("dos llamadas concurrentes con el mismo concepto/filtros generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    const [a, b] = await Promise.all([
      hourConceptApiService.getHourConceptEmployees("concept-1"),
      hourConceptApiService.getHourConceptEmployees("concept-1"),
    ]);

    expect(a.items).toHaveLength(1);
    expect(b.items).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await hourConceptApiService.getHourConceptEmployees("concept-1");
    await hourConceptApiService.getHourConceptEmployees("concept-1");

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("cambiar de concepto es un cache miss nuevo (hourConceptId forma parte de la key)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    await hourConceptApiService.getHourConceptEmployees("concept-1");
    await hourConceptApiService.getHourConceptEmployees("concept-2");

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("no cambia el contrato: sigue devolviendo { items, meta } con el mismo shape mapeado", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);

    const result = await hourConceptApiService.getHourConceptEmployees("concept-1");

    expect(result).toEqual({
      items: [mapHourConceptEmployeeAssociationFromApi(employeesResponse.data[0]!)],
      meta: employeesResponse.meta,
    });
  });

  it.each([
    ["enableEmployees", () => hourConceptApiService.enableEmployees("concept-1", ["employee-2"])],
    ["disableEmployee", () => hourConceptApiService.disableEmployee("concept-1", "employee-1")],
  ])("%s invalida la familia 'hour-concepts'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("hour-concepts", expect.any(String));
  });

  it("después de invalidar 'hour-concepts' (p. ej. tras habilitar un empleado), getHourConceptEmployees vuelve a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue(employeesResponse);
    await hourConceptApiService.getHourConceptEmployees("concept-1");
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await invalidateCacheFamily("hour-concepts", "unit test");

    await hourConceptApiService.getHourConceptEmployees("concept-1");
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
