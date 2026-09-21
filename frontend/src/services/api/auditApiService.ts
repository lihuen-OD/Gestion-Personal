import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData } from "../cache";
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

type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
type ApiAuditResponse = { data: ApiAuditLog[]; meta: ApiListMeta };

function isApiAuditResponse(value: ApiAuditResponse) {
  return Boolean(value && Array.isArray(value.data) && value.meta && typeof value.meta.total === "number");
}

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

// Etapa 15M.20: además de la lista puntual de arriba, cualquier propiedad
// que termine en "Id" es por definición un identificador técnico (FK interna
// a otra tabla) — nunca debe mostrarse cruda en el resumen de un cambio de
// auditoría, sin importar de qué modelo venga. Cubre de una sola vez
// workShiftId, hourConceptId, shiftTemplateId, startPunchId, endPunchId,
// timeSegmentId, reviewedByUserId, approvedByUserId, etc. — y cualquier FK
// nueva que se agregue en el futuro, sin tener que volver a esta lista.
function isHiddenKey(key: string) {
  return hiddenKeys.has(key) || /Id$/.test(key);
}

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
  observation: "Observación",
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
  employee: "Empleado",
  source: "Origen",
  startAt: "Inicio",
  endAt: "Fin",
  actualAt: "Registrado",
  scheduledAt: "Programado",
  reviewStatus: "Estado de revisión",
  reviewedAt: "Fecha de revisión",
  reviewNote: "Nota de revisión",
  closedAt: "Cierre",
  hours: "Horas",
  totalMinutes: "Minutos totales",
  actualMinutes: "Minutos reales",
  appliedMultiplier: "Multiplicador aplicado",
  segmentStartAt: "Inicio del segmento",
  segmentEndAt: "Fin del segmento",
  approvedAt: "Fecha de aprobación",
  rejectedAt: "Fecha de rechazo",
  differenceMinutes: "Diferencia en minutos",
  removed: "Eliminados",
  processedShifts: "Jornadas procesadas",
  eligible: "Elegibles",
};

function labelFor(key: string) {
  return labels[key] || humanizeKey(key);
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") return String(value);
  return "";
}

// Etapa 15M.20: sólo estas claves son TIMESTAMPTZ reales (instante) en
// schema.prisma — startAt/endAt/actualAt/scheduledAt/reviewedAt/approvedAt/
// rejectedAt/closedAt/segmentStartAt/segmentEndAt. `date` (TimeEntry, etc.)
// es `@db.Date`, calendario puro: convertirlo con `new Date().toLocaleDate
// String()` lo corre un día para atrás en Argentina (UTC-3) si el backend
// lo serializa a medianoche UTC — mismo riesgo que docs/DATABASE_STANDARDS.md
// documenta para el resto de la app. Por eso el formateo de instante va acá,
// restringido por nombre de clave, y NO como detección genérica por forma de
// string en `formatPrimitive` (que no sabe a qué clave pertenece el valor).
const instantKeys = new Set([
  "startAt", "endAt", "actualAt", "scheduledAt", "reviewedAt", "approvedAt",
  "rejectedAt", "closedAt", "segmentStartAt", "segmentEndAt",
]);
const isoInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

function formatInstantValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString("es-AR")} ${date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
}

function displayValueForKey(key: string, entryValue: unknown): string {
  if (Array.isArray(entryValue)) return summarizeList(entryValue);
  if (instantKeys.has(key) && typeof entryValue === "string" && isoInstantPattern.test(entryValue)) {
    return formatInstantValue(entryValue);
  }
  return displayName(entryValue);
}

function displayName(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value !== "object") return formatPrimitive(value);
  const record = value as Record<string, unknown>;
  if (record.hourConcept && typeof record.hourConcept === "object") return displayName(record.hourConcept);
  if (record.category && typeof record.category === "object") return displayName(record.category);
  if (record.company && typeof record.company === "object") return displayName(record.company);
  if (record.user && typeof record.user === "object") return displayName(record.user);
  if (record.employee && typeof record.employee === "object") return displayName(record.employee);
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
    ([key, entryValue]) => !isHiddenKey(key) && entryValue !== undefined && entryValue !== null && entryValue !== "",
  );
  if (!entries.length) return "-";
  return entries
    .slice(0, 8)
    .map(([key, entryValue]) => `${labelFor(key)}: ${displayValueForKey(key, entryValue)}`)
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

