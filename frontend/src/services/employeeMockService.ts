import type { Employee, FieldHistorySection, User } from "../types";
import { auditMockService } from "./auditMockService";
import { employeeChangeLogService } from "./employeeChangeLogService";
import { employeeFieldHistoryMockService } from "./employeeFieldHistoryMockService";
import { calculateEmployeeStatus } from "./employeeStatusService";
import { readStore, writeStore } from "./storage";

const initialTrackedFields: { section: FieldHistorySection; field: string; label: string; get: (employee: Employee) => unknown }[] = [
  { section: "DATOS_LABORALES", field: "companies", label: "Empresa", get: (employee) => employee.companies || [employee.company] },
  { section: "DATOS_LABORALES", field: "businessUnit", label: "Unidad de negocio", get: (employee) => employee.businessUnit },
  { section: "DATOS_LABORALES", field: "establishment", label: "Establecimiento", get: (employee) => employee.establishment },
  { section: "DATOS_LABORALES", field: "costCenter", label: "Centro de costo", get: (employee) => employee.costCenter },
  { section: "DATOS_LABORALES", field: "sector", label: "Sector", get: (employee) => employee.sector },
  { section: "DATOS_LABORALES", field: "positionId", label: "Puesto vinculado", get: (employee) => employee.positionId },
  { section: "DATOS_LABORALES", field: "puestoNombre", label: "Puesto", get: (employee) => employee.puestoNombre || employee.position },
  { section: "DATOS_LABORALES", field: "position", label: "Puesto", get: (employee) => employee.position },
  { section: "DATOS_LABORALES", field: "receiptCategory", label: "Categoria de recibo", get: (employee) => employee.receiptCategory },
  { section: "DATOS_LABORALES", field: "internalCategory", label: "Categoria interna", get: (employee) => employee.internalCategory },
  { section: "DATOS_LABORALES", field: "agreement", label: "Convenio", get: (employee) => employee.agreement },
  { section: "DATOS_LABORALES", field: "healthInsurance", label: "Obra Social", get: (employee) => employee.healthInsurance },
  { section: "CONTACTO_DOMICILIO", field: "domicilio.localidadNombre", label: "Localidad", get: (employee) => employee.domicilio?.localidadNombre || employee.city },
  { section: "RESPONSABLES_ASIGNACIONES", field: "directManagers", label: "Encargados directos", get: (employee) => employee.directManagers || [employee.directManager] },
  { section: "RESPONSABLES_ASIGNACIONES", field: "timeResponsible", label: "Responsable de carga horaria", get: (employee) => employee.timeResponsible },
  { section: "RESPONSABLES_ASIGNACIONES", field: "timeResponsibles", label: "Responsables de carga horaria", get: (employee) => employee.timeResponsibles || [employee.timeResponsible] },
];

const fmt = (value: unknown) => Array.isArray(value) ? value.join(", ") : value === undefined || value === null || value === "" ? "" : String(value);

export const employeeMockService = {
  getAll: () => readStore<Employee>("employees"),
  getById: (id: string) => readStore<Employee>("employees").find((e) => e.id === id),
  create: (employee: Employee, user: User) => {
    const all = readStore<Employee>("employees");
    const laborMovements = employee.laborMovements?.length ? employee.laborMovements : [{ id: crypto.randomUUID(), type: "ALTA" as const, effectiveFrom: employee.startDate, reason: "Alta inicial", observation: "", createdAt: new Date().toISOString(), createdByUserId: user.id, createdByUserName: user.name }];
    const value = { ...employee, laborMovements, status: calculateEmployeeStatus({ ...employee, laborMovements }) };
    writeStore("employees", [...all, value]);
    employeeFieldHistoryMockService.createMany(initialTrackedFields.map((item) => ({ employeeId: value.id, section: item.section, field: item.field, fieldLabel: item.label, oldValue: null, newValue: fmt(item.get(value)), effectiveFrom: value.startDate, reason: "Alta inicial del legajo" })).filter((item) => item.newValue), user, `Legajo ${value.legajoInterno || value.legajo}`);
    employeeChangeLogService.createChangeLogs({ newEmployee: value, user, role: user.role });
    auditMockService.create({ user: user.name, role: user.role, action: "Crear legajo", entity: `Legajo ${value.legajoInterno || value.legajo}`, previous: "-", next: `${value.firstName} ${value.lastName}`, reason: "Alta de nuevo legajo" });
    return value;
  },
  update: (employee: Employee, user: User) => {
    const all = readStore<Employee>("employees");
    const previous = all.find((e) => e.id === employee.id);
    const previousStatus = previous ? calculateEmployeeStatus(previous) : calculateEmployeeStatus(employee);
    const nextStatus = calculateEmployeeStatus(employee);
    const events = [...(employee.historyEvents || [])];
    const addEvent = (type: string, description: string) => events.unshift({ id: crypto.randomUUID(), date: new Date().toLocaleDateString("es-AR"), type, description, user: user.name });
    if (previous) {
      if (previous.company !== employee.company) addEvent("Cambio de empresa", `Empresa: ${previous.company || "-"} -> ${employee.company || "-"}`);
      if (previous.costCenter !== employee.costCenter) addEvent("Cambio de centro de costo", `Centro de costo: ${previous.costCenter || "-"} -> ${employee.costCenter || "-"}`);
      if (previous.sector !== employee.sector) addEvent("Cambio de sector", `Sector: ${previous.sector || "-"} -> ${employee.sector || "-"}`);
      if (previous.position !== employee.position) addEvent("Cambio de puesto", `Puesto: ${previous.position || "-"} -> ${employee.position || "-"}`);
      if (previous.internalCategory !== employee.internalCategory || previous.receiptCategory !== employee.receiptCategory) addEvent("Cambio de categoría", "Se modificó la categoría del colaborador.");
      if ((previous.directManagers || [previous.directManager]).join(", ") !== (employee.directManagers || [employee.directManager]).join(", ")) addEvent("Cambio de encargado directo", `Encargados: ${(previous.directManagers || [previous.directManager]).filter(Boolean).join(", ") || "-"} -> ${(employee.directManagers || [employee.directManager]).filter(Boolean).join(", ") || "-"}`);
      if ((previous.timeResponsibles || [previous.timeResponsible]).join(", ") !== (employee.timeResponsibles || [employee.timeResponsible]).join(", ")) addEvent("Cambio de responsable de carga horaria", `Responsables: ${(previous.timeResponsibles || [previous.timeResponsible]).filter(Boolean).join(", ") || "-"} -> ${(employee.timeResponsibles || [employee.timeResponsible]).filter(Boolean).join(", ") || "-"}`);
      if (previous.endDate !== employee.endDate && employee.endDate) addEvent(new Date(`${employee.endDate}T00:00:00`) > new Date() ? "Baja laboral programada" : "Baja laboral registrada", `Fecha de baja: ${employee.endDate}.`);
      if (previousStatus !== nextStatus) addEvent("Cambio de estado laboral calculado", `El colaborador pasó a estado ${nextStatus} por fecha de baja.`);
      if (previous.transport !== employee.transport || previous.city !== employee.city || previous.transportNotes !== employee.transportNotes) addEvent("Cambio de transporte", "Se modificó la configuración de transporte.");
    }
    const value = { ...employee, status: nextStatus, historyEvents: events };
    writeStore("employees", all.map((e) => e.id === value.id ? value : e));
    employeeChangeLogService.createChangeLogs({ oldEmployee: previous, newEmployee: value, user, role: user.role });
    return value;
  },
};
