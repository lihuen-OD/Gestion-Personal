import { z } from "zod";

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usá una fecha con formato AAAA-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La fecha no existe");

export const expectedShiftPreviewQuerySchema = z
  .object({
    rotationId: z.string().uuid(),
    from: dateKey,
    to: dateKey,
    page: z.coerce.number().int().min(1).default(1),
    take: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine((value, context) => {
    if (value.to < value.from) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "La fecha final no puede ser anterior a la inicial" });
      return;
    }
    const days = Math.round((Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`)) / 86_400_000) + 1;
    if (days > 42) context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "La vista previa admite un máximo de 42 días" });
  });

export type ExpectedShiftPreviewQuery = z.infer<typeof expectedShiftPreviewQuerySchema>;
