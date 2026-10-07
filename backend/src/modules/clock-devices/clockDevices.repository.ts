import type { ClockDeviceStatus, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { ListClockDevicesQuery } from "./clockDevices.schemas";

export const clockDevicePublicSelect = {
  id: true,
  name: true,
  status: true,
  establishmentId: true,
  activatedAt: true,
  revokedAt: true,
  lastSeenAt: true,
  lastIp: true,
  lastUserAgent: true,
  lastAppVersion: true,
  createdAt: true,
  updatedAt: true,
  establishment: { select: { id: true, name: true, zone: { select: { id: true, name: true } } } },
} satisfies Prisma.ClockDeviceSelect;

function whereFor(query: ListClockDevicesQuery): Prisma.ClockDeviceWhereInput {
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.establishmentId ? { establishmentId: query.establishmentId } : {}),
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
  };
}

export const clockDevicesRepository = {
  async list(query: ListClockDevicesQuery) {
    const where = whereFor(query);
    return Promise.all([
      prisma.clockDevice.findMany({
        where,
        select: clockDevicePublicSelect,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.take,
        take: query.take,
      }),
      prisma.clockDevice.count({ where }),
    ]);
  },

  findSafeById(id: string) {
    return prisma.clockDevice.findUnique({ where: { id }, select: clockDevicePublicSelect });
  },

  // Única lectura que trae tokenHash: la usa sólo requireClockDevice para
  // comparar y nunca sale de ese middleware. Un lookup por PK por request.
  findCredentialById(id: string) {
    return prisma.clockDevice.findUnique({
      where: { id },
      select: { id: true, tokenHash: true, status: true, name: true, sectorId: true, lastSeenAt: true },
    });
  },

  // Toque de presencia con throttle (F6): la condición sobre lastSeenAt vive
  // en el WHERE para que dos requests concurrentes no escriban dos veces y
  // un dispositivo revocado entre medio no se marque como visto.
  touchIfStale(id: string, staleBefore: Date, metadata: { ip: string | null; userAgent: string | null; appVersion?: string }) {
    return prisma.clockDevice.updateMany({
      where: { id, status: "ACTIVE", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }] },
      data: {
        lastSeenAt: new Date(),
        lastIp: metadata.ip,
        lastUserAgent: metadata.userAgent,
        ...(metadata.appVersion ? { lastAppVersion: metadata.appVersion } : {}),
      },
    });
  },

  findPendingByPairingHash(hash: string) {
    return prisma.clockDevice.findFirst({
      where: { pairingCodeHash: hash, status: "PENDING", pairingExpiresAt: { gt: new Date() } },
      select: clockDevicePublicSelect,
    });
  },

  countPending() {
    return prisma.clockDevice.count({ where: { status: "PENDING" } });
  },

  create(data: Prisma.ClockDeviceCreateInput) {
    return prisma.clockDevice.create({ data, select: clockDevicePublicSelect });
  },

  touch(id: string, metadata: { ip: string | null; userAgent: string | null; appVersion?: string }) {
    return prisma.clockDevice.update({
      where: { id },
      data: {
        lastSeenAt: new Date(),
        lastIp: metadata.ip,
        lastUserAgent: metadata.userAgent,
        ...(metadata.appVersion ? { lastAppVersion: metadata.appVersion } : {}),
      },
      select: clockDevicePublicSelect,
    });
  },

  setPairing(id: string, hash: string, expiresAt: Date) {
    return prisma.clockDevice.update({
      where: { id },
      data: { pairingCodeHash: hash, pairingExpiresAt: expiresAt },
      select: clockDevicePublicSelect,
    });
  },

  async activate(id: string, pairingHash: string, input: { name: string; establishmentId?: string | null }, userId: string) {
    return prisma.$transaction(async (tx) => {
      if (input.establishmentId) {
        const establishment = await tx.establishment.findFirst({ where: { id: input.establishmentId, zoneId: { not: null }, status: "ACTIVO" }, select: { id: true } });
        if (!establishment) return null;
      }
      const changed = await tx.clockDevice.updateMany({
        where: { id, status: "PENDING", pairingCodeHash: pairingHash, pairingExpiresAt: { gt: new Date() } },
        data: {
          status: "ACTIVE",
          name: input.name,
          establishmentId: input.establishmentId ?? null,
          activatedAt: new Date(),
          activatedByUserId: userId,
          pairingCodeHash: null,
          pairingExpiresAt: null,
        },
      });
      if (!changed.count) return null;
      return tx.clockDevice.findUnique({ where: { id }, select: clockDevicePublicSelect });
    });
  },

  async revoke(id: string, userId: string) {
    const changed = await prisma.clockDevice.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: userId, pairingCodeHash: null, pairingExpiresAt: null },
    });
    return changed.count ? clockDevicesRepository.findSafeById(id) : null;
  },

  async deletePending(id: string) {
    return prisma.$transaction(async (tx) => {
      const device = await tx.clockDevice.findUnique({ where: { id }, select: { id: true, name: true, status: true, _count: { select: { punches: true, attempts: true } } } });
      if (!device || device.status !== ("PENDING" satisfies ClockDeviceStatus) || device._count.punches || device._count.attempts) return null;
      await tx.clockDevice.delete({ where: { id } });
      return device;
    });
  },
};
