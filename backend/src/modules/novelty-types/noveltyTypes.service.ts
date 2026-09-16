import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { noveltyTypesRepository, invalidateNoveltyTypesCache } from "./noveltyTypes.repository";
import type { CreateNoveltyTypeInput, ListNoveltyTypesQuery, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Novelty type code already exists", 409, "NOVELTY_TYPE_UNIQUE_CONSTRAINT");
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

// Etapa 15L.2B: si el tipo exporta a Finnegans, exige que tenga código y
// nombre Finnegans y una unidad de Valor 1 definida -- sin esto la
// exportación real (finnegansExport.repository.ts::buildWhere) ya lo
// excluye en silencio y "Valor 1" queda ambiguo (docs/decisions/
// NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md §8). No se exige para tipos
// legacy que ya no exportan (exportsToFinnegans=false).
//
// Etapa 15L.6 (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md): código y
// nombre pasaron de FinnegansNoveltyLink (1:N) a columnas directas
// finnegansCode/finnegansName (1:1 físico).
//
// Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md §15/§17):
// además prohíbe `allowsHours=true` + `finnegansValueUnit=DAYS`. Auditado
// contra los datos reales (Etapa 15L.5, sólo lectura): hoy no existe
// ningún `NoveltyType` con esa combinación. Se prohíbe en vez de tolerarla
// porque, con la regla nueva de `novelties.service.ts::resolveQuantities`,
// `allowsHours=true` implica `quantityDays` SIEMPRE `null` (nunca se
// calcula para un tipo que captura horas) -- un tipo así configurado
// exportaría para siempre con Valor 1 vacío (`MISSING_DAYS_QUANTITY`), sin
// ningún dato que pudiera completarlo. `allowsHours` (captura operativa) y
// `finnegansValueUnit` (interpretación de exportación) siguen siendo
// conceptos independientes en toda otra combinación -- esta es la única
// combinación que se bloquea, y sólo porque es estructuralmente inviable,
// no por volver a acoplar ambos campos.
function assertFinnegansConfigCoherent(effective: {
  exportsToFinnegans: boolean;
  finnegansValueUnit: string | null | undefined;
  finnegansCode: string | null | undefined;
  finnegansName: string | null | undefined;
  allowsHours: boolean;
}) {
  if (effective.allowsHours && effective.finnegansValueUnit === "DAYS") {
    throw new AppError(
      "Un tipo con \"Permite cantidad de horas\" activo no puede usar \"Días\" como unidad de Valor 1: nunca habría una cantidad de días para exportar.",
      400,
      "NOVELTY_TYPE_HOURS_DAYS_CONFLICT",
    );
  }
  if (!effective.exportsToFinnegans) return;
  if (!effective.finnegansCode || !effective.finnegansName) {
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
    assertFinnegansConfigCoherent({
      exportsToFinnegans: Boolean(data.exportsToFinnegans),
      finnegansValueUnit: data.finnegansValueUnit,
      finnegansCode: data.finnegansCode,
      finnegansName: data.finnegansName,
      allowsHours: Boolean(data.allowsHours),
    });
    const item = await execute(() => noveltyTypesRepository.create(data));
    invalidateNoveltyTypesCache();
    await auditChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateNoveltyTypeInput, audit?: AuditContext) {
    // Etapa 15L.2B: un PATCH parcial puede no tocar exportsToFinnegans/
    // finnegansValueUnit/finnegansCode/finnegansName -- se valida el estado
    // RESULTANTE (fila actual + patch), no sólo lo que vino en este request.
    const current = await execute(() => noveltyTypesRepository.findById(id));
    assertFinnegansConfigCoherent({
      exportsToFinnegans: data.exportsToFinnegans !== undefined ? data.exportsToFinnegans : current.exportsToFinnegans,
      finnegansValueUnit: data.finnegansValueUnit !== undefined ? data.finnegansValueUnit : current.finnegansValueUnit,
      finnegansCode: data.finnegansCode !== undefined ? data.finnegansCode : current.finnegansCode,
      finnegansName: data.finnegansName !== undefined ? data.finnegansName : current.finnegansName,
      allowsHours: data.allowsHours !== undefined ? data.allowsHours : current.allowsHours,
    });
    const item = await execute(() => noveltyTypesRepository.update(id, data));
    invalidateNoveltyTypesCache();
    await auditChange("UPDATE", item, audit);
    return item;
  },
};
