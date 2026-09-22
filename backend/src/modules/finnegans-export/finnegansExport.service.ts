import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { humanizePeriodEs } from "../../shared/datetime/argentinaTime";
import { isMonthlyClosureApproved } from "../../shared/monthlyClosure/closureLock";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { finnegansExportRepository, type FinnegansExportNovelty } from "./finnegansExport.repository";
import { buildReadinessSummary, evaluateNoveltyReadiness, type FinnegansReadinessSummary, type FinnegansRowStatus } from "./finnegansExport.readiness";
import { finnegansExportBatchRepository, type CreateBatchItemInput } from "./finnegansExport.batch.repository";
import { computeExportHash } from "./finnegansExport.hash";
import { diffBatchItems, type BatchDiffSummary } from "./finnegansExport.diff";
import type { FinnegansExportHistoryQuery, FinnegansExportQuery, FinnegansExportRequest } from "./finnegansExport.schemas";

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

// Etapa 15L.4 (docs/decisions/FINNEGANS_EXPORT_HISTORY_IDEMPOTENCY_15L4.md
// §26): forma humana de un batch — nunca se muestran ids técnicos como
// mensaje, `id` viaja sólo como referencia de navegación (mismo criterio ya
// usado para `sourceId`/`employeeId` en las filas desde 15L.3A).
export type FinnegansExportBatchSummary = {
  id: string;
  version: number;
  format: "XLSX" | "CSV";
  createdAt: string;
  createdByName: string | null;
  rowCount: number;
  reason: string | null;
  isReexport: boolean;
  sameAsPrevious: boolean;
};

export type FinnegansExportPreviewResult = FinnegansExportResult & {
  hash: string;
  lastExport: (FinnegansExportBatchSummary & { sameAsCurrent: boolean }) | null;
};

export type FinnegansExportDefinitiveResult = {
  period: string;
  rows: FinnegansExportRow[];
  readiness: FinnegansReadinessSummary;
  batch: FinnegansExportBatchSummary & { diff: BatchDiffSummary | null };
};

export type FinnegansExportHistoryEntry = FinnegansExportBatchSummary & { diff: BatchDiffSummary | null };

export type FinnegansExportHistoryResult = {
  period: string;
  batches: FinnegansExportHistoryEntry[];
};

