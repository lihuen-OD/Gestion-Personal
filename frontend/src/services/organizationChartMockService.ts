import { mockOrgCategories } from "../data/mockOrgCategories";
import type { Employee, Role } from "../types";
import type { OrgCategory, OrgChartFilters, OrgChartModel, OrgEdge, OrgEmployeeNode } from "../types/organizationChart.types";
import { calculateEmployeeStatus } from "./employeeStatusService";

const emptyFilters: OrgChartFilters = {
  company: "", businessUnit: "", establishment: "", costCenter: "", sector: "", position: "",
  internalCategory: "", receiptCategory: "", status: "", directManager: "", timeResponsible: "", search: "",
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
const text = (value: unknown) => String(value || "").toLowerCase();
const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
const fullName = (employee: Employee) => `${employee.lastName}, ${employee.firstName}`;
const employeePositionName = (employee: Employee) => employee.puestoNombre || employee.position || "";
const employeeStatus = (employee: Employee) => employee.status || calculateEmployeeStatus(employee);
const categoryKey = (employee: Employee) => normalize(employee.internalCategory || employee.receiptCategory || "");
const managerKey = (employee: Employee) => normalize(`${employee.directManager || ""}`);
const employeeNameKey = (employee: Employee) => normalize(`${employee.firstName} ${employee.lastName}`);
const employeeCompanies = (employee: Employee) => employee.companies?.length ? employee.companies : [employee.company].filter(Boolean);
const employeeManagers = (employee: Employee) => employee.directManagers?.length ? employee.directManagers : [employee.directManager].filter(Boolean);
const employeeTimeResponsibles = (employee: Employee) => employee.timeResponsibles?.length ? employee.timeResponsibles : [employee.timeResponsible].filter(Boolean);

function scopedEmployeesFrom(employees: Employee[], role: Role, userSector?: string) {
  return role.startsWith("Nivel 2") ? employees.filter((employee) => employee.sector === userSector) : employees;
}

function employeeMatches(employee: Employee, filters: OrgChartFilters) {
  const query = text(filters.search).trim();
  const haystack = `${employee.firstName} ${employee.lastName} ${employee.legajoInterno} ${employee.legajoFinnegans} ${employee.legajo} ${employee.cuil} ${employee.dni}`.toLowerCase();
  return (!filters.company || employeeCompanies(employee).includes(filters.company))
    && (!filters.businessUnit || employee.businessUnit === filters.businessUnit)
    && (!filters.establishment || employee.establishment === filters.establishment)
    && (!filters.costCenter || employee.costCenter === filters.costCenter)
    && (!filters.sector || employee.sector === filters.sector)
    && (!filters.position || employee.positionId === filters.position || employeePositionName(employee) === filters.position)
    && (!filters.internalCategory || employee.internalCategory === filters.internalCategory)
    && (!filters.receiptCategory || employee.receiptCategory === filters.receiptCategory)
    && (!filters.status || employeeStatus(employee) === filters.status)
    && (!filters.directManager || employeeManagers(employee).includes(filters.directManager))
    && (!filters.timeResponsible || employeeTimeResponsibles(employee).includes(filters.timeResponsible))
    && (!query || haystack.includes(query));
}

function categoryFor(employee: Employee, categories: OrgCategory[]) {
  return categories.find((category) => normalize(category.label) === categoryKey(employee)) || categories.find((category) => category.id === "SIN_CATEGORIA")!;
}

function categoryBaseY(category: OrgCategory) {
  if (category.id === "DIRECTORIO") return 280;
  if (category.id === "DIRECTOR") return 380;
  if (category.id === "GERENTE_GENERAL") return 480;
  if (category.group === "ESPECIAL") return 560;
  if (category.group === "ENCARGADO") return 650;
  if (category.group === "ADMINISTRATIVO") return 650;
  if (category.group === "OPERARIO") return 760;
  return 860;
}

export const organizationChartMockService = {
  getEmptyFilters: () => ({ ...emptyFilters }),
  getCategories: () => [...mockOrgCategories].sort((a, b) => a.order - b.order),
  getEmployeesFrom: (employees: Employee[], role: Role, userSector?: string, filters: OrgChartFilters = emptyFilters) => scopedEmployeesFrom(employees, role, userSector).filter((employee) => employeeMatches(employee, filters)),
  getFilterOptionsFrom: (employeesInput: Employee[], role: Role, userSector?: string) => {
    const employees = scopedEmployeesFrom(employeesInput, role, userSector);
    return {
      company: unique(employees.flatMap(employeeCompanies)),
      businessUnit: unique(employees.map((employee) => employee.businessUnit)),
      establishment: unique(employees.map((employee) => employee.establishment)),
      costCenter: unique(employees.map((employee) => employee.costCenter)),
      sector: unique(employees.map((employee) => employee.sector)),
      position: unique(employees.map(employeePositionName)),
      internalCategory: unique(employees.map((employee) => employee.internalCategory)),
      receiptCategory: unique(employees.map((employee) => employee.receiptCategory)),
      directManager: unique(employees.flatMap(employeeManagers)),
      timeResponsible: unique(employees.flatMap(employeeTimeResponsibles)),
    };
  },
  buildCategoryModel: (employees: Employee[], categories: OrgCategory[]): OrgChartModel => {
    const columnWidth = 210, nodeGap = 96, top = 104, nodeWidth = 168, nodeMidY = 36;
    const grouped = new Map<string, Employee[]>();
    employees.forEach((employee) => {
      const category = categoryFor(employee, categories);
      grouped.set(category.id, [...(grouped.get(category.id) || []), employee]);
    });
    const nodes: OrgEmployeeNode[] = [];
    categories.forEach((category, columnIndex) => {
      const rows = (grouped.get(category.id) || []).sort((a, b) => managerKey(a).localeCompare(managerKey(b)) || fullName(a).localeCompare(fullName(b), "es"));
      rows.forEach((employee, rowIndex) => nodes.push({ id: employee.id, employee, category, x: columnIndex * columnWidth + 24, y: categoryBaseY(category) + rowIndex * nodeGap, orphan: false }));
    });
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const managerMap = new Map(employees.map((employee) => [employeeNameKey(employee), employee]));
    const edges: OrgEdge[] = [];
    nodes.forEach((node) => {
      const manager = managerMap.get(managerKey(node.employee));
      const managerNode = manager ? nodeMap.get(manager.id) : undefined;
      if (managerNode) {
        const fromX = managerNode.x + nodeWidth;
        const fromY = managerNode.y + nodeMidY;
        const gutterX = Math.max(fromX + 16, node.x - 18);
        const toX = node.x;
        const toY = node.y + nodeMidY;
        edges.push({ id: `${managerNode.id}-${node.id}`, fromEmployeeId: managerNode.id, toEmployeeId: node.id, path: `M${fromX} ${fromY} H${gutterX} V${toY} H${toX}` });
      }
      else if (node.employee.directManager) node.orphan = true;
    });
    const maxY = Math.max(top, ...nodes.map((node) => node.y));
    return { employees, categories, nodes, edges, width: categories.length * columnWidth + 40, height: Math.max(920, maxY + nodeGap + 80) };
  },
  buildFunctionalRoots: (employees: Employee[]) => {
    const byManager = new Map<string, Employee[]>();
    employees.forEach((employee) => byManager.set(managerKey(employee), [...(byManager.get(managerKey(employee)) || []), employee]));
    const employeeNames = new Set(employees.map(employeeNameKey));
    const roots = employees.filter((employee) => !employee.directManager || !employeeNames.has(managerKey(employee)));
    return { roots, byManager };
  },
};
