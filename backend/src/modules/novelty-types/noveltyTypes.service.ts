import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { noveltyTypesRepository, invalidateNoveltyTypesCache } from "./noveltyTypes.repository";
import type { CreateNoveltyTypeInput, ListNoveltyTypesQuery, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";
import { applyNoveltyTypeCompatibilitySync } from "./noveltyTypes.sync";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Novelty type code or Finnegans link already exists", 409, "NOVELTY_TYPE_UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Novelty type not found", 404, "NOVELTY_TYPE_NOT_FOUND");
    }
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

async function auditChange(action: "CREATE" | "UPDATE", item: { id: string; code: string; name: string }, audit?: AuditContext) {
  await auditService.register({
    ...audit,
    action,
    entity: "NoveltyType",
    entityId: item.id,
    description: `${action === "CREATE" ? "Se creo" : "Se actualizo"} tipo de novedad ${item.code} - ${item.name}.`,
    after: item as Prisma.InputJsonValue,
  });
}

// Etapa 15L.2B: si el tipo exporta a Finnegans, exige que tenga al menos un
// vínculo (código+nombre) y una unidad de Valor 1 definida -- sin esto la
// exportación real (finnegansExport.repository.ts::buildWhere) ya lo
// excluye en silencio (exige finnegansLinks activo) y "Valor 1" queda
// ambiguo (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md §8). No
// se exige para tipos legacy que ya no exportan (exportsToFinnegans=false).
function assertFinnegansConfigCoherent(effective: {
  exportsToFinnegans: boolean;
  finnegansValueUnit: string | null | undefined;
  finnegansLinks: Array<{ code: string; name: string }>;
}) {
  if (!effective.exportsToFinnegans) return;
  if (!effective.finnegansLinks.length) {
    throw new AppError("Para exportar a Finnegans hace falta un código y un nombre Finnegans.", 400, "NOVELTY_TYPE_FINNEGANS_LINK_REQUIRED");
  }
  if (!effective.finnegansValueUnit) {
    throw new AppError("Para exportar a Finnegans hace falta definir la unidad de Valor 1.", 400, "NOVELTY_TYPE_FINNEGANS_VALUE_UNIT_REQUIRED");
  }
}

export const noveltyTypesService = {
  async list(query: ListNoveltyTypesQuery) {
    const [items, total] = await noveltyTypesRepository.findMany(query);
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  getById(id: string) {
    return execute(() => noveltyTypesRepository.findById(id));
  },

  async create(data: CreateNoveltyTypeInput, audit?: AuditContext) {
    // Etapa 15L.2A: sincroniza el modelo nuevo (timeEntryBehavior/
    // allowsDateRange/finnegansRequiresValidity/finnegansValueUnit) con los
    // campos legacy antes de persistir -- ver noveltyTypes.sync.ts.
    const synced = applyNoveltyTypeCompatibilitySync(data);
    assertFinnegansConfigCoherent({
      exportsToFinnegans: Boolean(synced.exportsToFinnegans),
      finnegansValueUnit: synced.finnegansValueUnit,
      finnegansLinks: synced.finnegansLinks,
    });
    const item = await execute(() => noveltyTypesRepository.create(synced));
    invalidateNoveltyTypesCache();
    await auditChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateNoveltyTypeInput, audit?: AuditContext) {
    const synced = applyNoveltyTypeCompatibilitySync(data);
    // Etapa 15L.2B: un PATCH parcial puede no tocar exportsToFinnegans/
    // finnegansValueUnit/finnegansLinks -- se valida el estado RESULTANTE
    // (fila actual + patch), no sólo lo que vino en este request puntual.
    const current = await execute(() => noveltyTypesRepository.findById(id));
    assertFinnegansConfigCoherent({
      exportsToFinnegans: synced.exportsToFinnegans !== undefined ? synced.exportsToFinnegans : current.exportsToFinnegans,
      finnegansValueUnit: synced.finnegansValueUnit !== undefined ? synced.finnegansValueUnit : current.finnegansValueUnit,
      finnegansLinks: synced.finnegansLinks !== undefined ? synced.finnegansLinks : current.finnegansLinks,
    });
    const item = await execute(() => noveltyTypesRepository.update(id, synced));
    invalidateNoveltyTypesCache();
    await auditChange("UPDATE", item, audit);
    return item;
  },
};
