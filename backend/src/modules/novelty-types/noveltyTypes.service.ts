import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { lockNoveltyCoverageGlobally } from "../novelties/noveltyCoverage.service";
import { auditNoveltyCoverageRecalculation, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
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

// Motor de cobertura (docs/decisions/NOVELTY_COVERAGE_ENGINE.md): misma
// regla que el CHECK "NoveltyType_coverage_config_check" de la migración
// 20261113180000_add_novelty_coverage_engine, con mensajes en lenguaje de
// negocio. Se valida el estado RESULTANTE (en PATCH: fila actual + patch),
// nunca se corrige en silencio un campo incoherente.
export type CoverageConfig = {
  coverageMode: "NONE" | "FIXED_MINUTES" | "MANUAL_MINUTES" | "EXPECTED_SCHEDULE";
  coverageFixedMinutes: number | null | undefined;
  coverageDayRule: "EVERY_DAY" | "SELECTED_WEEKDAYS" | "WORK_OBLIGATION";
  coverageWeekdays: number[];
  coverageOnDayOff: "NO_COVERAGE" | "COVER" | null | undefined;
  coverageOnHoliday: "NO_COVERAGE" | "COVER" | "ONLY_IF_CONVOKED" | null | undefined;
  coverageAppliesSpecialHours: boolean;
  coverageCountsTowardTotal: boolean;
  allowsHours: boolean;
  allowsDateRange: boolean;
};

function coverageConfigError(message: string): never {
  throw new AppError(message, 400, "NOVELTY_TYPE_COVERAGE_CONFIG_INVALID");
}

export function assertCoverageConfigCoherent(config: CoverageConfig) {
  const hasFixedMinutes = config.coverageFixedMinutes != null;
  const hasWeekdays = config.coverageWeekdays.length > 0;
  const hasSpecialDayPolicies = config.coverageOnDayOff != null || config.coverageOnHoliday != null;

  if (config.coverageMode === "NONE") {
    if (hasFixedMinutes) coverageConfigError("Una novedad que no registra tiempo no puede tener una cantidad fija.");
    if (config.coverageDayRule !== "EVERY_DAY" || hasWeekdays || hasSpecialDayPolicies) {
      coverageConfigError("Una novedad que no registra tiempo no define días, francos ni feriados.");
    }
    if (config.coverageAppliesSpecialHours) coverageConfigError("Una novedad que no registra tiempo no puede aplicar reglas de domingos y feriados.");
    if (config.coverageCountsTowardTotal) coverageConfigError("Una novedad que no registra tiempo no puede sumar al total del día.");
    return;
  }

  if (config.coverageMode !== "FIXED_MINUTES" && hasFixedMinutes) {
    coverageConfigError("La cantidad fija sólo se indica cuando la novedad registra una cantidad fija.");
  }

  if (config.coverageMode === "MANUAL_MINUTES") {
    if (config.allowsDateRange) coverageConfigError("Si el tiempo lo indica quien carga la novedad, la novedad es de un único día: desactivá \"Permite rango\".");
    if (!config.allowsHours) coverageConfigError("Si el tiempo lo indica quien carga la novedad, tiene que permitir cargar una cantidad de horas.");
    if (config.coverageDayRule !== "EVERY_DAY" || hasWeekdays || hasSpecialDayPolicies) {
      coverageConfigError("Si el tiempo lo indica quien carga la novedad, vale para la fecha cargada: no se configuran días, francos ni feriados.");
    }
    return;
  }

  if (config.coverageMode === "EXPECTED_SCHEDULE" && config.coverageDayRule !== "WORK_OBLIGATION") {
    coverageConfigError("La jornada que el empleado tenía que cumplir sólo existe en los días que tenía que trabajar.");
  }

  if (config.coverageMode === "FIXED_MINUTES" && (config.coverageFixedMinutes == null || config.coverageFixedMinutes < 1 || config.coverageFixedMinutes > 1440)) {
    coverageConfigError("La cantidad fija tiene que estar entre 1 minuto y 24 horas.");
  }

  if (config.coverageDayRule === "WORK_OBLIGATION") {
    if (hasWeekdays) coverageConfigError("Con \"días que tenía que trabajar\" no se eligen días de la semana: los decide la jornada del empleado.");
    if (hasSpecialDayPolicies) {
      coverageConfigError("Con \"días que tenía que trabajar\" no se configura qué pasa con francos y feriados: lo deciden el franco y la convocatoria del empleado.");
    }
    return;
  }

  if (config.coverageDayRule === "SELECTED_WEEKDAYS" && !hasWeekdays) coverageConfigError("Elegí al menos un día de la semana.");
  if (config.coverageDayRule === "EVERY_DAY" && hasWeekdays) coverageConfigError("Con \"todos los días\" no se eligen días de la semana.");
  if (config.coverageOnDayOff == null) coverageConfigError("Indicá qué pasa si el empleado tiene franco ese día.");
  if (config.coverageOnHoliday == null) coverageConfigError("Indicá qué pasa si ese día es feriado.");
}

/** Campos que cambian lo que una novedad cubre (y lo que se snapshotea en cada día). */
const COVERAGE_FIELDS = [
  "coverageMode",
  "coverageFixedMinutes",
  "coverageDayRule",
  "coverageWeekdays",
  "coverageOnDayOff",
  "coverageOnHoliday",
  "coverageAppliesSpecialHours",
  "coverageCountsTowardTotal",
  "realWorkCompatibility",
] as const;

const NOVELTY_TYPE_TRANSACTION_OPTIONS = { timeout: 30_000 };

function pick<T>(patch: T | undefined, current: T): T {
  return patch !== undefined ? patch : current;
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
    assertCoverageConfigCoherent({
      coverageMode: data.coverageMode ?? "NONE",
      coverageFixedMinutes: data.coverageFixedMinutes,
      coverageDayRule: data.coverageDayRule ?? "EVERY_DAY",
      coverageWeekdays: data.coverageWeekdays ?? [],
      coverageOnDayOff: data.coverageOnDayOff,
      coverageOnHoliday: data.coverageOnHoliday,
      coverageAppliesSpecialHours: Boolean(data.coverageAppliesSpecialHours),
      coverageCountsTowardTotal: Boolean(data.coverageCountsTowardTotal),
      allowsHours: Boolean(data.allowsHours),
      allowsDateRange: data.allowsDateRange ?? true,
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
    assertCoverageConfigCoherent({
      coverageMode: pick(data.coverageMode, current.coverageMode),
      coverageFixedMinutes: pick(data.coverageFixedMinutes, current.coverageFixedMinutes),
      coverageDayRule: pick(data.coverageDayRule, current.coverageDayRule),
      coverageWeekdays: pick(data.coverageWeekdays, current.coverageWeekdays),
      coverageOnDayOff: pick(data.coverageOnDayOff, current.coverageOnDayOff),
      coverageOnHoliday: pick(data.coverageOnHoliday, current.coverageOnHoliday),
      coverageAppliesSpecialHours: pick(data.coverageAppliesSpecialHours, current.coverageAppliesSpecialHours),
      coverageCountsTowardTotal: pick(data.coverageCountsTowardTotal, current.coverageCountsTowardTotal),
      allowsHours: pick(data.allowsHours, current.allowsHours),
      allowsDateRange: pick(data.allowsDateRange, current.allowsDateRange),
    });
    // Etapa 5 (NOVELTY_COVERAGE_ENGINE.md §13.2): un cambio en lo que la
    // novedad cubre recalcula, en la misma transacción, todas las novedades de
    // ese tipo en períodos abiertos (los protegidos no se tocan y se informan).
    const coverageChanged = COVERAGE_FIELDS.some((field) => data[field] !== undefined && JSON.stringify(data[field]) !== JSON.stringify(current[field]));
    const { item, coverage } = coverageChanged
      ? await execute(() => prisma.$transaction(async (tx) => {
          await lockNoveltyCoverageGlobally(tx);
          const updated = await noveltyTypesRepository.update(id, data, tx);
          const recalculated = await recalculateNoveltyCoverage(tx, { noveltyTypeIds: [id], includeNoneTypes: true }, { source: "NOVELTY_TYPE_CHANGED", label: `cambio de la configuración del tipo ${updated.code} - ${updated.name}` });
          return { item: updated, coverage: recalculated };
        }, NOVELTY_TYPE_TRANSACTION_OPTIONS))
      : { item: await execute(() => noveltyTypesRepository.update(id, data)), coverage: null };
    invalidateNoveltyTypesCache();
    await auditChange("UPDATE", item, audit);
    if (coverage) await auditNoveltyCoverageRecalculation(coverage, audit);
    return item;
  },
};
