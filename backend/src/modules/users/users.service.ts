import bcrypt from "bcryptjs";
import { Prisma, type RoleName } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { invalidateCurrentUserCache } from "../auth/auth.service";
import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { roles } from "../../shared/security/roles";
import type { CreateUserInput, ListUsersQuery, ResetPasswordInput, UpdateUserInput } from "./users.schemas";
import { usersRepository, type PublicUser } from "./users.repository";

type SupervisionPerson = PublicUser["supervisedUsers"][number];
type ShiftGroupItem = PublicUser["shiftGroups"][number];

const EMPLOYEE_ALREADY_LINKED_MESSAGE = "Este empleado ya está vinculado a otro usuario.";

async function ensureUniqueEmail(email: string, currentUserId?: string) {
  const existing = await usersRepository.findByEmail(email);
  if (existing && existing.id !== currentUserId) {
    throw new AppError("Ya existe un usuario con ese email.", 409, "EMAIL_ALREADY_EXISTS");
  }
}

// A8 §12.4: `User.companyId` es administrativa (D-14) pero no puede apuntar a
// un registro archivado mientras la columna exista.
async function assertAssignableCompany(companyId: string | null | undefined) {
  if (!companyId) return;
  const company = await usersRepository.findCompany(companyId);
  if (company?.archivedAt) {
    throw new AppError(`La empresa “${company.name}” está archivada y no puede asignarse al usuario.`, 400, "USER_COMPANY_ARCHIVED");
  }
}

// "Empleado vinculado" = la persona que corresponde a esta cuenta. No define
// alcance. `User.employeeId` es único: un legajo no puede tener dos cuentas.
// Se valida antes de escribir; el P2002 sólo queda para una carrera.
async function assertEmployeeLinkable(employeeId: string | null | undefined, currentUserId?: string) {
  if (!employeeId) return;
  const employee = await usersRepository.findEmployeeLink(employeeId);
  if (!employee) throw new AppError("El empleado seleccionado ya no existe. Recargá la pantalla e intentá nuevamente.", 400, "USER_EMPLOYEE_NOT_FOUND");
  if (employee.userAccount && employee.userAccount.id !== currentUserId) {
    throw new AppError(EMPLOYEE_ALREADY_LINKED_MESSAGE, 409, "EMPLOYEE_ALREADY_LINKED_TO_USER");
  }
}

/** Sólo un Nivel 2 supervisa; sólo se supervisa a Nivel 3; nunca a sí mismo. */
async function resolveSupervisedUsers(db: PrismaTransactionClient, finalRole: RoleName, ids: string[] | undefined, supervisorUserId?: string) {
  if (ids === undefined) return undefined;
  if (finalRole !== roles.supervision) {
    if (ids.length) {
      throw new AppError(
        "Sólo un usuario Nivel 2 - Supervisión / Gestión puede tener responsables de carga supervisados.",
        400,
        "USER_SUPERVISION_REQUIRES_SUPERVISOR_ROLE",
      );
    }
    return [];
  }
  if (supervisorUserId && ids.includes(supervisorUserId)) {
    throw new AppError("Un usuario no puede supervisarse a sí mismo.", 400, "USER_SUPERVISION_INVALID_TARGET");
  }
  const found = await usersRepository.findUsersByIds(ids, db);
  if (found.length !== ids.length) {
    throw new AppError("Uno de los responsables de carga seleccionados ya no existe. Recargá la pantalla e intentá nuevamente.", 400, "USER_SUPERVISION_INVALID_TARGET");
  }
  const invalid = found.find((user) => user.role !== roles.cargaHoraria);
  if (invalid) {
    throw new AppError(
      `Sólo se pueden supervisar usuarios Nivel 3 - Administrativo de Carga Horaria: ${invalid.name} no lo es.`,
      400,
      "USER_SUPERVISION_INVALID_TARGET",
    );
  }
  return found;
}

function describePeople(people: SupervisionPerson[]) {
  return people.map((person) => `${person.name} (${person.email})`).join(", ");
}

