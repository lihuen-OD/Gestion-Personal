export type Role = "Nivel 1 - RRHH" | "Nivel 2 - Supervisión / Gestión" | "Nivel 3 - Administrativo de Carga Horaria";
export type EmployeeStatus = "Activo" | "Inactivo";
export type TimeStatus = "Pendiente" | "Borrador" | "En revisión" | "Aprobado" | "Rechazado" | "Cerrado" | "Exportado";
export type ChangeSection = "INFORMACION_GENERAL" | "CONTACTO_DOMICILIO" | "DATOS_LABORALES" | "RESPONSABLES" | "TRANSPORTE" | "CONFIGURACION_HORARIA" | "NOVEDADES" | "DOCUMENTACION";
export type FieldHistorySection = "INFORMACION_GENERAL" | "CONTACTO_DOMICILIO" | "DATOS_LABORALES" | "RESPONSABLES_ASIGNACIONES" | "TRANSPORTE" | "CONFIGURACION_HORARIA_LIQUIDACION";
export type LaborMovementType = "ALTA" | "BAJA";

export interface User {
  id: string; name: string; email: string; password: string; role: Role; status: "Activo" | "Inactivo";
  company?: string; sector?: string;
}

export interface Employee {
  id: string; legajo: string; legajoInterno: string; legajoFinnegans?: string; lastName: string; firstName: string; dni: string; cuil: string; birthDate: string;
  gender: string; civilStatus: string; nationality: string; phone: string; mobile: string; email: string;
  address: string; addressStreet: string; addressNumber: string; city: string; department: string; province: string; zip: string; domicilio: EmployeeAddress; emergencyContact: string; emergencyRelation: string; emergencyPhone: string;
  company: string; companies?: string[]; businessUnit: string; establishment: string; costCenter: string; sector: string; position: string; positionId?: string; puestoId?: string; puestoNombre?: string;
  receiptCategory: string; internalCategory: string; agreement: string; healthInsurance: string; directManager: string; directManagers?: string[]; timeResponsible: string; timeResponsibles?: string[];
  startDate: string; endDate?: string; exitReason?: string; workday: string; shift: string; transport: boolean; transportRoute: string; transportNotes: string; enabledHours: string[];
  settlementType: string; affectsSettlement: boolean; exportable: boolean; attendanceBonus: boolean; award: boolean; productiveGoals: boolean; humanGoals: boolean; settlementNotes: string; status: EmployeeStatus;
  laborMovements?: LaborMovement[];
  directManagerFrom: string; directManagerTo?: string; directManagerStatus: string; directManagerNotes: string;
  timeResponsibleRole: string; timeResponsibleFrom: string; timeResponsibleTo?: string; timeResponsibleStatus: string; timeResponsibleNotes: string;
  mapLocation: string; locationMap: EmployeeLocationMap; novelties: string[]; documents: string[]; historyEvents: EmployeeHistoryEvent[]; audit: string[]; routeHistory: string[];
}

export interface EmployeeLocationMap {
  lat: number | null; lng: number | null; source: "MOCK" | "MANUAL" | "API"; label: string;
}

export interface EmployeeAddress {
  calle: string; numero: string; provinciaId: string; provinciaNombre: string; departamentoId: string; departamentoNombre: string; localidadId: string; localidadNombre: string; codigoPostal: string; ubicacionMapa: EmployeeLocationMap;
  referencia?: string; direccionNormalizada?: string; fuenteGeocoding?: "GEOREF" | "LOCALITY_CENTER" | "MANUAL_MARKER" | "NOT_FOUND"; precisionGeocoding?: number;
}

export interface EmployeeHistoryEvent {
  id: string; date: string; type: string; description: string; user: string;
}

export interface LaborMovement {
  id: string; type: LaborMovementType; effectiveFrom: string; reason: string; observation?: string; createdAt: string; createdByUserId: string; createdByUserName: string;
}

export interface EmployeeFieldHistoryRecord {
  id: string; employeeId: string; section: FieldHistorySection; field: string; fieldLabel: string; oldValue: string | null; newValue: string;
  effectiveFrom: string; reason: string; createdAt: string; createdByUserId: string; createdByUserName: string;
}

export interface EmployeeBlockHistoryRecord {
  id: string; employeeId: string; section: FieldHistorySection; block: string; blockLabel: string; oldValue: string | null; newValue: string;
  effectiveFrom: string; reason: string; createdAt: string; createdByUserId: string; createdByUserName: string;
}

export interface TimeEntry {
  id: string; employeeId: string; period: string; day: number; type: string; hours: number; notes?: string; status: TimeStatus;
  date?: string; startTime?: string; endTime?: string; totalMinutes?: number; origin?: "MANUAL" | "BIOTIME" | "CORRECCION_MANUAL" | "NOVEDAD"; createdBy?: string; updatedBy?: string;
  conceptId?: string; isSpecial?: boolean; finnegansCode?: string; exportToFinnegans?: boolean;
}

export interface Novelty {
  id: string; employeeId: string; type: string; noveltyTypeId?: string; from: string; to: string; quantity: string;
  affectsSettlement: boolean; status: string; createdBy: string; documentationFileName?: string; documentationNotes?: string;
  origin?: "INTERNA" | "FINNEGANS" | "MIXTA"; timeImpact?: string; hoursImpact?: number;
  targetHourConceptId?: string; targetHourConceptName?: string;
  exportsToFinnegans?: boolean; finnegansCode?: string; finnegansName?: string; valor1?: string; fechaAplicacion?: string; hasValidity?: boolean; blocksTimeEntry?: boolean; setsWorkedHoursToZero?: boolean;
}

export interface AuditEntry {
  id: string; date: string; time: string; user: string; role: string; action: string; entity: string; field?: string; previous: string; next: string; reason: string;
}

export interface DocumentMock {
  id: string; employeeId: string; category: string; fileName: string; uploadedAt: string; expiresAt?: string; status: string; categoryId?: string; notes?: string;
}

export interface EmployeeChangeLog {
  id: string; employeeId: string; section: ChangeSection; field: string; fieldLabel: string; oldValue: string; newValue: string;
  action: "CREATE" | "UPDATE" | "STATUS_CHANGE" | "ASSIGNMENT_CHANGE" | "DOCUMENT_UPLOAD" | "NOVELTY_CREATE";
  category?: "ALTA" | "BAJA" | "CAMBIO_LABORAL"; description?: string; reason?: string; userId: string; userName: string; createdAt: string;
}
