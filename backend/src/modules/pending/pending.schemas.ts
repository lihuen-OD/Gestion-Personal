import { z } from "zod";

// "novelties" y "hourConceptBreakdowns" son de una sola fuente y paginan de
// verdad (skip/take + count). "all"/"timeEntries" combinan fuentes: devuelven
// la primera página de cada una con totales reales (count) y `meta.hasMore`
// explícito — nunca un total recortado a lo que se trajo.
export const pendingKindSchema = z.enum(["all", "novelties", "timeEntries", "hourConceptBreakdowns"]);

export const pendingQuerySchema = z.object({
  kind: pendingKindSchema.default("all"),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(100),
});

export type PendingQuery = z.infer<typeof pendingQuerySchema>;
