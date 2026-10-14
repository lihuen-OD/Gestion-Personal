import type { ClockDeviceStatus } from "@prisma/client";

/**
 * F9 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §28): conectividad de un
 * dispositivo de fichada, DERIVADA al leer de su último contacto válido
 * (`lastSeenAt`: heartbeat o cualquier request autenticada). Nunca se persiste
 * un "online": si el dispositivo deja de hablar, pasa solo a "sin conexión".
 *
 * La PWA manda un heartbeat por minuto (fichador/src/features/device/
 * useClockDeviceHeartbeat.ts). La ventana tolera un heartbeat perdido y la
 * demora del siguiente: 150 s = 2 × 60 s + 30 s de margen.
 */
export const CLOCK_DEVICE_ONLINE_WINDOW_MS = 150_000;

export type ClockDeviceConnectivity = "ONLINE" | "OFFLINE" | "NEVER_SEEN";

/**
 * Sólo un dispositivo ACTIVE tiene conectividad: un PENDING todavía no opera y
 * un REVOKED nunca se muestra "en línea", aunque haya consultado su estado
 * hace segundos (`/device/status` acepta cualquier estado).
 */
export function clockDeviceConnectivity(device: { status: ClockDeviceStatus; lastSeenAt: Date | null }, now: Date = new Date()): ClockDeviceConnectivity | null {
  if (device.status !== "ACTIVE") return null;
  if (!device.lastSeenAt) return "NEVER_SEEN";
  return now.getTime() - device.lastSeenAt.getTime() <= CLOCK_DEVICE_ONLINE_WINDOW_MS ? "ONLINE" : "OFFLINE";
}

export function withConnectivity<T extends { status: ClockDeviceStatus; lastSeenAt: Date | null }>(device: T, now: Date = new Date()) {
  return { ...device, connectivity: clockDeviceConnectivity(device, now) };
}
