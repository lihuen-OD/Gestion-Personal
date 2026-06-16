import type { Role } from "../types";
import type { HourConcept } from "../types/hourConcept.types";

const now = "2026-06-01T09:00:00.000Z";
const rrhh: Role = "Nivel 1 - RRHH";
const supervision: Role = "Nivel 2 - Supervisión / Gestión";
const cargaHoraria: Role = "Nivel 3 - Administrativo de Carga Horaria";
const allRoles = [rrhh, supervision, cargaHoraria];
const baseHistory = (name: string) => [{ id: crypto.randomUUID(), action: "Alta inicial", description: `Se creo la hora especial ${name}.`, createdAt: now, createdByUserId: "system", createdByUserName: "Sistema" }];

function hourConcept(data: Partial<HourConcept> & Pick<HourConcept, "id" | "code" | "name" | "kind" | "description">): HourConcept {
  return {
    status: "ACTIVO",
    rules: { defaultUnit: "HORAS", maxDailyHours: 12 },
    allowedLoadRoles: allRoles,
    approvalRoles: [rrhh, supervision],
    finnegansLinks: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "Sistema",
    updatedBy: "Sistema",
    history: baseHistory(data.name),
    ...data,
  };
}

export const mockHourConcepts: HourConcept[] = [
  hourConcept({ id: "hc-normal", code: "HOR-001", name: "Hora normal", kind: "NORMAL", description: "Horas ordinarias trabajadas dentro de la jornada habitual." }),
  hourConcept({ id: "hc-extra-50", code: "HOR-002", name: "Hora extra 50%", kind: "EXTRA", description: "Horas extra en dias habiles con recargo del 50%.", rules: { defaultUnit: "HORAS", maxDailyHours: 6 } }),
  hourConcept({ id: "hc-extra-100", code: "HOR-003", name: "Hora extra 100%", kind: "EXTRA", description: "Horas extra en domingos, feriados o francos con recargo del 100%.", rules: { defaultUnit: "HORAS", maxDailyHours: 8 } }),
  hourConcept({ id: "hc-feriado", code: "HOR-004", name: "Feriado trabajado", kind: "FERIADO", description: "Horas trabajadas durante feriados." }),
  hourConcept({ id: "hc-nocturna", code: "HOR-005", name: "Hora nocturna", kind: "NOCTURNA", description: "Horas trabajadas en franja nocturna.", rules: { defaultUnit: "HORAS", maxDailyHours: 8 } }),
  hourConcept({ id: "hc-sereno", code: "HOR-006", name: "Sereno", kind: "SERENO", description: "Horas trabajadas bajo concepto de sereno." }),
  hourConcept({ id: "hc-guardia", code: "HOR-007", name: "Guardia", kind: "GUARDIA", description: "Horas trabajadas en esquema de guardia." }),
  hourConcept({ id: "hc-colectivo", code: "HOR-008", name: "Manejo de colectivo", kind: "TRANSPORTE", description: "Horas especiales por manejo de colectivo interno." }),
];