const employeeAuditFields: Array<{ field: string; label: string }> = [
  { field: "legajo", label: "Legajo Interno" },
  { field: "legajoFinnegans", label: "Legajo Finnegans" },
  { field: "lastName", label: "Apellido" },
  { field: "firstName", label: "Nombre" },
  { field: "dni", label: "DNI" },
  { field: "cuil", label: "CUIL" },
  { field: "birthDate", label: "Fecha de nacimiento" },
  { field: "gender", label: "Sexo" },
  { field: "civilStatus", label: "Estado civil" },
  { field: "nationality", label: "Nacionalidad" },
  { field: "phone", label: "Teléfono" },
  { field: "mobile", label: "Celular" },
  { field: "email", label: "Email" },
  { field: "emergencyContact", label: "Contacto de emergencia" },
  { field: "emergencyRelation", label: "Parentesco" },
  { field: "emergencyPhone", label: "Teléfono de emergencia" },
  { field: "address.street", label: "Calle" },
  { field: "address.streetNumber", label: "Número" },
  { field: "address.province", label: "Provincia" },
  { field: "address.department", label: "Departamento" },
  { field: "address.city", label: "Localidad" },
  { field: "address.postalCode", label: "Código postal" },
];

function valueAt(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((value, key) => (
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined
  ), source);
}

export function auditFieldChanges(before: unknown, after: unknown) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  return employeeAuditFields.flatMap(({ field, label }) => {
    const previous = formatPrimitive(valueAt(before, field));
    const next = formatPrimitive(valueAt(after, field));
    return previous === next ? [] : [{ field, label, previous, next }];
  });
}

function mapFromApi(item: ApiAuditLog): AuditEntry {
  const parts = dateParts(item.createdAt);
  return {
    id: item.id,
    date: parts.date,
    time: parts.time,
    user: item.user?.name || "Sistema",
    role: item.user?.role || "-",
    action: item.action,
    entity: item.entity,
    field: item.entityId || undefined,
    previous: summarizeChange(item.before),
    next: summarizeChange(item.after),
    reason: item.description,
    changes: item.entity === "Employee" ? auditFieldChanges(item.before, item.after) : [],
  };
}

export const auditApiService = {
  // Etapa 14F.2: `cachedData` agrega dedupe in-flight (StrictMode pedía
  // /audit dos veces por mount) + TTL corto de lectura — sin esto, el
  // backend ya cachea 15s (`auditListCache`), pero el frontend no. La
  // requestKey incluye el query string completo (page/take/entity/entityId)
  // para que filtros distintos (ej. take=5 del Dashboard vs. take=25 de
  // AuditPage) nunca compartan resultado. No se toca `auditListCache` del
  // backend ni `auditService.register()` — ver docs/decisions/
  // INITIAL_APP_LANDING_OPTIMIZATION_14F2.md.
  async list(filters?: { entity?: string; entityId?: string; page?: number; take?: number }) {
    const params = new URLSearchParams();
    params.set("page", String(filters?.page || 1));
    params.set("take", String(filters?.take || 25));
    if (filters?.entity) params.set("entity", filters.entity);
    if (filters?.entityId) params.set("entityId", filters.entityId);
    const query = params.toString();
    const response = await cachedData({
      requestKey: `GET:/audit?${query}`,
      policy: cachePolicies.auditList,
      fetcher: () => apiRequest<ApiAuditResponse>(`/audit?${query}`),
      validate: isApiAuditResponse,
    });
    return { items: response.data.map(mapFromApi), meta: response.meta };
  },
  async getAll(filters?: { entity?: string; entityId?: string; take?: number }) {
    const result = await auditApiService.list(filters);
    return result.items;
  },
};
