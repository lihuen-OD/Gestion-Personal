import type { ClockDeviceStatus, Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
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

// F9: lo que el dispositivo ve de sí mismo en el heartbeat. Ni hashes ni
// metadata técnica (IP, user-agent) ni quién lo aprobó.
const clockDeviceSelfSelect = {
  id: true,
  name: true,
  status: true,
  establishment: { select: { id: true, name: true, zone: { select: { id: true, name: true } } } },
} satisfies Prisma.ClockDeviceSelect;

// F9: RRHH edita nombre y establecimiento de un PENDING o un ACTIVE. REVOKED es
// terminal: su nombre sigue identificando las fichadas que hizo.
const EDITABLE_STATUSES: ClockDeviceStatus[] = ["PENDING", "ACTIVE"];

type DeviceMetadata = { ip: string | null; userAgent: string | null; appVersion?: string };

function presenceData(metadata: DeviceMetadata) {
  return {
    lastSeenAt: new Date(),
    lastIp: metadata.ip,
    lastUserAgent: metadata.userAgent,
    ...(metadata.appVersion ? { lastAppVersion: metadata.appVersion } : {}),
  };
}

/**
 * A8 §12.4 (D-15), también para F9: un dispositivo sólo se ubica en un
 * establecimiento ACTIVO del modelo vigente (Zona → Establecimiento). Uno
 * archivado se rechaza con su propio código; cualquier otro inválido (no
 * existe, inactivo, legado sin zona) devuelve "INVALID" y cada caller decide
 * su error.
 */
async function establishmentAssignability(tx: PrismaTransactionClient, establishmentId: string) {
  const establishment = await tx.establishment.findFirst({ where: { id: establishmentId }, select: { id: true, name: true, status: true, zoneId: true, archivedAt: true } });
  if (establishment?.archivedAt) {
    throw new AppError(`El establecimiento “${establishment.name}” está archivado y no puede asignarse.`, 400, "CLOCK_DEVICE_ESTABLISHMENT_ARCHIVED");
  }
  return establishment && establishment.zoneId !== null && establishment.status === "ACTIVO" ? "OK" : "INVALID";
}

/**
 * F9: solicitud PENDING abandonada. Nunca activada ni revocada, código de
 * vinculación vencido, creada y sin ningún contacto desde `staleBefore`, y sin
 * fichadas ni intentos (un PENDING no puede fichar; es defensa extra además de
 * las FK Restrict).
 */
function stalePendingWhere(staleBefore: Date, now: Date): Prisma.ClockDeviceWhereInput {
  return {
    status: "PENDING",
    activatedAt: null,
    activatedByUserId: null,
    revokedAt: null,
    createdAt: { lt: staleBefore },
    punches: { none: {} },
    attempts: { none: {} },
    AND: [
      { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }] },
      { OR: [{ pairingExpiresAt: null }, { pairingExpiresAt: { lt: now } }] },
    ],
  };
}

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
      select: { id: true, tokenHash: true, status: true, name: true, lastSeenAt: true },
    });
  },

  // Toque de presencia con throttle (F6): la condición sobre lastSeenAt vive
  // en el WHERE para que dos requests concurrentes no escriban dos veces y
  // un dispositivo revocado entre medio no se marque como visto.
  touchIfStale(id: string, staleBefore: Date, metadata: DeviceMetadata) {
    return prisma.clockDevice.updateMany({
      where: { id, status: "ACTIVE", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }] },
      data: presenceData(metadata),
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

  touch(id: string, metadata: DeviceMetadata) {
    return prisma.clockDevice.update({
      where: { id },
      data: presenceData(metadata),
      select: clockDevicePublicSelect,
    });
  },

  // F9: heartbeat. Escribe en cada llamada (la PWA lo manda una vez por minuto,
  // no hay throttle que aplicar), pero sólo si el dispositivo sigue ACTIVE: uno
  // revocado entre la autenticación y este UPDATE no queda marcado como visto.
  // null = ya no está ACTIVE.
  async recordHeartbeat(id: string, metadata: DeviceMetadata) {
    try {
      return await prisma.clockDevice.update({ where: { id, status: "ACTIVE" }, data: presenceData(metadata), select: clockDeviceSelfSelect });
    } catch (error) {
      if ((error as { code?: string }).code === "P2025") return null;
      throw error;
    }
  },

  // F9: sólo nombre y establecimiento (el schema de la ruta no admite otra
  // cosa). La condición de estado vive en el WHERE: si RRHH lo revocó entre la
  // lectura del service y esta escritura, no se toca. null = ya no es editable.
  async updateEditable(id: string, data: { name?: string; establishmentId?: string | null }) {
    return prisma.$transaction(async (tx) => {
      if (data.establishmentId && await establishmentAssignability(tx, data.establishmentId) === "INVALID") {
        throw new AppError("El establecimiento elegido no existe o no está activo.", 400, "CLOCK_DEVICE_ESTABLISHMENT_INVALID");
      }
      const changed = await tx.clockDevice.updateMany({ where: { id, status: { in: EDITABLE_STATUSES } }, data });
      if (!changed.count) return null;
      return tx.clockDevice.findUnique({ where: { id }, select: clockDevicePublicSelect });
    });
  },

  // F9: borra de a una las solicitudes abandonadas, repitiendo las condiciones
  // en el DELETE: si entre la lectura y el borrado RRHH la aprobó o el equipo
  // volvió a conectarse, esa fila no se toca. Devuelve sólo lo borrado.
  async deleteStalePending(staleBefore: Date, now: Date, limit: number) {
    const where = stalePendingWhere(staleBefore, now);
    const candidates = await prisma.clockDevice.findMany({ where, select: { id: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: limit });
    const deleted: typeof candidates = [];
    for (const candidate of candidates) {
      const result = await prisma.clockDevice.deleteMany({ where: { AND: [where, { id: candidate.id }] } });
      if (result.count) deleted.push(candidate);
    }
    return deleted;
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
      if (input.establishmentId && await establishmentAssignability(tx, input.establishmentId) === "INVALID") return null;
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
