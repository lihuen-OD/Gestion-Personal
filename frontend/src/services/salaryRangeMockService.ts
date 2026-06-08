import { mockOrgCategories } from "../data/mockOrgCategories";
import type { Employee } from "../types";
import type { Position } from "../types/position.types";
import { employeeMockService } from "./employeeMockService";

export type SalaryRangeStatus = "IN_RANGE" | "BELOW_RANGE" | "ABOVE_RANGE" | "NO_POSITION" | "NO_RANGE" | "UNKNOWN_CATEGORY";
export type SalaryGroup = { id: string; label: string; description: string; categories: string[] };

const salaryFamilies: SalaryGroup[] = [
  { id: "direccion", label: "Direccion", description: "Niveles directivos y gerenciales.", categories: ["Directorio", "Director", "Gerente General", "Direccion", "Dirección", "Gerencia"] },
  { id: "encargado", label: "Encargado", description: "Rangos de supervision operativa.", categories: ["Encargado A", "Encargado B", "Encargado C", "Encargado"] },
  { id: "administrativo", label: "Administrativo", description: "Rangos administrativos.", categories: ["Administrativo A", "Administrativo B", "Administrativo C", "Administrativo D", "Administrativo"] },
  { id: "especial", label: "Especialista", description: "Rangos tecnicos y especialistas.", categories: ["Especial A", "Especial B", "Especial C", "Especial D", "Especial E", "Especial F", "Especial G", "Especial H", "Especial I", "Especialista"] },
  { id: "operario", label: "Operario", description: "Rangos operativos.", categories: ["Operario A", "Operario B", "Operario C", "Operario D", "Peon General", "Peón General", "Peon Especializado", "Peón Especializado"] },
];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const uniqueSorted = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));

function allCategories(employees: Employee[] = employeeMockService.getAll()) {
  return uniqueSorted([
    ...mockOrgCategories.map((category) => category.label),
    ...employees.map((employee) => employee.internalCategory),
    ...employees.map((employee) => employee.receiptCategory),
  ]).filter((value) => normalize(value) !== "sin categoria");
}

export const salaryRangeMockService = {
  getGroups: (employees?: Employee[]) => {
    const values = allCategories(employees);
    const used = new Set<string>();
    const groups = salaryFamilies.map((family) => {
      const categories = family.categories.flatMap((category) => values.filter((value) => normalize(value) === normalize(category)));
      categories.forEach((category) => used.add(category));
      return { ...family, categories };
    }).filter((group) => group.categories.length);
    const extras = values.filter((value) => !used.has(value));
    return extras.length ? [...groups, { id: "otros", label: "Otros", description: "Categorias adicionales detectadas en legajos.", categories: extras }] : groups;
  },
  getOrderedCategories: (employees?: Employee[]) => salaryRangeMockService.getGroups(employees).flatMap((group) => group.categories),
  rangeBetween: (categories: string[], selected: string[], clicked: string) => {
    const next = selected.includes(clicked) ? selected.filter((item) => item !== clicked) : [...selected, clicked];
    const indexes = next.map((item) => categories.indexOf(item)).filter((index) => index >= 0).sort((a, b) => a - b);
    if (indexes.length < 2) return next;
    const start = indexes[0];
    const end = indexes[indexes.length - 1];
    return uniqueSorted([...next, ...categories.slice(start, end + 1)]);
  },
  compareCategoryToPosition: (position: Position | undefined, category: string) => {
    if (!position) return { status: "NO_POSITION" as SalaryRangeStatus, range: [] as string[], categoryIndex: -1, minIndex: -1, maxIndex: -1 };
    const range = position.salaryRangeCategories || [];
    if (!range.length) return { status: "NO_RANGE" as SalaryRangeStatus, range, categoryIndex: -1, minIndex: -1, maxIndex: -1 };
    if (!category.trim()) return { status: "UNKNOWN_CATEGORY" as SalaryRangeStatus, range, categoryIndex: -1, minIndex: -1, maxIndex: -1 };
    const ordered = salaryRangeMockService.getOrderedCategories();
    const indexOf = (value: string) => ordered.findIndex((item) => normalize(item) === normalize(value));
    const categoryIndex = indexOf(category);
    const rangeIndexes = range.map(indexOf).filter((index) => index >= 0).sort((a, b) => a - b);
    if (categoryIndex < 0 || !rangeIndexes.length) return { status: "UNKNOWN_CATEGORY" as SalaryRangeStatus, range, categoryIndex, minIndex: -1, maxIndex: -1 };
    const minIndex = rangeIndexes[0];
    const maxIndex = rangeIndexes[rangeIndexes.length - 1];
    if (categoryIndex < minIndex) return { status: "BELOW_RANGE" as SalaryRangeStatus, range, categoryIndex, minIndex, maxIndex };
    if (categoryIndex > maxIndex) return { status: "ABOVE_RANGE" as SalaryRangeStatus, range, categoryIndex, minIndex, maxIndex };
    return { status: "IN_RANGE" as SalaryRangeStatus, range, categoryIndex, minIndex, maxIndex };
  },
};
