import { z } from "zod";

export const clockDeviceStatusSchema = z.enum(["PENDING", "ACTIVE", "REVOKED"]);

export const registerClockDeviceSchema = z.object({
  appVersion: z.string().trim().min(1).max(80).optional(),
});

export const refreshPairingCodeSchema = z.object({}).strict();

export const resolvePairingSchema = z.object({
  pairingCode: z.string().trim().min(8).max(12),
});

export const activateClockDeviceSchema = z.object({
  pairingCode: z.string().trim().min(8).max(12),
  name: z.string().trim().min(2).max(120),
  establishmentId: z.string().uuid().nullable().optional(),
});

// F9: lo único que RRHH edita de un dispositivo. `.strict()`: estado,
// credenciales, fechas o presencia en el body se rechazan, no se ignoran.
export const updateClockDeviceSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  establishmentId: z.string().uuid().nullable().optional(),
}).strict().refine((input) => input.name !== undefined || input.establishmentId !== undefined, { message: "Indicá el nombre o el establecimiento." });

export const listClockDevicesQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: clockDeviceStatusSchema.optional(),
  establishmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(100).default(25),
});

export type RegisterClockDeviceInput = z.infer<typeof registerClockDeviceSchema>;
export type ResolvePairingInput = z.infer<typeof resolvePairingSchema>;
export type ActivateClockDeviceInput = z.infer<typeof activateClockDeviceSchema>;
export type UpdateClockDeviceInput = z.infer<typeof updateClockDeviceSchema>;
export type ListClockDevicesQuery = z.infer<typeof listClockDevicesQuerySchema>;
