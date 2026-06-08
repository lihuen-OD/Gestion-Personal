import type { NoveltyType } from "../types/noveltyType.types";

const now = "2026-06-01T09:00:00.000Z";
const rrhh = "Nivel 1 - RRHH" as const;
const supervisor = "Nivel 2 - Supervisión / Gestión" as const;
const carga = "Nivel 3 - Administrativo de Carga Horaria" as const;

const baseRules = {
  affectsAttendance: true,
  affectsSettlement: true,
  requiresApproval: true,
  requiresDocumentation: false,
  allowsFullDay: true,
  allowsHalfDay: false,
  allowsHours: false,
  allowsDateTo: true,
  allowsQuantityDays: true,
  allowsQuantityHours: false,
};

export const mockNoveltyTypes: NoveltyType[] = [
  {
    id: "novtype-enfermedad",
    code: "NOV-001",
    name: "Enfermedad",
    kind: "LICENCIA",
    description: "Ausencia justificada por enfermedad del colaborador. Requiere certificado medico para cierre administrativo.",
    status: "ACTIVO",
    rules: { ...baseRules, requiresDocumentation: true },
    allowedLoadRoles: [rrhh, supervisor, carga],
    approvalRoles: [rrhh, supervisor],
    finnegansLinks: [
      { id: "fin-enf-1", code: "LIC_ENF", name: "Licencia por enfermedad", settlementConcept: "Ausencia justificada paga", priority: 1, status: "ACTIVO", notes: "Equivalencia principal para liquidacion." },
    ],
    notes: "Controlar documentacion antes de aprobar.",
    createdAt: now,
    updatedAt: now,
    createdBy: "Sistema",
    updatedBy: "Sistema",
    history: [{ id: "hist-nov-enf-1", action: "Alta de tipo", description: "Se creo el tipo Enfermedad con vinculacion Finnegans.", createdAt: now, createdByUserId: "system", createdByUserName: "Sistema" }],
  },
  {
    id: "novtype-vacaciones",
    code: "NOV-002",
    name: "Vacaciones",
    kind: "VACACIONES",
    description: "Licencia anual planificada. Impacta en asistencia y liquidacion segun reglas vigentes.",
    status: "ACTIVO",
    rules: { ...baseRules, requiresDocumentation: false },
    allowedLoadRoles: [rrhh, supervisor],
    approvalRoles: [rrhh],
    finnegansLinks: [
      { id: "fin-vac-1", code: "VAC_GOZ", name: "Vacaciones gozadas", settlementConcept: "Vacaciones", priority: 1, status: "ACTIVO" },
    ],
    createdAt: now,
    updatedAt: now,
    createdBy: "Sistema",
    updatedBy: "Sistema",
    history: [{ id: "hist-nov-vac-1", action: "Alta de tipo", description: "Se creo el tipo Vacaciones.", createdAt: now, createdByUserId: "system", createdByUserName: "Sistema" }],
  },
  {
    id: "novtype-llegada-tarde",
    code: "NOV-003",
    name: "Llegada tarde",
    kind: "HORARIA",
    description: "Novedad horaria por ingreso posterior al horario asignado.",
    status: "ACTIVO",
    rules: { ...baseRules, requiresApproval: false, allowsFullDay: false, allowsDateTo: false, allowsQuantityDays: false, allowsHours: true, allowsQuantityHours: true },
    allowedLoadRoles: [rrhh, supervisor, carga],
    approvalRoles: [rrhh, supervisor],
    finnegansLinks: [
      { id: "fin-tar-1", code: "TARDANZA", name: "Llegada tarde", settlementConcept: "Descuento tardanza", priority: 1, status: "ACTIVO" },
    ],
    createdAt: now,
    updatedAt: now,
    createdBy: "Sistema",
    updatedBy: "Sistema",
    history: [{ id: "hist-nov-tar-1", action: "Alta de tipo", description: "Se creo el tipo Llegada tarde.", createdAt: now, createdByUserId: "system", createdByUserName: "Sistema" }],
  },
  {
    id: "novtype-art",
    code: "NOV-004",
    name: "ART",
    kind: "ACCIDENTE",
    description: "Accidente laboral informado a ART. Puede tener mas de una vinculacion para liquidacion y seguimiento.",
    status: "ACTIVO",
    rules: { ...baseRules, requiresDocumentation: true },
    allowedLoadRoles: [rrhh, supervisor],
    approvalRoles: [rrhh],
    finnegansLinks: [
      { id: "fin-art-1", code: "ACC_ART", name: "Accidente ART", settlementConcept: "ART", priority: 1, status: "ACTIVO" },
      { id: "fin-art-2", code: "AUS_JUST", name: "Ausencia justificada", settlementConcept: "Ausencia justificada", priority: 2, status: "ACTIVO" },
    ],
    createdAt: now,
    updatedAt: now,
    createdBy: "Sistema",
    updatedBy: "Sistema",
    history: [{ id: "hist-nov-art-1", action: "Alta de tipo", description: "Se creo el tipo ART con multiples equivalencias.", createdAt: now, createdByUserId: "system", createdByUserName: "Sistema" }],
  },
];
