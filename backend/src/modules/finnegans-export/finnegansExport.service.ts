import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { isMonthlyClosureApproved } from "../../shared/monthlyClosure/closureLock";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { finnegansExportRepository, type FinnegansExportNovelty } from "./finnegansExport.repository";
import { resolvePrincipalFinnegansLink } from "./finnegansExport.principalLink";
import { buildReadinessSummary, evaluateNoveltyReadiness, type FinnegansReadinessSummary, type FinnegansRowStatus } from "./finnegansExport.readiness";
import type { FinnegansExportQuery } from "./finnegansExport.schemas";

export type FinnegansExportRow = {
  Legajo: string;
  Novedad: string;
  "Centro de costo": string;
  "Valor 1": string;
  "Fecha Aplicación": string;
  "Fecha desde": string;
  "Fecha hasta": string;
  sourceId?: string;
  employeeId?: string;
  employeeName?: string;
  detail?: string;
  // Etapa 15L.3A §30: sólo para la tabla de preview del frontend — nunca se
  // incluye en las columnas de CSV/XLSX (`toCsv` abajo lee una lista fija de
  // encabezados que no incluye este campo).
  estado?: FinnegansRowStatus;
};

export type FinnegansExportResult = {
  period: string;
  rows: FinnegansExportRow[];
  readiness: FinnegansReadinessSummary;
};

