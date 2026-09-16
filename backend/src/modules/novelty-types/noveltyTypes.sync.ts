import type { z } from "zod";
import { noveltyTimeEntryBehaviorSchema, noveltyTimeImpactSchema } from "./noveltyTypes.schemas";

// Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md):
// funciones puras de sincronizacion entre el modelo nuevo (timeEntryBehavior/
// allowsDateRange/finnegansRequiresValidity) y los campos legacy que se
// mantienen por compatibilidad (blocksTimeEntry/setsWorkedHoursToZero/
// timeImpact/allowsDateTo/hasValidity). Objetivo unico: que un create/update
// nunca deje una combinacion contradictoria entre ambos modelos. No decide
// nada de negocio nuevo, sólo resuelve que par de valores persistir.
//
// finnegansValueUnit/allowsHours NO se sincronizan acá (ver comentario más
// abajo, Etapa 15L.2B.1) -- son dos decisiones independientes.

type NoveltyTimeImpact = z.infer<typeof noveltyTimeImpactSchema>;
type NoveltyTimeEntryBehavior = z.infer<typeof noveltyTimeEntryBehaviorSchema>;

type TimeEntryBehaviorFields = {
  timeEntryBehavior?: NoveltyTimeEntryBehavior;
  blocksTimeEntry?: boolean;
  setsWorkedHoursToZero?: boolean;
  timeImpact?: NoveltyTimeImpact;
};

type TimeEntryBehaviorPatch = {
  timeEntryBehavior: NoveltyTimeEntryBehavior;
  blocksTimeEntry: boolean;
  setsWorkedHoursToZero: boolean;
  timeImpact: NoveltyTimeImpact;
};

const BLOQUEA_NUEVA_CARGA: TimeEntryBehaviorPatch = {
  timeEntryBehavior: "BLOQUEA_NUEVA_CARGA",
  blocksTimeEntry: true,
  // Etapa 15G.1: setsWorkedHoursToZero ya no tiene efecto productivo sobre
  // TimeEntry -- código nuevo nunca vuelve a escribir true acá.
  setsWorkedHoursToZero: false,
  timeImpact: "BLOQUEA_CARGA_DIA",
};

const NO_BLOQUEA: TimeEntryBehaviorPatch = {
  timeEntryBehavior: "NO_BLOQUEA",
  blocksTimeEntry: false,
  setsWorkedHoursToZero: false,
  timeImpact: "NO_AFECTA_HORAS",
};

// Si el cliente manda timeEntryBehavior, es la fuente de verdad y fuerza los
// 3 campos legacy a la combinación canónica correspondiente. Si no lo manda
// pero toca cualquiera de los 3 legacy, se deriva el comportamiento nuevo
// desde esos valores y también se fuerzan los 3 legacy a la combinación
// canónica -- evita que quede, por ejemplo, blocksTimeEntry=true junto con
// timeImpact=NO_AFECTA_HORAS. Si el input no toca ninguno de los 4 campos,
// no devuelve nada (no pisa lo que ya existe en la fila).
export function resolveTimeEntryBehaviorSync(input: TimeEntryBehaviorFields): Partial<TimeEntryBehaviorPatch> {
  if (input.timeEntryBehavior !== undefined) {
    return { ...(input.timeEntryBehavior === "BLOQUEA_NUEVA_CARGA" ? BLOQUEA_NUEVA_CARGA : NO_BLOQUEA) };
  }
  const legacyTouched = input.blocksTimeEntry !== undefined || input.setsWorkedHoursToZero !== undefined || input.timeImpact !== undefined;
  if (!legacyTouched) return {};
  const blocks = Boolean(input.blocksTimeEntry) || Boolean(input.setsWorkedHoursToZero) || input.timeImpact === "BLOQUEA_CARGA_DIA";
  return { ...(blocks ? BLOQUEA_NUEVA_CARGA : NO_BLOQUEA) };
}

// allowsDateRange es la fuente preferida; si no viene pero sí allowsDateTo
// (cliente legacy), se deriva desde ahí. Nunca deja que los dos campos
// diverjan tras un write que toque cualquiera de los dos.
export function resolveAllowsDateRangeSync(input: {
  allowsDateRange?: boolean;
  allowsDateTo?: boolean;
}): Partial<{ allowsDateRange: boolean; allowsDateTo: boolean }> {
  if (input.allowsDateRange !== undefined) return { allowsDateRange: input.allowsDateRange, allowsDateTo: input.allowsDateRange };
  if (input.allowsDateTo !== undefined) return { allowsDateRange: input.allowsDateTo, allowsDateTo: input.allowsDateTo };
  return {};
}

// finnegansRequiresValidity es la fuente preferida; si no viene pero sí
// hasValidity (cliente legacy), se deriva desde ahí. No toca
// FinnegansNoveltyLink.hasValidity (fuera de alcance de esta etapa).
export function resolveFinnegansRequiresValiditySync(input: {
  finnegansRequiresValidity?: boolean;
  hasValidity?: boolean;
}): Partial<{ finnegansRequiresValidity: boolean; hasValidity: boolean }> {
  if (input.finnegansRequiresValidity !== undefined) {
    return { finnegansRequiresValidity: input.finnegansRequiresValidity, hasValidity: input.finnegansRequiresValidity };
  }
  if (input.hasValidity !== undefined) return { finnegansRequiresValidity: input.hasValidity, hasValidity: input.hasValidity };
  return {};
}

// Etapa 15L.2B.1 (corrección puntual, docs/decisions/
// NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): finnegansValueUnit y
// allowsHours son dos decisiones independientes -- allowsHours responde
// "¿este tipo permite cargar quantityHours como dato operativo de la
// novedad?"; finnegansValueUnit responde "si esta novedad se exporta a
// Finnegans, qué representa Valor 1?". Hasta esta corrección,
// resolveFinnegansValueUnitSync sincronizaba ambos en las dos direcciones
// (cambiar uno pisaba el otro sin que el usuario lo pidiera). Se eliminó
// por completo esa función: ninguno de los dos campos vuelve a escribir el
// otro desde ahora. El backfill histórico de la migración
// 20260916120000_add_novelty_type_normalization_fields (finnegansValueUnit
// = HOURS donde allowsHours ya era true) fue una corrida única al agregar
// la columna y NO se revierte -- sólo deja de repetirse en cada
// create/update futuro. Prisma ya preserva por sí solo el campo que un
// PATCH parcial no menciona (ver noveltyTypes.repository.ts), así que no
// hace falta ninguna función "identidad" en su lugar.

// Combina las 3 sincronizaciones restantes sobre un mismo input de
// create/update. Se aplica antes de llegar al repositorio -- el
// repositorio persiste tal cual, sin conocer ninguna regla de
// compatibilidad.
export function applyNoveltyTypeCompatibilitySync<
  T extends TimeEntryBehaviorFields & {
    allowsDateRange?: boolean;
    allowsDateTo?: boolean;
    finnegansRequiresValidity?: boolean;
    hasValidity?: boolean;
  },
>(input: T): T {
  return {
    ...input,
    ...resolveTimeEntryBehaviorSync(input),
    ...resolveAllowsDateRangeSync(input),
    ...resolveFinnegansRequiresValiditySync(input),
  };
}