function supervisionSnapshot(people: SupervisionPerson[]) {
  return { supervisedUsers: people.map(({ id, name, email }) => ({ id, name, email })) } as Prisma.InputJsonValue;
}

/**
 * Reemplaza los Nivel 3 supervisados por `supervisor` por `next` y audita qué
 * se agregó y qué se quitó (nombres y emails, nunca ids en el texto).
 */
async function applySupervisionChange(
  db: PrismaTransactionClient,
  supervisor: { id: string; name: string; email: string },
  current: SupervisionPerson[],
  next: SupervisionPerson[],
  audit: AuditContext | undefined,
  reason?: string,
) {
  const currentIds = new Set(current.map((person) => person.id));
  const nextIds = new Set(next.map((person) => person.id));
  const added = next.filter((person) => !currentIds.has(person.id));
  const removed = current.filter((person) => !nextIds.has(person.id));
  if (!added.length && !removed.length) return false;

  await usersRepository.removeSupervisions(db, supervisor.id, removed.map((person) => person.id));
  await usersRepository.addSupervisions(db, supervisor.id, added.map((person) => person.id));

  const parts = [
    added.length ? `se agregaron ${describePeople(added)}` : "",
    removed.length ? `se quitaron ${describePeople(removed)}` : "",
  ].filter(Boolean);
  await auditService.registerWithin(db, {
    ...audit,
    action: "UPDATE",
    entity: "UserSupervisionAssignment",
    entityId: supervisor.id,
    description: `Responsables de carga supervisados por ${supervisor.name} (${supervisor.email}): ${parts.join("; ")}.${reason ? ` ${reason}` : ""}`,
    before: supervisionSnapshot(current),
    after: supervisionSnapshot(next),
  });
  return true;
}

/**
 * R8.4: sólo un Nivel 2 tiene grupos asignados (un Nivel 3 los hereda; Nivel 1
 * los administra todos sin filas). Los grupos tienen que existir; uno que se
 * agrega tiene que estar ACTIVO (uno INACTIVO ya asignado se puede conservar).
 */
