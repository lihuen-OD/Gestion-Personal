import type { AuditEventScope, AuditEventSeverity } from "../types/auditParameter.types";

// Etapa 15M.20: Parámetros de auditoría mostraba el enum crudo del backend
// (scope/severity) en filtros, formulario y tabla — un único punto de verdad
// acá, mismo patrón que utils/documentCategoryLabels.ts.
export const auditEventScopeLabels: Record<AuditEventScope, string> = {
  LEGAJO: "Legajo",
  NOVEDAD: "Novedad",
  HORAS: "Horas",
  LIQUIDACION: "Liquidación",
  DOCUMENTACION: "Documentación",
  PUESTOS: "Puestos",
  CONFIGURACION: "Configuración",
  ORGANIGRAMA: "Organigrama",
  USUARIOS: "Usuarios",
};

export const auditEventSeverityLabels: Record<AuditEventSeverity, string> = {
  INFO: "Info",
  ADVERTENCIA: "Advertencia",
  CRITICO: "Crítico",
};
