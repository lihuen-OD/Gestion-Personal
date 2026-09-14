import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveCategorySourceEmployees, salaryRangeMockService } from "./salaryRangeMockService";
import { employeeMockService } from "./employeeMockService";
import type { Employee } from "../types";

// employeeMockService lee de localStorage (readStore), que no existe en el
// entorno de test (node, sin jsdom) — se mockea para nunca tocarlo de
// verdad, y para poder espiar si algo lo llama sin querer (esa era
// exactamente la fuga que se está corrigiendo en esta etapa).
vi.mock("./employeeMockService", () => ({
  employeeMockService: { getAll: vi.fn(() => []) },
}));

// Etapa 15F.0: demoMode se calcula en el import de config/runtimeMode.ts a
// partir de import.meta.env.VITE_DEMO_MODE, que Vite resuelve leyendo
// frontend/.env.local — un archivo gitignored y específico de cada
// máquina. Sin este mock, estos tests dependían de un valor ambiente fuera
// de su control (pasaban o fallaban según la config local de quien los
// corriera, no según el código) — mismo patrón ya usado en
// LoginPage.test.tsx para aislar el mismo módulo.
vi.mock("../config/runtimeMode", () => ({ demoMode: false }));

const mockedGetAll = employeeMockService.getAll as unknown as ReturnType<typeof vi.fn>;

function employee(overrides: Partial<Employee> = {}): Employee {
  return { internalCategory: "Administrativo A", receiptCategory: "Administrativo A", ...overrides } as Employee;
}

beforeEach(() => {
  vi.clearAllMocks();
  salaryRangeMockService.setApiGroups([]); // limpia el cache compartido entre tests
});

describe("resolveCategorySourceEmployees", () => {
  it("si se pasan employees explícitos, los usa y nunca llama a employeeMockService (con o sin demoMode)", () => {
    const explicit = [employee()];
    expect(resolveCategorySourceEmployees(explicit, true)).toBe(explicit);
    expect(resolveCategorySourceEmployees(explicit, false)).toBe(explicit);
    expect(mockedGetAll).not.toHaveBeenCalled();
  });

  it("sin employees y sin demoMode (comportamiento real en producción/desarrollo), no usa el mock silencioso — devuelve vacío", () => {
    const result = resolveCategorySourceEmployees(undefined, false);
    expect(result).toEqual([]);
    expect(mockedGetAll).not.toHaveBeenCalled();
  });

  it("sin employees y con demoMode explícitamente activo, el fallback a datos de demo está permitido", () => {
    mockedGetAll.mockReturnValue([employee({ internalCategory: "Demo" })]);
    const result = resolveCategorySourceEmployees(undefined, true);
    expect(result).toEqual([{ internalCategory: "Demo", receiptCategory: "Administrativo A" }]);
    expect(mockedGetAll).toHaveBeenCalledTimes(1);
  });
});

describe("salaryRangeMockService.getOrderedCategories — sin fallback mock silencioso fuera de demoMode", () => {
  it("sin catálogo de la API cargado (cache vacío) y sin employees explícitos, no llama a employeeMockService (demoMode real del proceso de test es false)", () => {
    const result = salaryRangeMockService.getOrderedCategories();
    expect(mockedGetAll).not.toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true); // empty state controlado, no un crash
  });

  it("si la API devolvió grupos (setApiGroups con datos reales), getOrderedCategories los usa sin tocar el mock", () => {
    salaryRangeMockService.setApiGroups([{ id: "administrativo", label: "Administrativo", description: "", categories: ["Administrativo A", "Administrativo B"] }]);
    const result = salaryRangeMockService.getOrderedCategories();
    expect(result).toEqual(["Administrativo A", "Administrativo B"]);
    expect(mockedGetAll).not.toHaveBeenCalled();
  });
});
