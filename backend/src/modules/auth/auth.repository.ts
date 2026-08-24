import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  companyId: true,
  sectorId: true,
} satisfies Prisma.UserSelect;

export const authRepository = {
  findByEmailWithPassword(email: string) {
    return prisma.user.findUnique({
      where: { email },
      select: { ...publicUserSelect, passwordHash: true, refreshTokenVersion: true },
    });
  },

  findActivePublicById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
  },

  findActiveWithRefreshVersionById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { ...publicUserSelect, refreshTokenVersion: true },
    });
  },

  incrementRefreshTokenVersion(id: string) {
    return prisma.user.update({
      where: { id },
      data: { refreshTokenVersion: { increment: 1 } },
      select: { id: true, refreshTokenVersion: true },
    });
  },
};
