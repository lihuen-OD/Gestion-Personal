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
      select: { ...publicUserSelect, passwordHash: true },
    });
  },

  findActivePublicById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
  },
};
