import { apiRequest } from "./apiClient";
import type { AuditEntry } from "../../types";

type ApiAuditLog = {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  description: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
  user?: {
    name: string;
    role: string;
  } | null;
};

type ApiAuditResponse = { data: ApiAuditLog[] };

function dateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value.slice(0, 10), time: "" };
  return {
    date: date.toLocaleDateString("es-AR"),
    time: date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function humanizeKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

const hiddenKeys = new Set([
  "id",
  "employeeId",
  "userId",
  "createdAt",
  "updatedAt",
  "createdByUserId",
  "uploadedByUserId",
  "passwordHash",
]);

const labels: Record<string, string> = {
  legajo: "Legajo",
  legajoFinnegans: "Legajo Finnegans",
  cuil: "CUIL",
  dni: "DNI",
  firstName: "Nombre",
  lastName: "Apellido",
  birthDate: "Fecha de nacimiento",
  gender: "Sexo",
  civilStatus: "Estado civil",
  nationality: "Nacionalidad",
  status: "Estado",
  email: "Email",
  phone: "Telefono",
  mobile: "Celular",
  emergencyContact: "Contacto emergencia",
  emergencyRelation: "Parentesco",
  emergencyPhone: "Telefono emergencia",
  street: "Calle",
  streetNumber: "Numero",
  city: "Localidad",
  department: "Departamento",
  province: "Provincia",
  postalCode: "Codigo postal",
  mapLabel: "Ubicacion",
  usesCompanyTransport: "Usa transporte",
  locality: "Localidad",
  busLine: "Linea",
  observation: "Observacion",
  type: "Tipo",
  reason: "Motivo",
  effectiveFrom: "Fecha desde",
  effectiveTo: "Fecha hasta",
  personName: "Persona",
  role: "Rol",
  notes: "Notas",
  fileName: "Archivo",
  statusText: "Estado",
  name: "Nombre",
};

function labelFor(key: string) {
  return labels[key] || humanizeKey(key);
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function displayName(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value !== "object") return formatPrimitive(value);
  const record = value as Record<string, unknown>;
  if (record.hourConcept && typeof record.hourConcept === "object") return displayName(record.hourConcept);
  if (record.category && typeof record.category === "object") return displayName(record.category);
  if (record.company && typeof record.company === "object") return displayName(record.company);
  if (record.user && typeof record.user === "object") return displayName(record.user);
  if (record.firstName || record.lastName) return [record.firstName, record.lastName].filter(Boolean).join(" ");
  if (record.name) return String(record.name);
  if (record.fileName) return String(record.fileName);
  if (record.personName) return String(record.personName);
  if (record.type || record.reason || record.effectiveFrom) {
    return [record.type, record.reason, record.effectiveFrom].filter(Boolean).join(" - ");
  }
  return stringify(value);
}

function summarizeList(value: unknown): string {
  if (!Array.isArray(value)) return displayName(value);
  if (!value.length) return "Sin registros";
  return value.map(displayName).filter(Boolean).join(", ");
}

function summarizeObject(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(
    ([key, entryValue]) => !hiddenKeys.has(key) && entryValue !== undefined && entryValue !== null && entryValue !== "",
  );
  if (!entries.length) return "-";
  return entries
    .slice(0, 8)
    .map(([key, entryValue]) => `${labelFor(key)}: ${Array.isArray(entryValue) ? summarizeList(entryValue) : displayName(entryValue)}`)
    .join(" | ");
}

function summarizeChange(value: unknown): string {
  if (Array.isArray(value)) return summarizeList(value);
  if (value && typeof value === "object") return summarizeObject(value as Record<string, unknown>);
  return formatPrimitive(value);
}

function stringify(value: unknown): string {
  const primitive = formatPrimitive(value);
  if (primitive) return primitive;
  if (Array.isArray(value)) {
    if (!value.length) return "Sin registros";
    return value
      .slice(0, 5)
      .map((item, index): string => {
        const formatted: string = stringify(item);
        return `${index + 1}. ${formatted}`;
      })
      .join(" | ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, entryValue]) => entryValue !== undefined);
    if (!entries.length) return "-";
    return entries
      .slice(0, 8)
      .map(([key, entryValue]): string => `${humanizeKey(key)}: ${stringify(entryValue)}`)
      .join(" | ");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function actionLabel(action: string) {
  return {
    CREATE: "Alta",
    UPDATE: "Modificacion",
    DELETE: "Eliminacion",
    ACTIVATE: "Activacion",
    DEACTIVATE: "Inactivacion",
    APPROVE: "Aprobacion",
    REJECT: "Rechazo",
    RETURN: "Devolucion",
    LOGIN: "Ingreso",
    EXPORT: "Exportacion",
  }[action] || action;
}

function mapFromApi(item: ApiAuditLog): AuditEntry {
  const parts = dateParts(item.createdAt);
  return {
    id: item.id,
    date: parts.date,
    time: parts.time,
    user: item.user?.name || "Sistema",
    role: item.user?.role || "-",
    action: actionLabel(item.action),
    entity: item.entity,
    field: item.entityId || undefined,
    previous: summarizeChange(item.before),
    next: summarizeChange(item.after),
    reason: item.description,
  };
}

export const auditApiService = {
  async getAll(filters?: { entity?: string; entityId?: string; take?: number }) {
    const params = new URLSearchParams();
    params.set("take", String(filters?.take || 200));
    if (filters?.entity) params.set("entity", filters.entity);
    if (filters?.entityId) params.set("entityId", filters.entityId);
    const response = await apiRequest<ApiAuditResponse>(`/audit?${params.toString()}`);
    return response.data.map(mapFromApi);
  },
};