function formatDate(value: Date | null | undefined) {
  if (!value) return "";
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const year = value.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function decimalToString(value: Prisma.Decimal | null | undefined) {
  if (!value) return "";
  return value.toString();
}

// Etapa 15L.3A §8/§9/§10: Valor 1 depende exclusivamente de
// NoveltyType.finnegansValueUnit — ya no hay fallback
// quantityHours→quantityDays→"1". Sólo se usa cuando la unidad está
// definida; si falta la cantidad correspondiente resuelve "" (la fila queda
// igual marcada MISSING_HOURS_QUANTITY/MISSING_DAYS_QUANTITY por
// evaluateNoveltyReadiness, que es la única fuente de verdad sobre si la
// fila puede exportarse en forma definitiva).
function resolveValue1(unit: FinnegansExportNovelty["noveltyType"]["finnegansValueUnit"], quantityHours: Prisma.Decimal | null, quantityDays: Prisma.Decimal | null): string {
  if (unit === "HOURS") return decimalToString(quantityHours);
  if (unit === "DAYS") return decimalToString(quantityDays);
  if (unit === "UNIT") return "1";
  return "";
}

interface DatasetRow {
  employeeId: string;
  row: FinnegansExportRow;
  ready: boolean;
  hasNonClosureBlocker: boolean;
  reasonCodes: ReturnType<typeof evaluateNoveltyReadiness>["reasonCodes"];
}

function buildRow(item: FinnegansExportNovelty, closureApproved: boolean): DatasetRow {
  const principalLink = resolvePrincipalFinnegansLink(item.noveltyType.finnegansLinks);
  const unit = item.noveltyType.finnegansValueUnit;
  const requiresValidity = item.noveltyType.finnegansRequiresValidity;

  const readiness = evaluateNoveltyReadiness({
    quantityHours: item.quantityHours,
    quantityDays: item.quantityDays,
    toDate: item.toDate,
    finnegansValueUnit: unit,
    finnegansRequiresValidity: requiresValidity,
    hasPrincipalLink: !!principalLink,
    closureApproved,
  });

  const row: FinnegansExportRow = {
    Legajo: item.employee.legajoFinnegans || item.employee.legajo,
    Novedad: principalLink?.code || "",
    // Etapa 15L.3A §14: auditado, sin evidencia de una regla real para
    // llenarlo — se mantiene vacío tal como hoy (ver
    // docs/NOVEDADES_HORAS_FINNEGANS.md: "Si queda vacío, Finnegans toma el
    // del legajo").
    "Centro de costo": "",
    "Valor 1": resolveValue1(unit, item.quantityHours, item.quantityDays),
    // Etapa 15L.3A §13: sin evidencia de un comportamiento distinto, se
    // mantiene Fecha Aplicación = fromDate, sin cambios.
    "Fecha Aplicación": formatDate(item.fromDate),
    // Etapa 15L.3A §11/§12: fuente nueva finnegansRequiresValidity (ya no el
    // OR legacy `NoveltyType.hasValidity || link.hasValidity`). Si falta
    // toDate con vigencia requerida, no se inventa una fecha — la fila queda
    // bloqueada (MISSING_VALIDITY_TO_DATE) y Fecha hasta sale "" (formatDate
    // ya es null-safe), nunca se recorta ni se reemplaza Fecha desde.
    "Fecha desde": requiresValidity ? formatDate(item.fromDate) : "",
    "Fecha hasta": requiresValidity ? formatDate(item.toDate) : "",
    sourceId: item.id,
    employeeId: item.employeeId,
    employeeName: `${item.employee.lastName}, ${item.employee.firstName}`,
    detail: item.noveltyType.name,
    estado: readiness.estado,
  };

  return {
    employeeId: item.employeeId,
    row,
    ready: readiness.ready,
    hasNonClosureBlocker: readiness.reasonCodes.some((code) => code !== "CLOSURE_NOT_APPROVED"),
    reasonCodes: readiness.reasonCodes,
  };
}

function escapeCsv(value: string) {
  if (/[",\r\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Etapa 15L.3A §27: columnas sin cambios (mismo orden, mismos encabezados,
// incluido el acento en "Fecha Aplicación" que ya traía el backend) — el
// exportador nunca escribe "estado" acá, sin importar qué traiga la fila.
export function toCsv(rows: FinnegansExportRow[]) {
  const headers: (keyof FinnegansExportRow)[] = [
    "Legajo",
    "Novedad",
    "Centro de costo",
    "Valor 1",
    "Fecha Aplicación",
    "Fecha desde",
    "Fecha hasta",
  ];
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => escapeCsv(String(row[header] ?? ""))).join(";"))].join("\r\n");
}

// Etapa 15L.3A §3/§17/§18: candidatas = filtro base del repositorio
// (status/tipo/período, sin exigir todavía vínculo/valor/cierre); acá se
// calcula, por fila, si además está LISTA para exportar (readiness) y se
// agrega el resumen que consume tanto preview como definitivo. El cierre
// mensual se consulta siempre (también en preview, para poder informarlo
// como blocker sin bloquear la pantalla — §17) pero sólo para los empleados
// que efectivamente tienen alguna novedad candidata (§19: quien no tiene
// ninguna novedad exportable no aparece acá y no se le pide cierre).
async function buildDataset(period: string, employeeId?: string): Promise<{ rows: DatasetRow[]; readiness: FinnegansReadinessSummary }> {
  const novelties = await finnegansExportRepository.findExportableNovelties(period, employeeId);
  const employeeIds = Array.from(new Set(novelties.map((item) => item.employeeId)));
  const closures = employeeIds.length ? await finnegansExportRepository.findClosuresForExport(employeeIds, period) : [];
  const closuresByEmployeeId = new Map(closures.map((closure) => [closure.employeeId, closure]));

  const rows = novelties.map((item) => buildRow(item, isMonthlyClosureApproved(closuresByEmployeeId.get(item.employeeId))));
  const readiness = buildReadinessSummary(
    rows.map((entry) => ({ employeeId: entry.employeeId, readiness: { ready: entry.ready, estado: entry.row.estado!, reasonCodes: entry.reasonCodes } })),
  );

  return { rows, readiness };
}

export const finnegansExportService = {
  // Etapa 15L.3A §15/§17/§24: NO exige cierre aprobado y NO audita — sólo
  // informa. `readiness` viaja igual que en el endpoint definitivo para que
  // el frontend pueda mostrar los mismos blockers (incluido cierre
  // pendiente) sin bloquear el acceso a la pantalla.
  async getPreview(query: Pick<FinnegansExportQuery, "period" | "employeeId">): Promise<FinnegansExportResult> {
    const { rows, readiness } = await buildDataset(query.period, query.employeeId);
    return { period: query.period, rows: rows.map((entry) => entry.row), readiness };
  },

  // Etapa 15L.3A §15/§18/§22/§23/§24: revalida todo desde cero (nunca confía
  // en una preview previa), exige que CADA fila esté lista (readiness.ready)
  // y, dentro de eso, que el cierre mensual de cada empleado incluido esté
  // APROBADO. Si hay cualquier blocker de datos (vínculo/unidad/cantidad/
  // vigencia, independiente del cierre), ese es el error que se reporta
  // primero — corregir la configuración de una novedad no depende de que
  // además se apruebe un cierre, así que no tiene sentido devolver el código
  // de cierre cuando en realidad el problema es de datos.
  async getDefinitive(query: Pick<FinnegansExportQuery, "period" | "employeeId">, audit?: AuditContext): Promise<FinnegansExportResult> {
    const { rows, readiness } = await buildDataset(query.period, query.employeeId);

    if (!readiness.ready) {
      const hasDataBlocker = rows.some((entry) => entry.hasNonClosureBlocker);
      if (hasDataBlocker) {
        throw new AppError("Hay novedades que necesitan completar su configuración antes de exportar.", 409, "FINNEGANS_EXPORT_NOT_READY");
      }
      throw new AppError("El período tiene cierres pendientes para personas incluidas en la exportación.", 409, "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED");
    }

    await auditService.register({
      ...audit,
      action: "EXPORT",
      entity: "FinnegansExport",
      description: `Se autorizó la exportación Finnegans definitiva de ${query.period} con ${rows.length} registros. El archivo se genera en el navegador a partir de este resultado.`,
      after: { period: query.period, totalRows: rows.length } as Prisma.InputJsonValue,
    });

    return { period: query.period, rows: rows.map((entry) => entry.row), readiness };
  },
};
