import { z } from "zod";

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "period must use YYYY-MM format");

export const finnegansExportQuerySchema = z
  .object({
    period: periodSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    employeeId: z.string().uuid().optional(),
    includePending: z.coerce.boolean().default(false),
  })
  .refine((value) => Boolean(value.period || (value.from && value.to)), {
    message: "period or from/to range is required",
  })
  .refine((value) => !value.from || !value.to || value.to >= value.from, {
    message: "to must be greater than or equal to from",
    path: ["to"],
  });

export type FinnegansExportQuery = z.infer<typeof finnegansExportQuerySchema>;
