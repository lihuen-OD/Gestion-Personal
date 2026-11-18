import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "./users.schemas";

type Db = PrismaTransactionClient | typeof prisma;

const supervisionPersonSelect = { id: true, name: true, email: true, role: true, status: true } satisfies Prisma.UserSelect;

export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  companyId: true,
  employeeId: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true, code: true } },
  employee: { select: { id: true, legajo: true, firstName: true, lastName: true } },
  // Nivel 2 → Nivel 3: a quiénes supervisa y (para un Nivel 3) quién lo supervisa.
  supervisionsAsSupervisor: { select: { supervised: { select: supervisionPersonSelect } }, orderBy: { supervised: { name: "asc" } } },
  supervisionsAsSupervised: { select: { supervisor: { select: supervisionPersonSelect } }, orderBy: { supervisor: { name: "asc" } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** Respuesta pública: relaciones de supervisión aplanadas, sin hash de contraseña. */
function toUser(row: UserRow) {
  const { supervisionsAsSupervisor, supervisionsAsSupervised, ...user } = row;
  return {
    ...user,
    supervisedUsers: supervisionsAsSupervisor.map((item) => item.supervised),
    supervisorUsers: supervisionsAsSupervised.map((item) => item.supervisor),
  };
}

export type PublicUser = ReturnType<typeof toUser>;

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
  async findMany(query: ListUsersQuery): Promise<[PublicUser[], number]> {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    // Etapa 14I.2: findMany + count son lecturas independientes (ninguna
    // depende del resultado de la otra) — $transaction([...]) las pinaba a
    // una única conexión de Neon en serie sin ganar concurrencia real.
    // Mismo patrón ya corregido 15 veces en las series 14C/14G/14H. Ver
    // docs/decisions/BACKEND_TRANSACTION_CLEANUP_P0_14I2.md.
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.user.count({ where }),
    ]);
    return [rows.map(toUser), total];
  },

  async findById(id: string, db: Db = prisma) {
    const row = await db.user.findUnique({ where: { id }, select: userSelect });
    return row ? toUser(row) : null;
  },

  /** Empresa para validación de asignación del usuario (A8 §12.4). */
  findCompany(companyId: string) {
    return prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, archivedAt: true } });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, select: { id: true } });
  },

  /** Empleado a vincular y la cuenta que ya lo tiene vinculado (User.employeeId es único). */
  findEmployeeLink(employeeId: string) {
    return prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, userAccount: { select: { id: true } } } });
  },

  /** Usuarios candidatos a supervisados, para validar rol y existencia. */
  findUsersByIds(ids: string[], db: Db = prisma) {
    if (!ids.length) return Promise.resolve([]);
    return db.user.findMany({ where: { id: { in: ids } }, select: supervisionPersonSelect });
  },

  transaction<T>(operation: (tx: PrismaTransactionClient) => Promise<T>) {
    return prisma.$transaction(operation, { timeout: 30_000, maxWait: 10_000 });
  },

  async create(input: CreateUserInput & { email: string; passwordHash: string }, db: Db = prisma) {
    const row = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role,
        status: input.status,
        companyId: input.companyId || null,
        employeeId: input.employeeId || null,
      },
      select: userSelect,
    });
    return toUser(row);
  },

  async update(id: string, input: UpdateUserInput & { email?: string }, db: Db = prisma) {
    const row = await db.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.companyId !== undefined ? { companyId: input.companyId || null } : {}),
        ...(input.employeeId !== undefined ? { employeeId: input.employeeId || null } : {}),
      },
      select: userSelect,
    });
    return toUser(row);
  },

  async updatePassword(id: string, passwordHash: string) {
    const row = await prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: userSelect,
    });
    return toUser(row);
  },

  addSupervisions(db: PrismaTransactionClient, supervisorUserId: string, supervisedUserIds: string[]) {
    if (!supervisedUserIds.length) return Promise.resolve({ count: 0 });
    return db.userSupervisionAssignment.createMany({
      data: supervisedUserIds.map((supervisedUserId) => ({ supervisorUserId, supervisedUserId })),
      skipDuplicates: true,
    });
  },

  removeSupervisions(db: PrismaTransactionClient, supervisorUserId: string, supervisedUserIds: string[]) {
    if (!supervisedUserIds.length) return Promise.resolve({ count: 0 });
    return db.userSupervisionAssignment.deleteMany({ where: { supervisorUserId, supervisedUserId: { in: supervisedUserIds } } });
  },

  /** Al dejar de ser Nivel 3: deja de estar supervisado por cualquier Nivel 2. */
  removeAllAsSupervised(db: PrismaTransactionClient, supervisedUserId: string) {
    return db.userSupervisionAssignment.deleteMany({ where: { supervisedUserId } });
  },
};
