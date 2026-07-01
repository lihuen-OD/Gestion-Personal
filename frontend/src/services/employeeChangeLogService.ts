import type { ChangeSection, Employee, EmployeeChangeLog, User } from "../types";
import { auditMockService } from "./auditMockService";
import { calculateEmployeeStatus } from "./employeeStatusService";
import { readStore, writeStore } from "./storage";

type FieldConfig = { path: string; label: string; section: ChangeSection; action?: EmployeeChangeLog["action"] };

const fields: FieldConfig[] = [
  ["legajoInterno","Legajo Interno","INFORMACION_GENERAL"],["legajoFinnegans","Legajo Finnegans","INFORMACION_GENERAL"],["lastName","Apellido","INFORMACION_GENERAL"],["firstName","Nombre","INFORMACION_GENERAL"],["dni","DNI","INFORMACION_GENERAL"],["cuil","CUIL","INFORMACION_GENERAL"],["birthDate","Fecha de nacimiento","INFORMACION_GENERAL"],["gender","Sexo","INFORMACION_GENERAL"],["civilStatus","Estado civil","INFORMACION_GENERAL"],["nationality","Nacionalidad","INFORMACION_GENERAL"],
  ["phone","Teléfono","CONTACTO_DOMICILIO"],["mobile","Celular","CONTACTO_DOMICILIO"],["email","Email","CONTACTO_DOMICILIO"],["emergencyContact","Contacto de emergencia","CONTACTO_DOMICILIO"],["emergencyRelation","Parentesco","CONTACTO_DOMICILIO"],["emergencyPhone","Teléfono de emergencia","CONTACTO_DOMICILIO"],
  ["domicilio.calle","Dirección / Calle","CONTACTO_DOMICILIO"],["domicilio.numero","Número","CONTACTO_DOMICILIO"],["domicilio.provinciaNombre","Provincia","CONTACTO_DOMICILIO"],["domicilio.departamentoNombre","Departamento","CONTACTO_DOMICILIO"],["domicilio.localidadNombre","Localidad","CONTACTO_DOMICILIO"],["domicilio.codigoPostal","Código postal","CONTACTO_DOMICILIO"],["domicilio.ubicacionMapa.lat","Latitud","CONTACTO_DOMICILIO"],["domicilio.ubicacionMapa.lng","Longitud","CONTACTO_DOMICILIO"],
  ["companies","Empresa","DATOS_LABORALES"],["businessUnit","Unidad de negocio","DATOS_LABORALES"],["establishment","Establecimiento","DATOS_LABORALES"],["costCenter","Centro de costo","DATOS_LABORALES"],["sector","Sector","DATOS_LABORALES"],["position","Puesto","DATOS_LABORALES"],["receiptCategory","Categoría de recibo","DATOS_LABORALES"],["internalCategory","Categoría interna","DATOS_LABORALES"],["agreement","Convenio","DATOS_LABORALES"],["startDate","Fecha de alta / ingreso","DATOS_LABORALES"],["endDate","Fecha de baja / egreso","DATOS_LABORALES"],["exitReason","Motivo de baja / egreso","DATOS_LABORALES"],
  ["directManagers","Encargados directos","RESPONSABLES","ASSIGNMENT_CHANGE"],["directManager","Encargado directo principal","RESPONSABLES","ASSIGNMENT_CHANGE"],["timeResponsibles","Responsables de carga horaria","RESPONSABLES","ASSIGNMENT_CHANGE"],["timeResponsible","Responsable de carga horaria principal","RESPONSABLES","ASSIGNMENT_CHANGE"],
  ["transport","Utiliza transporte","TRANSPORTE"],["city","Ciudad de origen","TRANSPORTE"],["transportNotes","Observaciones transporte","TRANSPORTE"],
  ["enabledHours","Horas habilitadas","CONFIGURACION_HORARIA"],
].map(([path,label,section,action]) => ({ path, label, section, action } as FieldConfig));

const positionFieldIndex = fields.findIndex((field) => field.path === "position");
fields.splice(Math.max(positionFieldIndex, 0), 0,
  { path: "positionId", label: "Puesto vinculado", section: "DATOS_LABORALES" },
  { path: "puestoNombre", label: "Puesto", section: "DATOS_LABORALES" },
);

