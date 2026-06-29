import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import type { CreateUserInput, ListUsersQuery, ResetPasswordInput, UpdateUserInput } from "./users.schemas";
import { usersRepository } from "./users.repository";

async function ensureUniqueEmail(email: string, currentUserId?: string) {
  const existing = await usersRepository.findByEmail(email);
  if (existing && existing.id !== currentUserId) {
    throw new AppError("Email is already in use", 409, "EMAIL_ALREADY_EXISTS");
  }
}

export const usersService = {
  async list(query: ListUsersQuery) {
    const [items, total] = await usersRepository.findMany(query);
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async getById(id: string) {
    const user = await usersRepository.findById(id);
    if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
    return user;
  },

  async create(input: CreateUserInput, audit?: AuditContext) {
    const email = input.email.toLowerCase().trim();
    await ensureUniqueEmail(email);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await usersRepository.create({ ...input, email, passwordHash });
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "User",
      entityId: user.id,
      description: `Se creo el usuario ${user.email}.`,
      after: user as Prisma.InputJsonValue,
    });
    return user;
  },

  async update(id: string, input: UpdateUserInput, audit?: AuditContext) {
    const before = await usersService.getById(id);
    const email = input.email?.toLowerCase().trim();
    if (email) await ensureUniqueEmail(email, id);

    const user = await usersRepository.update(id, { ...input, ...(email !== undefined ? { email } : {}) });
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "User",
      entityId: user.id,
      description: `Se actualizo el usuario ${user.email}.`,
      before: before as Prisma.InputJsonValue,
      after: user as Prisma.InputJsonValue,
    });
    return user;
  },

  async resetPassword(id: string, input: ResetPasswordInput, audit?: AuditContext) {
    const before = await usersService.getById(id);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await usersRepository.updatePassword(id, passwordHash);
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "User",
      entityId: user.id,
      description: `Se reseteo la contrasena del usuario ${user.email}.`,
      before: before as Prisma.InputJsonValue,
      after: user as Prisma.InputJsonValue,
    });
    return user;
  },
};