async function resolveShiftGroups(db: PrismaTransactionClient, finalRole: RoleName, ids: string[] | undefined, current: ShiftGroupItem[]) {
  if (ids === undefined) return undefined;
  if (finalRole !== roles.supervision) {
    if (ids.length) {
      throw new AppError(
        "Sólo un usuario Nivel 2 - Supervisión / Gestión puede tener grupos de turnos asignados. Un Nivel 3 los hereda de sus supervisores.",
        400,
        "USER_SHIFT_GROUPS_REQUIRE_SUPERVISOR_ROLE",
      );
    }
    return [];
  }
  const found = await usersRepository.findShiftGroupsByIds(ids, db);
  if (found.length !== ids.length) {
    throw new AppError("Uno de los grupos de turnos seleccionados ya no existe. Recargá la pantalla e intentá nuevamente.", 400, "USER_SHIFT_GROUP_INVALID");
  }
  const currentIds = new Set(current.map((group) => group.id));
  const inactive = found.find((group) => group.status !== "ACTIVO" && !currentIds.has(group.id));
  if (inactive) {
    throw new AppError(`El grupo de turnos ${inactive.code} - ${inactive.name} está inactivo: no se puede asignar.`, 409, "SHIFT_GROUP_INACTIVE");
  }
  const order = new Map(ids.map((id, index) => [id, index]));
  return found.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

function describeGroups(groups: ShiftGroupItem[]) {
  return groups.map((group) => `${group.code} - ${group.name}`).join(", ");
}

function shiftGroupSnapshot(groups: ShiftGroupItem[]) {
  return { shiftGroups: groups.map(({ id, code, name }) => ({ id, code, name })) } as Prisma.InputJsonValue;
}

/**
 * R8.4: reemplaza los grupos de turnos de `user` por `next` y audita qué se
 * agregó y qué se quitó (códigos y nombres, nunca ids en el texto), con el
 * estado anterior y posterior. Rige desde la request siguiente: el alcance se
 * resuelve por request (shifts/shiftGroupAccess.ts), sin caché que invalidar.
 */
async function applyShiftGroupScopeChange(
  db: PrismaTransactionClient,
  user: { id: string; name: string; email: string },
  current: ShiftGroupItem[],
  next: ShiftGroupItem[],
  audit: AuditContext | undefined,
  reason?: string,
) {
  const currentIds = new Set(current.map((group) => group.id));
  const nextIds = new Set(next.map((group) => group.id));
  const added = next.filter((group) => !currentIds.has(group.id));
  const removed = current.filter((group) => !nextIds.has(group.id));
  if (!added.length && !removed.length) return false;

  await usersRepository.removeShiftGroupScopes(db, user.id, removed.map((group) => group.id));
  await usersRepository.addShiftGroupScopes(db, user.id, added.map((group) => group.id), audit?.userId ?? null);

  const parts = [
    added.length ? `se agregaron ${describeGroups(added)}` : "",
    removed.length ? `se quitaron ${describeGroups(removed)}` : "",
  ].filter(Boolean);
  await auditService.registerWithin(db, {
    ...audit,
    action: "UPDATE",
    entity: "UserShiftGroupScope",
    entityId: user.id,
    description: `Grupos de turnos de ${user.name} (${user.email}): ${parts.join("; ")}.${reason ? ` ${reason}` : ""}`,
    before: shiftGroupSnapshot(current),
    after: shiftGroupSnapshot(next),
  });
  return true;
}

function p2002Target(error: Prisma.PrismaClientKnownRequestError) {
  const target = error.meta?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

/** Red de seguridad ante carreras: las validaciones previas son la experiencia normal. */
function mapWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = p2002Target(error);
      if (target.includes("employeeId")) throw new AppError(EMPLOYEE_ALREADY_LINKED_MESSAGE, 409, "EMPLOYEE_ALREADY_LINKED_TO_USER");
      if (target.includes("email")) throw new AppError("Ya existe un usuario con ese email.", 409, "EMAIL_ALREADY_EXISTS");
      if (target.includes("shiftGroupId")) throw new AppError("Los grupos de turnos se modificaron en paralelo. Recargá la pantalla e intentá nuevamente.", 409, "USER_SHIFT_GROUP_CONCURRENT_UPDATE");
      if (target.includes("supervis")) throw new AppError("Los responsables de carga se modificaron en paralelo. Recargá la pantalla e intentá nuevamente.", 409, "USER_SUPERVISION_CONCURRENT_UPDATE");
    }
    if (error.code === "P2003") {
      throw new AppError("Alguno de los datos seleccionados ya no existe. Recargá la pantalla e intentá nuevamente.", 400, "USER_RELATED_RECORD_NOT_FOUND");
    }
  }
  throw error;
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
    await assertAssignableCompany(input.companyId);
    await assertEmployeeLinkable(input.employeeId);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await usersRepository.transaction(async (db) => {
      const supervised = await resolveSupervisedUsers(db, input.role, input.supervisedUserIds);
      const shiftGroups = await resolveShiftGroups(db, input.role, input.shiftGroupIds, []);
      const created = await usersRepository.create({ ...input, email, passwordHash }, db);
      await auditService.registerWithin(db, {
        ...audit,
        action: "CREATE",
        entity: "User",
        entityId: created.id,
        description: `Se creo el usuario ${created.email}.`,
        after: created as Prisma.InputJsonValue,
      });
      const supervisionChanged = supervised?.length ? await applySupervisionChange(db, created, [], supervised, audit) : false;
      const groupsChanged = shiftGroups?.length ? await applyShiftGroupScopeChange(db, created, [], shiftGroups, audit) : false;
      return supervisionChanged || groupsChanged ? (await usersRepository.findById(created.id, db))! : created;
    }).catch(mapWriteError);

    clearAuditDerivedCaches();
    invalidateCurrentUserCache(user.id);
    return user;
  },

  async update(id: string, input: UpdateUserInput, audit?: AuditContext) {
    const before = await usersService.getById(id);
    if (audit?.userId === id && input.status === "INACTIVO" && before.status !== "INACTIVO") {
      throw new AppError(
        "No podés inactivar tu propio usuario mientras tenés la sesión iniciada",
        409,
        "USER_SELF_DEACTIVATION_FORBIDDEN",
      );
    }
    const email = input.email?.toLowerCase().trim();
    if (email) await ensureUniqueEmail(email, id);
    if (input.companyId !== undefined) await assertAssignableCompany(input.companyId);
    if (input.employeeId !== undefined) await assertEmployeeLinkable(input.employeeId, id);
    const finalRole = input.role ?? before.role;

    const user = await usersRepository.transaction(async (db) => {
      // Relaciones leídas dentro de la transacción: el diff y la auditoría
      // parten del estado real al momento de escribir.
      const current = (await usersRepository.findById(id, db))!;
      const supervised = await resolveSupervisedUsers(db, finalRole, input.supervisedUserIds, id);
      const shiftGroups = await resolveShiftGroups(db, finalRole, input.shiftGroupIds, current.shiftGroups);
      const updated = await usersRepository.update(id, { ...input, ...(email !== undefined ? { email } : {}) }, db);

      let supervisionChanged = false;
      // Sin basura de autorización: quien deja de ser Nivel 2 deja de
      // supervisar, y quien deja de ser Nivel 3 deja de estar supervisado.
      if (finalRole !== roles.supervision && current.supervisedUsers.length) {
        supervisionChanged = await applySupervisionChange(db, updated, current.supervisedUsers, [], audit, "El usuario dejó de ser Nivel 2 - Supervisión / Gestión.");
      } else if (finalRole === roles.supervision && supervised) {
        supervisionChanged = await applySupervisionChange(db, updated, current.supervisedUsers, supervised, audit);
      }
      if (finalRole !== roles.cargaHoraria && current.supervisorUsers.length) {
        await usersRepository.removeAllAsSupervised(db, id);
        for (const supervisor of current.supervisorUsers) {
          await auditService.registerWithin(db, {
            ...audit,
            action: "UPDATE",
            entity: "UserSupervisionAssignment",
            entityId: supervisor.id,
            description: `Responsables de carga supervisados por ${supervisor.name} (${supervisor.email}): se quitó ${updated.name} (${updated.email}) porque dejó de ser Nivel 3 - Administrativo de Carga Horaria.`,
          });
        }
        supervisionChanged = true;
      }

      // R8.4: quien deja de ser Nivel 2 pierde sus grupos (misma transacción,
      // auditado). Inactivar no los borra: la regla de alcance exige ACTIVO y
      // vuelven a regir al reactivarlo.
      let groupsChanged = false;
      if (finalRole !== roles.supervision && current.shiftGroups.length) {
        groupsChanged = await applyShiftGroupScopeChange(db, updated, current.shiftGroups, [], audit, "El usuario dejó de ser Nivel 2 - Supervisión / Gestión.");
      } else if (finalRole === roles.supervision && shiftGroups) {
        groupsChanged = await applyShiftGroupScopeChange(db, updated, current.shiftGroups, shiftGroups, audit);
      }

      const after = supervisionChanged || groupsChanged ? (await usersRepository.findById(id, db))! : updated;
      await auditService.registerWithin(db, {
        ...audit,
        action: input.status !== undefined && input.status !== before.status
          ? input.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE"
          : "UPDATE",
        entity: "User",
        entityId: after.id,
        description: `Se actualizo el usuario ${after.email}.`,
        before: current as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
      });
      return after;
    }).catch(mapWriteError);

    clearAuditDerivedCaches();
    invalidateCurrentUserCache(user.id);
    return user;
  },

  async resetPassword(id: string, input: ResetPasswordInput, audit?: AuditContext) {
    const before = await usersService.getById(id);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await usersRepository.updatePassword(id, passwordHash);
    invalidateCurrentUserCache(user.id);
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
