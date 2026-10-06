import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { generateClockDeviceSecret, generatePairingCode, hashClockDeviceSecret, pairingCodeHash } from "../../shared/security/clockDeviceCredentials";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { clockDevicesRepository } from "./clockDevices.repository";
import type { ActivateClockDeviceInput, ListClockDevicesQuery, RegisterClockDeviceInput, ResolvePairingInput } from "./clockDevices.schemas";

const PAIRING_TTL_MS = 10 * 60_000;
const MAX_PENDING_DEVICES = 20;

type DeviceMetadata = { ip: string | null; userAgent: string | null; appVersion?: string };

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

  async refreshPairing(deviceId: string, metadata: DeviceMetadata) {
    const device = await clockDevicesRepository.findSafeById(deviceId);
    if (!device) throw new AppError("Device not found", 404, "CLOCK_DEVICE_NOT_FOUND");
    if (device.status !== "PENDING") throw new AppError("Only pending devices can refresh pairing", 409, "CLOCK_DEVICE_NOT_PENDING");
    await clockDevicesRepository.touch(deviceId, metadata);
    return issuePairingCode(deviceId);
  },

  async list(query: ListClockDevicesQuery) {
    const [items, total] = await clockDevicesRepository.list(query);
    return { items, meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total } };
  },

  async getById(id: string) {
    const device = await clockDevicesRepository.findSafeById(id);
    if (!device) throw new AppError("Device not found", 404, "CLOCK_DEVICE_NOT_FOUND");
    return device;
  },

  async resolvePairing(input: ResolvePairingInput) {
    const device = await clockDevicesRepository.findPendingByPairingHash(pairingCodeHash(input.pairingCode));
    if (!device) throw new AppError("Pairing code is invalid or expired", 404, "CLOCK_DEVICE_PAIRING_NOT_FOUND");
    return device;
  },

  async activate(id: string, input: ActivateClockDeviceInput, userId: string, audit?: AuditContext) {
    const device = await clockDevicesRepository.activate(id, pairingCodeHash(input.pairingCode), input, userId);
    if (!device) throw new AppError("Device is not pending or pairing code expired", 409, "CLOCK_DEVICE_ACTIVATION_CONFLICT");
    await auditService.register({ ...audit, action: "ACTIVATE", entity: "ClockDevice", entityId: device.id, description: `Se aprobó el dispositivo de fichada ${device.name}.`, after: device as unknown as Prisma.InputJsonValue });
    return device;
  },

  async revoke(id: string, userId: string, audit?: AuditContext) {
    const before = await clockDevicesService.getById(id);
    const device = await clockDevicesRepository.revoke(id, userId);
    if (!device) throw new AppError("Only active devices can be revoked", 409, "CLOCK_DEVICE_NOT_ACTIVE");
    await auditService.register({ ...audit, action: "DEACTIVATE", entity: "ClockDevice", entityId: device.id, description: `Se revocó el dispositivo de fichada ${device.name || "sin nombre"}.`, before: before as unknown as Prisma.InputJsonValue, after: device as unknown as Prisma.InputJsonValue });
    return device;
  },

  async deletePending(id: string, audit?: AuditContext) {
    const deleted = await clockDevicesRepository.deletePending(id);
    if (!deleted) throw new AppError("Only unused pending devices can be deleted", 409, "CLOCK_DEVICE_DELETE_FORBIDDEN");
    await auditService.register({ ...audit, action: "DELETE", entity: "ClockDevice", entityId: deleted.id, description: "Se eliminó una solicitud pendiente de dispositivo de fichada." });
  },
};
