import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { generateClockDeviceSecret, generatePairingCode, hashClockDeviceSecret, pairingCodeHash } from "../../shared/security/clockDeviceCredentials";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { withConnectivity } from "./clockDeviceConnectivity";
import { clockDevicesRepository } from "./clockDevices.repository";
import type { ActivateClockDeviceInput, ListClockDevicesQuery, RegisterClockDeviceInput, ResolvePairingInput, UpdateClockDeviceInput } from "./clockDevices.schemas";

const PAIRING_TTL_MS = 10 * 60_000;
const MAX_PENDING_DEVICES = 20;
/**
 * F9: una solicitud PENDING sin ningún contacto durante este tiempo (y con el
 * código vencido) se considera abandonada y la limpieza automática la borra.
 * Un equipo que sigue en la pantalla de espera consulta su estado cada 7,5 s,
 * así que nunca llega a este umbral.
 */
export const STALE_PENDING_DEVICE_MS = 24 * 60 * 60_000;
const STALE_PENDING_BATCH = 50;

type DeviceMetadata = { ip: string | null; userAgent: string | null; appVersion?: string };
type PublicDevice = NonNullable<Awaited<ReturnType<typeof clockDevicesRepository.findSafeById>>>;

async function issuePairingCode(deviceId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pairingCode = generatePairingCode();
    const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    try {
      await clockDevicesRepository.setPairing(deviceId, pairingCodeHash(pairingCode), pairingExpiresAt);
      return { pairingCode, pairingExpiresAt };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new AppError("Could not allocate pairing code", 503, "CLOCK_DEVICE_PAIRING_UNAVAILABLE");
}

function locationLabel(device: Pick<PublicDevice, "establishment">) {
  if (!device.establishment) return "Sin establecimiento";
  return device.establishment.zone ? `${device.establishment.zone.name} · ${device.establishment.name}` : device.establishment.name;
}

// F9: lo que el AuditLog guarda de una edición. Nunca hashes, IP ni user-agent.
function editableView(device: PublicDevice) {
  return { name: device.name, establishmentId: device.establishmentId, establishment: device.establishment ? locationLabel(device) : null };
}

export const clockDevicesService = {
  async register(input: RegisterClockDeviceInput, metadata: DeviceMetadata) {
    if (await clockDevicesRepository.countPending() >= MAX_PENDING_DEVICES) {
      throw new AppError("Too many pending devices", 429, "CLOCK_DEVICE_PENDING_LIMIT");
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const secret = generateClockDeviceSecret();
      const pairingCode = generatePairingCode();
      const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS);
      try {
        const device = await clockDevicesRepository.create({
          tokenHash: hashClockDeviceSecret(secret),
          pairingCodeHash: pairingCodeHash(pairingCode),
          pairingExpiresAt,
          lastSeenAt: new Date(),
          lastIp: metadata.ip,
          lastUserAgent: metadata.userAgent,
          lastAppVersion: input.appVersion,
        });
        return { device: { ...device, pairingCode, pairingExpiresAt }, secret };
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
      }
    }
    throw new AppError("Could not allocate device credentials", 503, "CLOCK_DEVICE_PAIRING_UNAVAILABLE");
  },

  async status(deviceId: string, metadata: DeviceMetadata) {
    return clockDevicesRepository.touch(deviceId, metadata);
  },

  /**
   * F9: señal operativa explícita del fichador. Actualiza la presencia con la
   * IP y el user-agent de la request y la versión del header (nunca del body)
   * y devuelve la hora del servidor. No audita: es presencia técnica, no un
   * evento de negocio.
   */
  async heartbeat(deviceId: string, metadata: DeviceMetadata) {
    const device = await clockDevicesRepository.recordHeartbeat(deviceId, metadata);
    // Revocado entre la autenticación y la escritura: la misma respuesta que
    // habría dado requireClockDevice un instante después.
    if (!device) throw new AppError("Este dispositivo fue deshabilitado por RRHH.", 403, "CLOCK_DEVICE_REVOKED");
    return { device, serverTime: new Date().toISOString() };
  },

  async refreshPairing(deviceId: string, metadata: DeviceMetadata) {
    const device = await clockDevicesRepository.findSafeById(deviceId);
    if (!device) throw new AppError("Device not found", 404, "CLOCK_DEVICE_NOT_FOUND");
    if (device.status !== "PENDING") throw new AppError("Only pending devices can refresh pairing", 409, "CLOCK_DEVICE_NOT_PENDING");
    await clockDevicesRepository.touch(deviceId, metadata);
    return issuePairingCode(deviceId);
  },

  async list(query: ListClockDevicesQuery) {
    const [items, total] = await clockDevicesRepository.list(query);
    const now = new Date();
    return { items: items.map((item) => withConnectivity(item, now)), meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total } };
  },

  async getById(id: string) {
    const device = await clockDevicesRepository.findSafeById(id);
    if (!device) throw new AppError("Device not found", 404, "CLOCK_DEVICE_NOT_FOUND");
    return withConnectivity(device);
  },

  async resolvePairing(input: ResolvePairingInput) {
    const device = await clockDevicesRepository.findPendingByPairingHash(pairingCodeHash(input.pairingCode));
    if (!device) throw new AppError("Pairing code is invalid or expired", 404, "CLOCK_DEVICE_PAIRING_NOT_FOUND");
    return withConnectivity(device);
  },

  async activate(id: string, input: ActivateClockDeviceInput, userId: string, audit?: AuditContext) {
    const device = await clockDevicesRepository.activate(id, pairingCodeHash(input.pairingCode), input, userId);
    if (!device) throw new AppError("Device is not pending or pairing code expired", 409, "CLOCK_DEVICE_ACTIVATION_CONFLICT");
    await auditService.register({ ...audit, action: "ACTIVATE", entity: "ClockDevice", entityId: device.id, description: `Se aprobó el dispositivo de fichada ${device.name}.`, after: device as unknown as Prisma.InputJsonValue });
    return withConnectivity(device);
  },

  /**
   * F9: RRHH renombra o reubica un dispositivo PENDING o ACTIVE. REVOKED es
   * terminal y no se edita: su nombre sigue identificando sus fichadas en
   * Asistencia. La ubicación describe dónde está instalado; no restringe qué
   * empleados pueden fichar ahí (§25.2). Sin cambios reales no escribe ni
   * audita.
   */
  async update(id: string, input: UpdateClockDeviceInput, audit?: AuditContext) {
    const before = await clockDevicesRepository.findSafeById(id);
    if (!before) throw new AppError("Device not found", 404, "CLOCK_DEVICE_NOT_FOUND");
    const notEditable = () => new AppError("Un dispositivo revocado no se puede editar.", 409, "CLOCK_DEVICE_NOT_EDITABLE");
    if (before.status === "REVOKED") throw notEditable();

    const changes: { name?: string; establishmentId?: string | null } = {};
    if (input.name !== undefined && input.name !== before.name) changes.name = input.name;
    if (input.establishmentId !== undefined && input.establishmentId !== before.establishmentId) changes.establishmentId = input.establishmentId;
    if (!Object.keys(changes).length) return withConnectivity(before);

    const after = await clockDevicesRepository.updateEditable(id, changes);
    if (!after) throw notEditable();

    const parts = [
      changes.name !== undefined ? `nombre “${before.name || "sin nombre"}” → “${after.name}”` : null,
      changes.establishmentId !== undefined ? `ubicación “${locationLabel(before)}” → “${locationLabel(after)}”` : null,
    ].filter(Boolean);
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "ClockDevice",
      entityId: after.id,
      description: `Se actualizó el dispositivo de fichada ${after.name || "sin nombre"}: ${parts.join("; ")}.`,
      before: editableView(before) as Prisma.InputJsonValue,
      after: editableView(after) as Prisma.InputJsonValue,
    });
    return withConnectivity(after);
  },

  async revoke(id: string, userId: string, audit?: AuditContext) {
    const before = await clockDevicesService.getById(id);
    const device = await clockDevicesRepository.revoke(id, userId);
    if (!device) throw new AppError("Only active devices can be revoked", 409, "CLOCK_DEVICE_NOT_ACTIVE");
    await auditService.register({ ...audit, action: "DEACTIVATE", entity: "ClockDevice", entityId: device.id, description: `Se revocó el dispositivo de fichada ${device.name || "sin nombre"}.`, before: before as unknown as Prisma.InputJsonValue, after: device as unknown as Prisma.InputJsonValue });
    return withConnectivity(device);
  },

  async deletePending(id: string, audit?: AuditContext) {
    const deleted = await clockDevicesRepository.deletePending(id);
    if (!deleted) throw new AppError("Only unused pending devices can be deleted", 409, "CLOCK_DEVICE_DELETE_FORBIDDEN");
    await auditService.register({ ...audit, action: "DELETE", entity: "ClockDevice", entityId: deleted.id, description: "Se eliminó una solicitud pendiente de dispositivo de fichada." });
  },

  /**
   * F9: limpieza automática (tick de mantenimiento, sólo con
   * AUTOMATIC_JOBS_ENABLED). Borra solicitudes PENDING abandonadas: nunca
   * activadas, con el código vencido, sin contacto desde hace
   * STALE_PENDING_DEVICE_MS y sin fichadas ni intentos. Nunca toca ACTIVE ni
   * REVOKED. Cada borrado queda auditado con el sistema como actor.
   */
  async cleanupStalePending(now: Date = new Date()) {
    const deleted = await clockDevicesRepository.deleteStalePending(new Date(now.getTime() - STALE_PENDING_DEVICE_MS), now, STALE_PENDING_BATCH);
    for (const device of deleted) {
      await auditService.register({
        action: "DELETE",
        entity: "ClockDevice",
        entityId: device.id,
        description: "Se eliminó automáticamente una solicitud pendiente de dispositivo de fichada sin uso por más de 24 horas.",
        before: { status: "PENDING", createdAt: device.createdAt.toISOString() },
      });
    }
    return { deleted: deleted.length };
  },
};
