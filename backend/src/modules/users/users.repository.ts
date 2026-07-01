import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "./users.schemas";

export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  companyId: true,
  sectorId: true,
  employeeId: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true, code: true } },
  sector: { select: { id: true, name: true, code: true } },
  employee: { select: { id: true, legajo: true, firstName: true, lastName: true } },
} satisfies Prisma.UserSelect;

function buildWhere(query: ListUsersQuery): Prisma.UserWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export const usersRepository = {
  findMany(query: ListUsersQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.user.count({ where }),
    ]);
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id }, select: userSelect });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, select: { id: true } });
  },

  create(input: CreateUserInput & { email: string; passwordHash: string }) {
    return prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role,
        status: input.status,
        companyId: input.companyId || null,
        sectorId: input.sectorId || null,
        employeeId: input.employeeId || null,
      },
      select: userSelect,
    });
  },

  update(id: string, input: UpdateUserInput & { email?: string }) {
    return prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.companyId !== undefined ? { companyId: input.companyId || null } : {}),
        ...(input.sectorId !== undefined ? { sectorId: input.sectorId || null } : {}),
        ...(input.employeeId !== undefined ? { employeeId: input.employeeId || null } : {}),
      },
      select: userSelect,
    });
  },

  updatePassword(id: string, passwordHash: string) {
    return prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: userSelect,
    });
  },
};
