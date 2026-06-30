import { useState } from "react";
import type { Employee } from "../../types";
import { EmployeeOrgPopover } from "./EmployeeOrgPopover";

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
const key = (employee: Employee) => normalize(`${employee.firstName} ${employee.lastName}`);
const managerKey = (employee: Employee) => normalize(`${employee.directManager || ""}`);

function buildFunctionalRoots(employees: Employee[]): { roots: Employee[]; byManager: Map<string, Employee[]> } {
  const byManager = new Map<string, Employee[]>();
  employees.forEach((employee) => byManager.set(managerKey(employee), [...(byManager.get(managerKey(employee)) || []), employee]));
  const employeeNames = new Set(employees.map(key));
  const roots = employees.filter((employee) => !employee.directManager || !employeeNames.has(managerKey(employee)));
  return { roots, byManager };
}

function FunctionalNode({ employee, byManager, collapsed, toggle, select }: { employee: Employee; byManager: Map<string, Employee[]>; collapsed: Set<string>; toggle: (id: string) => void; select: (employee: Employee) => void }) {
  const children = byManager.get(key(employee)) || [];
  const closed = collapsed.has(employee.id);
  return <li><div className="functional-node"><button onClick={() => select(employee)}><b>{employee.lastName}, {employee.firstName}</b><span>{employee.position || employee.internalCategory}</span><small>{employee.company} · {employee.sector}</small></button>{children.length > 0 && <button className="button subtle" onClick={() => toggle(employee.id)}>{closed ? "Expandir" : "Colapsar"} ({children.length})</button>}</div>{children.length > 0 && !closed && <ul>{children.map((child) => <FunctionalNode key={child.id} employee={child} byManager={byManager} collapsed={collapsed} toggle={toggle} select={select} />)}</ul>}</li>;
}

export function FunctionalOrgChart({ employees, onExport }: { employees: Employee[]; onExport: () => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Employee | null>(null);
  const { roots, byManager } = buildFunctionalRoots(employees);
  const toggle = (id: string) => setCollapsed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <section className="org-module-card">
    <div className="org-toolbar"><b>{employees.length} empleados visibles</b><button className="button subtle" onClick={() => setCollapsed(new Set())}>Expandir todo</button><button className="button subtle" onClick={() => setCollapsed(new Set(employees.map((employee) => employee.id)))}>Colapsar todo</button><button className="button subtle" onClick={onExport}>Descargar estructura</button></div>
    {roots.length ? <div className="functional-tree"><ul>{roots.map((employee) => <FunctionalNode key={employee.id} employee={employee} byManager={byManager} collapsed={collapsed} toggle={toggle} select={setSelected} />)}</ul></div> : <div className="empty"><span>No hay empleados para los filtros seleccionados.</span></div>}
    {selected && <EmployeeOrgPopover employee={selected} onClose={() => setSelected(null)} />}
  </section>;
}