const agreementFieldIndex = fields.findIndex((field) => field.path === "agreement");
fields.splice(agreementFieldIndex + 1, 0, { path: "healthInsurance", label: "Obra Social", section: "DATOS_LABORALES" });

const get = (value: unknown, path: string) => path.split(".").reduce<unknown>((current, key) => typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined, value);
const fmt = (value: unknown) => Array.isArray(value) ? value.join(", ") : value === undefined || value === null || value === "" ? "Sin cargar" : String(value);
const today = () => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

function laborCategory(field: string, oldValue: string, newValue: string, oldEmployee?: Employee): Pick<EmployeeChangeLog, "category" | "description" | "action"> {
  if (!oldEmployee) return { category: "ALTA", action: "CREATE", description: "Alta registrada" };
  if (field === "startDate") return { category: "ALTA", action: "UPDATE", description: oldValue === "Sin cargar" ? "Carga inicial de fecha de alta" : "Corrección de fecha de alta" };
  if (field === "endDate") {
    if (newValue === "Sin cargar") return { category: "BAJA", action: "UPDATE", description: "Baja cancelada" };
    if (oldValue !== "Sin cargar") return { category: "BAJA", action: "UPDATE", description: "Cambio de fecha de baja" };
    return { category: "BAJA", action: "UPDATE", description: new Date(`${newValue}T00:00:00`) > today() ? "Baja programada" : "Baja registrada" };
  }
  if (field === "exitReason") return { category: "BAJA", action: "UPDATE", description: "Cambio de motivo de baja" };
  return { category: "CAMBIO_LABORAL", action: "UPDATE", description: `Cambio de ${field}` };
}

export const employeeChangeLogService = {
  getByEmployeeAndSection: (employeeId: string, section: ChangeSection) => readStore<EmployeeChangeLog>("changeLogs").filter((log) => log.employeeId === employeeId && log.section === section),
  getByEmployee: (employeeId: string) => readStore<EmployeeChangeLog>("changeLogs").filter((log) => log.employeeId === employeeId),
  createChangeLogs: ({ oldEmployee, newEmployee, user, role }: { oldEmployee?: Employee; newEmployee: Employee; user: User; role: string }) => {
    const createdAt = new Date().toISOString();
    const logs: EmployeeChangeLog[] = fields.flatMap((field) => {
      const oldValue = oldEmployee ? fmt(get(oldEmployee, field.path)) : "Sin cargar";
      const newValue = fmt(get(newEmployee, field.path));
      if (oldValue === newValue) return [];
      const labor: Partial<Pick<EmployeeChangeLog, "category" | "description" | "action">> = field.section === "DATOS_LABORALES" ? laborCategory(field.path, oldValue, newValue, oldEmployee) : {};
      return [{ id: crypto.randomUUID(), employeeId: newEmployee.id, section: field.section, field: field.path, fieldLabel: field.label, oldValue, newValue, action: labor.action || (oldEmployee ? (field.action || "UPDATE") : "CREATE"), category: labor.category, description: labor.description, userId: user.id, userName: user.name, createdAt } satisfies EmployeeChangeLog];
    });
    const previousStatus = oldEmployee ? calculateEmployeeStatus(oldEmployee) : undefined;
    const nextStatus = calculateEmployeeStatus(newEmployee);
    if (previousStatus && previousStatus !== nextStatus) logs.unshift({ id: crypto.randomUUID(), employeeId: newEmployee.id, section: "DATOS_LABORALES", category: "BAJA", field: "laborStatus", fieldLabel: "Estado laboral calculado", oldValue: previousStatus, newValue: nextStatus, action: "STATUS_CHANGE", description: `Cambio de estado laboral a ${nextStatus}`, userId: user.id, userName: user.name, createdAt });
    if (logs.length) writeStore("changeLogs", [...logs, ...readStore<EmployeeChangeLog>("changeLogs")]);
    logs.forEach((log) => auditMockService.create({ user: user.name, role, action: log.action === "STATUS_CHANGE" ? "Cambio de estado laboral" : "Actualizó legajo", entity: `Legajo ${newEmployee.legajoInterno || newEmployee.legajo}`, field: log.fieldLabel, previous: log.oldValue, next: log.newValue, reason: log.reason || "Edición de legajo" }));
    return logs;
  },
};
