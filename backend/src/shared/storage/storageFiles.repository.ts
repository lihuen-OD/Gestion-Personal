import type { Prisma, StorageFileStatus } from "@prisma/client";
import { prisma } from "../prisma/client";

export const storageFilesRepository = {
  create(data: Prisma.StorageFileUncheckedCreateInput) {
    return prisma.storageFile.create({ data });
  },

  findById(id: string) {
    return prisma.storageFile.findUnique({ where: { id } });
  },

  findActiveById(id: string) {
    return prisma.storageFile.findFirst({ where: { id, status: "ACTIVE" } });
  },

  findMany(where: Prisma.StorageFileWhereInput) {
    return prisma.storageFile.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
    });
  },

  countUnlinkedPunchEvidence(uploadedBefore: Date) {
    return prisma.storageFile.count({
      where: {
        module: "FICHADAS",
        status: "ACTIVE",
        uploadedAt: { lt: uploadedBefore },
        attendancePunchPhotoLinks: { none: {} },
        attendancePunchThumbnailLinks: { none: {} },
      },
    });
  },

  updateStatus(id: string, input: { status: StorageFileStatus; deletedByUserId?: string | null; deletedAt?: Date | null }) {
    return prisma.storageFile.update({
      where: { id },
      data: {
        status: input.status,
        deletedByUserId: input.deletedByUserId || null,
        deletedAt: input.deletedAt || null,
      },
    });
  },
};