export type FinnegansExportHistoryDetailResult = {
  batch: FinnegansExportBatchSummary;
  rows: FinnegansExportRow[];
  diff: BatchDiffSummary | null;
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
  const unit = item.noveltyType.finnegansValueUnit;
  const requiresValidity = item.noveltyType.finnegansRequiresValidity;

  const readiness = evaluateNoveltyReadiness({
    quantityHours: item.quantityHours,
    quantityDays: item.quantityDays,
    toDate: item.toDate,
    finnegansValueUnit: unit,
    finnegansRequiresValidity: requiresValidity,
    hasFinnegansCode: !!item.noveltyType.finnegansCode,
    closureApproved,
  });

  const row: FinnegansExportRow = {
    Legajo: item.employee.legajoFinnegans || item.employee.legajo,
    Novedad: item.noveltyType.finnegansCode || "",
    // Etapa 15L.3A §14: auditado, sin evidencia de una regla real para
    // llenarlo — se mantiene vacío tal como hoy (ver
    // docs/NOVEDADES_HORAS_FINNEGANS.md: "Si queda vacío, Finnegans toma el
    // del legajo").
    "Centro de costo": "",
    "Valor 1": resolveValue1(unit, item.quantityHours, item.quantityDays),
    // Etapa 15L.3A §13: sin evidencia de un comportamiento distinto, se
    // mantiene Fecha Aplicación = fromDate, sin cambios.
    "Fecha Aplicación": formatDate(item.fromDate),
    // Etapa 15L.3A §11/§12: fuente única finnegansRequiresValidity. Si falta
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

// Etapa 15L.3A §3/§17/§18 / 15L.3B.1: candidatas = filtro base del
// repositorio (status/tipo/pertenencia mensual por fromDate, sin exigir
// todavía vínculo/valor/cierre); acá se calcula, por fila, si además está
// LISTA para exportar (readiness) y se agrega el resumen que consume tanto
// preview como definitivo. El cierre mensual se consulta siempre (también
// en preview, para poder informarlo como blocker sin bloquear la pantalla)
// pero sólo para los empleados que efectivamente tienen alguna novedad
// candidata.
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

// Etapa 15L.4 §5/§6: convierte una fila candidata en el snapshot que se
// persiste (y en la base del hash) — exactamente las 7 columnas exportadas
// más las referencias técnicas internas (noveltyId/employeeId) y dos
// campos de presentación (employeeName/detail) que nunca se muestran como
// "el dato exportado" pero ayudan a leer el historial sin adivinar quién es
// cada legajo.
function toRowSnapshot(entry: DatasetRow): CreateBatchItemInput {
  return {
    noveltyId: entry.row.sourceId ?? null,
    employeeId: entry.employeeId,
    legajo: entry.row.Legajo,
    employeeName: entry.row.employeeName ?? "",
    noveltyCode: entry.row.Novedad,
    detail: entry.row.detail ?? "",
    costCenter: entry.row["Centro de costo"],
    value1: entry.row["Valor 1"],
    applicationDate: entry.row["Fecha Aplicación"],
    validFrom: entry.row["Fecha desde"],
    validTo: entry.row["Fecha hasta"],
  };
}

// Reconstruye una fila pública desde un snapshot persistido — usada tanto
// para el atajo de idempotencia (mismo idempotencyKey → misma respuesta,
// reconstruida del batch ya creado, nunca del dataset en vivo) como para el
// detalle de historial. `estado` siempre es "LISTO": un batch sólo existe
// si, al momento de crearlo, todas sus filas estaban listas.
function toExportRowFromSnapshot(item: { legajo: string; noveltyCode: string; costCenter: string; value1: string; applicationDate: string; validFrom: string; validTo: string; employeeName: string; detail: string }): FinnegansExportRow {
  return {
    Legajo: item.legajo,
    Novedad: item.noveltyCode,
    "Centro de costo": item.costCenter,
    "Valor 1": item.value1,
    "Fecha Aplicación": item.applicationDate,
    "Fecha desde": item.validFrom,
    "Fecha hasta": item.validTo,
    employeeName: item.employeeName,
    detail: item.detail,
    estado: "LISTO",
  };
}

function toBatchSummary(batch: {
  id: string;
  version: number;
  format: "XLSX" | "CSV";
  createdAt: Date;
  createdBy: { name: string } | null;
  rowCount: number;
  reason: string | null;
  hash: string;
  previousBatch: { hash: string } | null;
}): FinnegansExportBatchSummary {
  return {
    id: batch.id,
    version: batch.version,
    format: batch.format,
    createdAt: batch.createdAt.toISOString(),
    createdByName: batch.createdBy?.name ?? null,
    rowCount: batch.rowCount,
    reason: batch.reason,
    isReexport: batch.version > 1,
    sameAsPrevious: batch.previousBatch ? batch.previousBatch.hash === batch.hash : false,
  };
}

// Etapa 15L.4 §15/§16: diff vs. el batch inmediato anterior — null si no hay
// anterior (v1). Se recibe el `previousBatchId` en vez de un batch entero
// para no forzar al caller a haberlo cargado de antemano.
async function computeDiff(previousBatchId: string | null, currentItems: readonly CreateBatchItemInput[]): Promise<BatchDiffSummary | null> {
  if (!previousBatchId) return null;
  const previous = await finnegansExportBatchRepository.findByIdWithItems(previousBatchId);
  return diffBatchItems(previous?.items ?? null, currentItems);
}

// Etapa 15L.4 §23/§24: mismo idempotencyKey ya usado → se reconstruye la
// MISMA respuesta desde lo persistido, sin volver a validar readiness/cierre
// ni crear una versión nueva. Esto es deliberadamente distinto de una
// reexportación voluntaria (que siempre manda una key nueva).
async function buildDefinitiveResultFromStoredBatch(batch: Awaited<ReturnType<typeof finnegansExportBatchRepository.findByIdempotencyKey>> & object): Promise<FinnegansExportDefinitiveResult> {
  const diff = await computeDiff(batch.previousBatchId, batch.items);
  return {
    period: batch.period,
    rows: batch.items.map(toExportRowFromSnapshot),
    readiness: { ready: true, totalRows: batch.items.length, readyRows: batch.items.length, blockedRows: 0, reasons: [] },
    batch: { ...toBatchSummary(batch), diff },
  };
}

// Etapa 15L.4 §10: la primera exportación de un período no exige motivo; a
// partir de la segunda, sí — decidido por el backend (existencia real de un
// batch anterior), nunca confiando sólo en que el frontend lo haya pedido.
// La longitud mínima (5 caracteres) ya la exige
// finnegansExportRequestSchema cuando el campo viene presente — acá sólo se
// exige la PRESENCIA cuando corresponde.
async function assertReexportReason(period: string, reexportReason: string | undefined): Promise<boolean> {
  const hasPriorBatch = await finnegansExportBatchRepository.hasAnyBatch(period);
  if (hasPriorBatch && !reexportReason) {
    throw new AppError("Reexportar este período requiere indicar un motivo.", 400, "FINNEGANS_EXPORT_REASON_REQUIRED");
  }
  return hasPriorBatch;
}

export const finnegansExportService = {
  // Etapa 15L.3A §15/§17/§24 / 15L.4 §29: NO exige cierre aprobado y NO
  // audita — sólo informa. Además de `readiness`, ahora también informa
  // `hash` (para que el frontend pueda comparar sin crear nada) y
  // `lastExport` (resumen de la última exportación definitiva del período,
  // si existe, con `sameAsCurrent` ya resuelto).
  async getPreview(query: Pick<FinnegansExportQuery, "period" | "employeeId">): Promise<FinnegansExportPreviewResult> {
    const { rows, readiness } = await buildDataset(query.period, query.employeeId);
    const snapshots = rows.map(toRowSnapshot);
    const hash = computeExportHash(snapshots);

    const lastBatch = await finnegansExportBatchRepository.findLatestForPeriod(query.period);
    const lastExport = lastBatch ? { ...toBatchSummary(lastBatch), sameAsCurrent: lastBatch.hash === hash } : null;

    return { period: query.period, rows: rows.map((entry) => entry.row), readiness, hash, lastExport };
  },

  // Etapa 15L.4 §3/§18: revalida todo desde cero (nunca confía en una
  // preview previa) y, si autoriza, deja evidencia persistente (batch +
  // items snapshot) además del AuditLog ya existente desde 15L.3A.
  async exportDefinitive(input: FinnegansExportRequest, audit?: AuditContext): Promise<FinnegansExportDefinitiveResult> {
    // Etapa 15L.4 §23/§24: atajo de idempotencia — un reintento con la MISMA
    // key nunca vuelve a validar ni crea una versión nueva.
    const existing = await finnegansExportBatchRepository.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return buildDefinitiveResultFromStoredBatch(existing);

    const isReexport = await assertReexportReason(input.period, input.reexportReason);

    const { rows, readiness } = await buildDataset(input.period, input.employeeId);

    if (!readiness.ready) {
      const hasDataBlocker = rows.some((entry) => entry.hasNonClosureBlocker);
      if (hasDataBlocker) {
        throw new AppError("Hay novedades que necesitan completar su configuración antes de exportar.", 409, "FINNEGANS_EXPORT_NOT_READY");
      }
      throw new AppError("El período tiene cierres pendientes para personas incluidas en la exportación.", 409, "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED");
    }

    const snapshots = rows.map(toRowSnapshot);
    const hash = computeExportHash(snapshots);

    const batch = await finnegansExportBatchRepository.createBatchWithItems({
      period: input.period,
      format: input.format,
      hash,
      reason: input.reexportReason?.trim() || null,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: audit?.userId ?? null,
      items: snapshots,
    });

    const diff = await computeDiff(batch.previousBatchId, snapshots);

    // Etapa 15L.4 §34: el AuditLog (evento global) se mantiene además del
    // batch (historial funcional de negocio) — uno no sustituye al otro.
    await auditService.register({
      ...audit,
      action: "EXPORT",
      entity: "FinnegansExport",
      entityId: batch.id,
      description: `${isReexport ? "Reexportación" : "Exportación"} Finnegans (${input.format}) de ${humanizePeriodEs(input.period)}, versión ${batch.version}, ${rows.length} registros.${input.reexportReason ? ` Motivo: ${input.reexportReason.trim()}` : ""}`,
      after: { period: input.period, format: input.format, version: batch.version, totalRows: rows.length } as Prisma.InputJsonValue,
    });

    return { period: input.period, rows: rows.map((entry) => entry.row), readiness, batch: { ...toBatchSummary(batch), diff } };
  },

  // Etapa 15L.4 §26/§33: listado de historial, más nueva primero, con el
  // resumen de diff de cada versión contra la inmediata anterior (agregadas/
  // eliminadas/modificadas — sin diff celda por celda). Se resuelve en una
  // sola consulta con items (findManyForPeriodWithItems) en vez de N+1.
  async getHistory(query: FinnegansExportHistoryQuery): Promise<FinnegansExportHistoryResult> {
    const batches = await finnegansExportBatchRepository.findManyForPeriodWithItems(query.period);
    const itemsById = new Map(batches.map((batch) => [batch.id, batch.items]));
    return {
      period: query.period,
      batches: batches.map((batch) => ({
        ...toBatchSummary(batch),
        diff: diffBatchItems(batch.previousBatchId ? (itemsById.get(batch.previousBatchId) ?? null) : null, batch.items),
      })),
    };
  },

  // Etapa 15L.4 §27: detalle de un batch — metadata + snapshot de filas +
  // diff contra el anterior si existe.
  async getHistoryDetail(batchId: string): Promise<FinnegansExportHistoryDetailResult> {
    const batch = await finnegansExportBatchRepository.findByIdWithItems(batchId);
    if (!batch) {
      throw new AppError("Finnegans export batch not found", 404, "FINNEGANS_EXPORT_BATCH_NOT_FOUND");
    }
    const diff = await computeDiff(batch.previousBatchId, batch.items);
    return { batch: toBatchSummary(batch), rows: batch.items.map(toExportRowFromSnapshot), diff };
  },
};
