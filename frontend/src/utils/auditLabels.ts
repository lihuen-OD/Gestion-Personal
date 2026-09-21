import { formatPeriodLabel } from "./period";

// Etapa 15M.20: punto único de traducción para lo que escribe el log de
// auditoría del backend (`auditService.register()`), consumido hoy por
// Auditoría, Dashboard ("Actividad reciente") y Legajos ("Historial de
// Eventos"). Antes cada pantalla tenía su propio mapa parcial con fallback
// inseguro (`label[x] || x`) — un evento de una entidad no mapeada (p. ej.
// `WorkShift`, `ShiftAlert`, `HourConceptBreakdown`) se mostraba crudo. Este
// mapa se armó relevando exhaustivamente cada llamado real a
// `auditService.register(...)` en `backend/src/modules/**`, no adivinando.

const entityLabels: Record<string, string> = {
  AttendanceInactivityIncident: "Inactividad en fichada",
  AttendancePunch: "Fichada",
  AuditParameter: "Parámetro de auditoría",
  // "Document" es el nombre legado previo a "EmployeeDocument" — se
  // conserva para no dejar sin traducir filas históricas ya persistidas.
  Document: "Documento",
  DocumentCategory: "Categoría documental",
  DoubleHourRule: "Regla de hora especial",
  Employee: "Legajo",
  EmployeeAddress: "Domicilio del legajo",
  EmployeeAssignment: "Asignación de responsable",
  EmployeeBlockHistory: "Bloqueo de legajo",
  EmployeeContact: "Contacto del legajo",
  EmployeeDocument: "Documento del legajo",
  EmployeeFieldHistory: "Historial de legajo",
  EmployeeHourConcept: "Concepto horario del legajo",
  EmployeeTransport: "Transporte del legajo",
  EmployeeWorkRegime: "Régimen laboral del legajo",
  FinnegansExport: "Exportación a Finnegans",
  HolidayWorkAssignment: "Asignación de feriado",
  HourConcept: "Concepto horario",
  HourConceptBreakdown: "Desglose de conceptos horarios",
  HourConceptRule: "Regla de concepto horario",
  LaborMovement: "Movimiento laboral",
  MonthlyTimeClosure: "Cierre mensual",
  Novelty: "Novedad",
  NoveltyType: "Tipo de novedad",
  Position: "Puesto",
  Route: "Acceso al sistema",
  SalaryCategory: "Categoría salarial",
  ShiftAlert: "Alerta de turno",
  ShiftAssignment: "Asignación de turno",
  ShiftTemplate: "Turno",
  StorageFile: "Archivo",
  TimeCorrectionRequest: "Solicitud de corrección horaria",
  TimeEntry: "Carga horaria",
  User: "Usuario",
  WorkRegime: "Régimen laboral",
  WorkShift: "Jornada laboral",
};

const actionLabels: Record<string, string> = {
  ACTIVATE: "Activación",
  APPROVE: "Aprobación",
  CREATE: "Alta",
  DEACTIVATE: "Inactivación",
  DELETE: "Eliminación",
  EXPORT: "Exportación",
  LOGIN: "Ingreso",
  REJECT: "Rechazo",
  RETURN: "Devolución",
  UPDATE: "Modificación",
};

export function auditEntityLabel(entity: string): string {
  return entityLabels[entity] || "Registro del sistema";
}

export function auditActionLabel(action: string): string {
  return actionLabels[action] || "Movimiento registrado";
}

const roleLabels: Record<string, string> = {
  NIVEL_1_RRHH: "Nivel 1 - RRHH",
  NIVEL_2_SUPERVISION: "Nivel 2 - Supervisión / Gestión",
  NIVEL_3_CARGA_HORARIA: "Nivel 3 - Administrativo de Carga Horaria",
};

export function auditRoleLabel(role: string): string {
  return roleLabels[role] || role;
}

// Valores de enum (no claves) que pueden aparecer dentro de un resumen de
// cambios "Antes/Después" (before/after crudo del backend, ya reducido a
// texto por `auditApiService.ts::summarizeObject`). A diferencia de
// entity/action, acá no hay un solo campo — son enums de distintos modelos
// (WorkShiftStatus, ApprovalStatus, ShiftAlertStatus, ShiftAssignmentStatus,
// ACTIVO/INACTIVO genérico) que en este dominio, en la práctica, nunca
// colisionan en significado aunque comparen el mismo string.
const statusValueLabels: Record<string, string> = {
  ABIERTO: "Abierta", PROCESADO: "Procesada", OBSERVADO: "Observada", ANULADO: "Anulada",
  FALTA_SALIDA: "Falta registrar salida", FALTA_INGRESO: "Falta registrar ingreso",
  INVALIDO: "Inválida", REVISADO: "Revisada", CERRADO_MANUAL: "Cerrada manualmente",
  BORRADOR: "Borrador", EN_REVISION: "En revisión", APROBADO: "Aprobado", PENDIENTE: "Pendiente",
  RECHAZADO: "Rechazado", DEVUELTO: "Devuelto", RESUELTA: "Resuelta", DESCARTADA: "Descartada",
  ACTIVO: "Activo", INACTIVO: "Inactivo", HABILITADO: "Habilitado", DESHABILITADO: "Deshabilitado",
};

