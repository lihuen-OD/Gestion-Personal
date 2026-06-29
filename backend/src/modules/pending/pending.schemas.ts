import { z } from "zod";

export const pendingKindSchema = z.enum(["all", "novelties", "timeEntries"]);

export const pendingQuerySchema = z.object({
  kind: pendingKindSchema.default("all"),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  take: z.coerce.number().int().positive().max(300).default(100),
});

export type PendingQuery = z.infer<typeof pendingQuerySchema>;
