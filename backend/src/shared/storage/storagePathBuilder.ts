import { argentinaDateParts } from "../datetime/argentinaTime";
import { safeDriveFolderName } from "./storageValidation";
import type { DriveFolderSpec } from "./storage.types";

/**
 * Rutas de storage (docs/decisions/F12_PERF_3_4.md, "Layout humano en Drive").
 *
 * - Ubicación TÉCNICA (`folderSegments` + nombre): key en Neon/local. ASCII,
 *   basada en ids inmutables; nunca depende de nombres de personas.
 * - Ubicación HUMANA (`driveFolders` + nombre): sólo Google Drive. Se arma con
 *   datos básicos que todo legajo tiene (legajo, nombre, apellido) — nunca
 *   con puesto, empresa, establecimiento, sector ni dispositivo.
 *
 * Todo en hora argentina (`argentinaDateParts`), nunca UTC.
 */

function safeSegment(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function assertSegments(segments: string[]) {
  const safe = segments.map(safeSegment).filter(Boolean);
  if (safe.length !== segments.length || safe.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Invalid storage path segment");
  }
  return safe;
}

function dateParts(date: Date) {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

const MONTH_NAMES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"] as const;

/** Parte portable de un nombre de archivo: sin acentos (Ñ → N), sólo [A-Za-z0-9] unidos por "-". */
function portablePart(value: string, maxLength: number) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function extensionPart(extension: string) {
  const safe = extension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return safe ? `.${safe}` : "";
}

/** Sufijo corto legible (6 caracteres alfanuméricos) de un id técnico. */
function shortId(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toLowerCase();
}

export interface StorageEmployeeIdentity {
  legajo: string;
  firstName: string;
  lastName: string;
}

export interface StorageDocumentCategory {
  name: string;
  kind?: string | null;
}

export interface DriveFileLocation {
  driveFolders: DriveFolderSpec[];
  fileName: string;
}

export interface EmployeeDocumentLocation extends DriveFileLocation {
  /** Key técnica (si los documentos fueran a Neon/local): por employeeId, nunca por nombre. */
  folderSegments: string[];
}

export type ArchivePunchType = "INGRESO" | "SALIDA";

const DRIVE_ROOTS = { legajos: "Legajos", fichadas: "Fichadas", unlinked: "_Sin vincular" } as const;

function normalizedText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** `<legajo> - <Nombre> <Apellido>`, conservando espacios, acentos y Ñ. */
function employeeFolderName(employee: StorageEmployeeIdentity) {
  const name = safeDriveFolderName(`${employee.legajo.trim()} - ${employee.firstName.trim()} ${employee.lastName.trim()}`);
  if (!name) throw new Error("Invalid employee folder name");
  return name;
}

/**
 * Carpeta de Drive de una categoría documental. Clasifica por
 * `DocumentCategory.kind` (enum validado), salvo dos excepciones por nombre:
 * domicilio (no tiene kind propio) y licencia de conducir/carnet (va a
 * Transporte aunque su nombre contenga "licencia" o su kind no sea TRANSPORTE).
 */
function documentDriveFolder(category: StorageDocumentCategory) {
  const name = normalizedText(category.name || "");
  if (name.includes("domicilio")) return "Domicilio";
  if (name.includes("conducir") || name.includes("carnet")) return "Transporte";
  switch (category.kind) {
    case "PERSONAL":
      return "Documentos personales";
    case "LABORAL":
    case "LEGAL":
      return "Contratos";
    case "MEDICA":
      return "Certificados";
    case "NOVEDAD":
      return "Licencias";
    case "TRANSPORTE":
      return "Transporte";
    case "CAPACITACION":
      return "Estudios";
    case "LIQUIDACION":
      return "Liquidaciones";
    default:
      return "Otros";
  }
}

function archivePunchType(value: string | null | undefined): ArchivePunchType | null {
  if (value === "INGRESO" || value === "IN") return "INGRESO";
  if (value === "SALIDA" || value === "OUT") return "SALIDA";
  return null;
}

function monthFolder(month: number) {
  return `${pad2(month)} - ${MONTH_NAMES_ES[month - 1]}`;
}

export const storagePathBuilder = {
  documentDriveFolder,
  employeeFolderName,
  archivePunchType,

  /**
   * Documento de legajo nuevo:
   * Drive `Legajos/<legajo - Nombre Apellido>/<carpeta por categoría>/`
   * + `AAAA-MM-DD_<Tipo>_<Nombre-Apellido>_<sufijo>.<ext>`.
   * La carpeta del empleado se identifica por `appProperties.employeeId`
   * (si cambia nombre o legajo se reutiliza y renombra). `uniqueSuffix` es
   * aleatorio por archivo: dos subidas iguales nunca comparten nombre.
   */
  employeeDocument(input: {
    employeeId: string;
    employee: StorageEmployeeIdentity;
    category: StorageDocumentCategory;
    uploadedAt: Date;
    extension: string;
    uniqueSuffix: string;
  }): EmployeeDocumentLocation {
    const categoryFolder = documentDriveFolder(input.category);
    const date = argentinaDateParts(input.uploadedAt).key;
    const type = portablePart(input.category.name || "", 40) || "Documento";
    const person = portablePart(`${input.employee.firstName} ${input.employee.lastName}`, 60);
    const suffix = shortId(input.uniqueSuffix);
    const fileName = [date, type, person, suffix].filter(Boolean).join("_") + extensionPart(input.extension);
    return {
      folderSegments: assertSegments(["legajos", input.employeeId, categoryFolder.toLowerCase()]),
      driveFolders: [
        { name: DRIVE_ROOTS.legajos },
        { name: employeeFolderName(input.employee), appProperties: { employeeId: input.employeeId } },
        { name: categoryFolder },
      ],
      fileName,
    };
  },

  /**
   * Copia en Drive de la foto de una fichada:
   * `Fichadas/<AAAA>/<MM - Mes>/<legajo - Nombre Apellido>/`
   * + `AAAA-MM-DD_HH-mm_<INGRESO|SALIDA>_<requestId corto>.<ext>`.
   * Fotografía histórica por mes: usa el nombre vigente al archivar.
   */
  attendanceArchive(input: {
    employee: StorageEmployeeIdentity;
    punchType: ArchivePunchType;
    timestamp: Date;
    requestId: string;
    extension: string;
  }): DriveFileLocation {
    const parts = argentinaDateParts(input.timestamp);
    return {
      driveFolders: [
        { name: DRIVE_ROOTS.fichadas },
        { name: String(parts.year) },
        { name: monthFolder(parts.month) },
        { name: employeeFolderName(input.employee) },
      ],
      fileName: `${parts.key}_${pad2(parts.hour)}-${pad2(parts.minute)}_${input.punchType}_${shortId(input.requestId)}${extensionPart(input.extension)}`,
    };
  },

  /**
   * Fallback defensivo (datos legacy/inconsistentes): evidencia sin fichada
   * vinculada. `Fichadas/_Sin vincular/<AAAA>/<MM - Mes>/[<empleado>/]`. El
   * worker lo registra como inconsistencia observable — nunca es la ruta de
   * una fichada normal.
   */
  unlinkedAttendanceArchive(input: {
    employee?: StorageEmployeeIdentity | null;
    punchType?: ArchivePunchType | null;
    timestamp: Date;
    requestId: string;
    extension: string;
  }): DriveFileLocation {
    const parts = argentinaDateParts(input.timestamp);
    const driveFolders: DriveFolderSpec[] = [
      { name: DRIVE_ROOTS.fichadas },
      { name: DRIVE_ROOTS.unlinked },
      { name: String(parts.year) },
      { name: monthFolder(parts.month) },
    ];
    if (input.employee) driveFolders.push({ name: employeeFolderName(input.employee) });
    return {
      driveFolders,
      fileName: `${parts.key}_${pad2(parts.hour)}-${pad2(parts.minute)}_${input.punchType || "SIN-TIPO"}_${shortId(input.requestId)}${extensionPart(input.extension)}`,
    };
  },

  novelty(date: Date) {
    const parts = dateParts(date);
    return assertSegments(["storage-sistema", "novedades", parts.year, parts.month]);
  },

  temporary() {
    return assertSegments(["storage-sistema", "temporales"]);
  },
};