const sourceValueLabels: Record<string, string> = {
  ADMIN: "Panel administrativo", PORTAL_DNI: "Portal por DNI", PUBLIC_CLOCK_PHOTO: "Fichador público (foto)",
  KIOSK: "Kiosco", BIOTIME: "Biotime", FACIAL: "Reconocimiento facial",
};

const shiftAlertTypeValueLabels: Record<string, string> = {
  INGRESO_TARDE: "Ingreso tarde", SALIDA_ANTICIPADA: "Salida anticipada", SALIDA_TARDIA: "Salida tardía",
  TURNO_NO_IDENTIFICADO: "Turno no identificado", SHIFT_NOT_ENABLED_FOR_EMPLOYEE: "Turno no habilitado para el legajo",
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "Posible falta de configuración de turno",
  JORNADA_INSUFICIENTE: "Jornada insuficiente", JORNADA_EXTENDIDA: "Jornada extendida",
  DESCANSO_INSUFICIENTE: "Descanso insuficiente", POSIBLE_OLVIDO_SALIDA: "Posible olvido de salida",
  CONCEPTO_NO_HABILITADO: "Concepto no habilitado", SEGMENTO_SIN_CLASIFICAR: "Segmento sin clasificar",
};

function rawEnumFallback(token: string) {
  return token.toLowerCase().replace(/_/g, " ");
}

function polishText(value: string) {
  return value
    .replace(/\baprobo\b/gi, "aprobó")
    .replace(/\bactualizo\b/gi, "actualizó")
    .replace(/\benvio\b/gi, "envió")
    .replace(/\brechazo\b/gi, "rechazó")
    .replace(/\bdevolvio\b/gi, "devolvió")
    .replace(/\bcargo\b/gi, "cargó")
    .replace(/\bpreparo\b/gi, "preparó")
    .replace(/\bcreo\b/gi, "creó")
    .replace(/\bobservo\b/gi, "observó")
    .replace(/\bexportacion\b/gi, "exportación")
    .replace(/\bauditoria\b/gi, "auditoría");
}

export function cleanAuditValue(value: string) {
  if (!value || value === "-") return "";
  return polishText(value)
    .replace(/\s*\|\s*Id:\s*[a-f0-9-]{20,}/gi, "")
    .replace(/\bDate:\s*(\d{4})-(\d{2})-(\d{2})T[^\s|]+/gi, "Fecha: $3/$2/$1")
    .replace(/\bDay:\s*/gi, "Día: ")
    .replace(/\bHours:\s*/gi, "Horas: ")
    .replace(/\bPeriod:\s*(\d{4}-\d{2})\b/gi, (_, period) => `Periodo: ${formatPeriodLabel(period)}`)
    .replace(/\b(Estado|Status):\s*([A-Z_]+)\b/g, (_, label, token) => `Estado: ${statusValueLabels[token] || rawEnumFallback(token)}`)
    .replace(/\b(Source|Origen):\s*([A-Z_]+)\b/g, (_, label, token) => `Origen: ${sourceValueLabels[token] || rawEnumFallback(token)}`)
    .replace(new RegExp(`\\b(${Object.keys(shiftAlertTypeValueLabels).join("|")})\\b`, "g"), (token) => shiftAlertTypeValueLabels[token])
    .replace(/\bInclude Pending:\s*(true|false)\b/gi, (_, included) => `Incluye pendientes: ${included === "true" ? "sí" : "no"}`)
    .replace(/\bTotal Rows:\s*(\d+)\b/gi, (_, total) => `${total} registro${total === "1" ? "" : "s"}`)
    .replace(/\bQuery:\s*/gi, "")
    .replace(/\bField:\s*/gi, "Campo: ")
    .replace(/\bSection:\s*/gi, "Sección: ")
    .replace(/\bNew value:\s*/gi, "Valor nuevo: ")
    .replace(/\bOld value:\s*/gi, "Valor anterior: ")
    // Booleanos crudos que puedan quedar sueltos en un resumen de campos
    // (p. ej. "Usa transporte: true") — red de seguridad genérica además
    // del arreglo en el origen (`auditApiService.ts::formatPrimitive`).
    .replace(/:\s*true\b/g, ": Sí")
    .replace(/:\s*false\b/g, ": No")
    .replace(/\s+\|\s+/g, " · ");
}

export function auditDescription(entry: { reason: string; next: string }) {
  const description = entry.reason && entry.reason !== "-" ? entry.reason : entry.next;
  return cleanAuditValue(description) || "Movimiento registrado en el sistema.";
}

export function auditChange(entry: { previous: string; next: string }) {
  const previous = cleanAuditValue(entry.previous);
  const next = cleanAuditValue(entry.next);
  if (previous && next) return `Antes: ${previous} · Después: ${next}`;
  if (next) return next;
  if (previous) return `Antes: ${previous}`;
  return "Sin cambios de valores visibles.";
}
