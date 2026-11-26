import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "./users.schemas";

type Db = PrismaTransactionClient | typeof prisma;

const supervisionPersonSelect = { id: true, name: true, email: true, role: true, status: true } satisfies Prisma.UserSelect;

/** R8.4: forma pública de un grupo de turnos en la respuesta de usuarios. */
export const userShiftGroupSelect = { id: true, code: true, name: true, status: true, sortOrder: true } satisfies Prisma.ShiftGroupSelect;
const shiftGroupScopesSelect = {
  select: { shiftGroup: { select: userShiftGroupSelect } },
  orderBy: [{ shiftGroup: { sortOrder: "asc" } }, { shiftGroup: { name: "asc" } }],
} satisfies Prisma.User$shiftGroupScopesArgs;

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
  supervisionsAsSupervised: { select: { supervisor: { select: { ...supervisionPersonSelect, shiftGroupScopes: shiftGroupScopesSelect } } }, orderBy: { supervisor: { name: "asc" } } },
  // R8.4: grupos de turnos asignados (sólo un Nivel 2 tiene filas).
  shiftGroupScopes: shiftGroupScopesSelect,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

type ShiftGroupSummary = Prisma.ShiftGroupGetPayload<{ select: typeof userShiftGroupSelect }>;
type SupervisorRow = UserRow["supervisionsAsSupervised"][number]["supervisor"];

/**
 * R8.4: grupos que un Nivel 3 hereda, con los supervisores de origen. Misma
 * regla que `shiftGroupScopeWhere` (shifts/shiftGroupAccess.ts): sólo
 * supervisores que sigan siendo Nivel 2 y estén ACTIVOS. Es informativo: la
 * autorización la decide siempre el helper, en cada request.
 */
function inheritedShiftGroups(role: UserRow["role"], supervisors: SupervisorRow[]) {
  if (role !== "NIVEL_3_CARGA_HORARIA") return [];
  const byGroup = new Map<string, { group: ShiftGroupSummary; viaSupervisors: Array<{ id: string; name: string; email: string }> }>();
  for (const supervisor of supervisors) {
    if (supervisor.role !== "NIVEL_2_SUPERVISION" || supervisor.status !== "ACTIVO") continue;
    for (const { shiftGroup } of supervisor.shiftGroupScopes) {
      const entry = byGroup.get(shiftGroup.id) ?? { group: shiftGroup, viaSupervisors: [] };
      entry.viaSupervisors.push({ id: supervisor.id, name: supervisor.name, email: supervisor.email });
      byGroup.set(shiftGroup.id, entry);
    }
  }
  return [...byGroup.values()].sort((a, b) => a.group.sortOrder - b.group.sortOrder || a.group.name.localeCompare(b.group.name));
}

/** Respuesta pública: relaciones de supervisión y grupos aplanados, sin hash de contraseña. */
function toUser(row: UserRow) {
  const { supervisionsAsSupervisor, supervisionsAsSupervised, shiftGroupScopes, ...user } = row;
  const supervisors = supervisionsAsSupervised.map((item) => item.supervisor);
  return {
    ...user,
    supervisedUsers: supervisionsAsSupervisor.map((item) => item.supervised),
    supervisorUsers: supervisors.map(({ shiftGroupScopes: _groups, ...person }) => person),
    /**
     * R8.4: grupos asignados. Sólo un Nivel 2 los tiene (una fila desfasada de
     * otro rol nunca da alcance y no se muestra). Un Nivel 2 INACTIVO los
     * conserva sin efecto.
     */
    shiftGroups: row.role === "NIVEL_2_SUPERVISION" ? shiftGroupScopes.map((item) => item.shiftGroup) : [],
    /** R8.4: grupos heredados (Nivel 3), con sus supervisores de origen. */
    inheritedShiftGroups: inheritedShiftGroups(row.role, supervisors),
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

  /** R8.4: grupos de turnos candidatos, para validar existencia y estado. */
  findShiftGroupsByIds(ids: string[], db: Db = prisma) {
    if (!ids.length) return Promise.resolve([]);
    return db.shiftGroup.findMany({ where: { id: { in: ids } }, select: userShiftGroupSelect });
  },

  addShiftGroupScopes(db: PrismaTransactionClient, userId: string, shiftGroupIds: string[], createdByUserId: string | null) {
    if (!shiftGroupIds.length) return Promise.resolve({ count: 0 });
    return db.userShiftGroupScope.createMany({ data: shiftGroupIds.map((shiftGroupId) => ({ userId, shiftGroupId, createdByUserId })), skipDuplicates: true });
  },

  removeShiftGroupScopes(db: PrismaTransactionClient, userId: string, shiftGroupIds: string[]) {
    if (!shiftGroupIds.length) return Promise.resolve({ count: 0 });
    return db.userShiftGroupScope.deleteMany({ where: { userId, shiftGroupId: { in: shiftGroupIds } } });
  },

  /** Al dejar de ser Nivel 3: deja de estar supervisado por cualquier Nivel 2. */
  removeAllAsSupervised(db: PrismaTransactionClient, supervisedUserId: string) {
    return db.userSupervisionAssignment.deleteMany({ where: { supervisedUserId } });
  },
};
