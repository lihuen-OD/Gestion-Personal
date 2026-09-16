import { Prisma } from "@prisma/client";
import type { FinnegansExportFormat } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";

export interface CreateBatchItemInput {
  noveltyId: string | null;
  employeeId: string;
  legajo: string;
  employeeName: string;
  noveltyCode: string;
  detail: string;
  costCenter: string;
  value1: string;
  applicationDate: string;
  validFrom: string;
  validTo: string;
}

export interface CreateBatchInput {
  period: string;
  format: FinnegansExportFormat;
  hash: string;
  reason: string | null;
  idempotencyKey: string;
  createdByUserId: string | null;
  items: CreateBatchItemInput[];
}

// Etapa 15L.4 §14/§26: `previousBatch.hash` viaja siempre junto al batch
// para poder resolver `sameAsPrevious` (finnegansExport.service.ts::toBatchSummary)
// sin una consulta aparte.
const batchWithCreatedBy = {
  createdBy: { select: { name: true } },
  previousBatch: { select: { hash: true } },
} as const;

const MAX_VERSION_ATTEMPTS = 5;

function isUniqueConstraintOn(error: unknown, fields: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  const targetFields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return fields.every((field) => targetFields.some((entry) => entry.includes(field)));
}

export const finnegansExportBatchRepository = {
  findByIdempotencyKey(idempotencyKey: string) {
    return prisma.finnegansExportBatch.findUnique({
      where: { idempotencyKey },
      include: { ...batchWithCreatedBy, items: true },
    });
  },

  // Etapa 15L.4 §29: usado por preview para informar "última exportación"
  // sin crear nada — sólo lectura.
  findLatestForPeriod(period: string) {
    return prisma.finnegansExportBatch.findFirst({
      where: { period },
      orderBy: { version: "desc" },
      include: batchWithCreatedBy,
    });
  },

  // Etapa 15L.4 §26: listado de historial, más nueva primero.
  findManyForPeriod(period: string) {
    return prisma.finnegansExportBatch.findMany({
      where: { period },
      orderBy: { version: "desc" },
      include: batchWithCreatedBy,
    });
  },

  // Etapa 15L.4 §33: mismo listado, con items -- para que el service pueda
  // calcular el resumen de diff (agregadas/eliminadas/modificadas) de cada
  // versión contra la inmediata anterior en una sola consulta, sin N+1.
  findManyForPeriodWithItems(period: string) {
    return prisma.finnegansExportBatch.findMany({
      where: { period },
      orderBy: { version: "desc" },
      include: { ...batchWithCreatedBy, items: true },
    });
  },

  findByIdWithItems(id: string) {
    return prisma.finnegansExportBatch.findUnique({
      where: { id },
      include: { ...batchWithCreatedBy, items: true },
    });
  },

  async hasAnyBatch(period: string) {
    const existing = await prisma.finnegansExportBatch.findFirst({ where: { period }, select: { id: true } });
    return !!existing;
  },

  // Etapa 15L.4 §8/§18: crea el batch y sus items en una única transacción
  // (todo o nada). La versión se recalcula en cada intento
  // (MAX(version)+1 para el período) -- si dos requests concurrentes
  // compiten por la misma versión, `@@unique([period, version])` tira
  // P2002 y se reintenta con la versión siguiente (mismo patrón de retry-on-
  // collision que `noveltyTypesRepository::generateNextCode`, Etapa 15L.2A).
  // Un P2002 sobre `idempotencyKey` (dos requests concurrentes con la MISMA
  // key) no se reintenta con otra versión -- se devuelve el batch que la
  // request ganadora ya creó, sin duplicar.
  async createBatchWithItems(input: CreateBatchInput) {
    for (let attempt = 1; attempt <= MAX_VERSION_ATTEMPTS; attempt += 1) {
      const last = await prisma.finnegansExportBatch.findFirst({
        where: { period: input.period },
        orderBy: { version: "desc" },
        select: { id: true, version: true },
      });
      const version = (last?.version ?? 0) + 1;

      try {
        return await prisma.$transaction(async (tx) => {
          const batch = await tx.finnegansExportBatch.create({
            data: {
              period: input.period,
              version,
              format: input.format,
              hash: input.hash,
              rowCount: input.items.length,
              reason: input.reason,
              idempotencyKey: input.idempotencyKey,
              createdByUserId: input.createdByUserId,
              previousBatchId: last?.id ?? null,
            },
            include: batchWithCreatedBy,
          });
          if (input.items.length) {
            await tx.finnegansExportBatchItem.createMany({
              data: input.items.map((item) => ({ ...item, batchId: batch.id })),
            });
          }
          return batch;
        });
      } catch (error) {
        if (isUniqueConstraintOn(error, ["idempotencyKey"])) {
          const existing = await finnegansExportBatchRepository.findByIdempotencyKey(input.idempotencyKey);
          if (existing) return existing;
        }
        const isVersionCollision = isUniqueConstraintOn(error, ["period", "version"]);
        if (!isVersionCollision || attempt === MAX_VERSION_ATTEMPTS) throw error;
      }
    }
    throw new Error("finnegansExportBatchRepository.createBatchWithItems: unreachable");
  },
};
