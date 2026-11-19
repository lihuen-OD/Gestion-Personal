/**
 * Grupos de turnos — R3.1 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23).
 *
 * Un grupo es el lugar / ámbito operativo principal de un turno (Planta,
 * Granja, Oficina…), no su función (eso sigue en ShiftTemplate.categoryName).
 * Es sólo clasificación: ningún cálculo de negocio (resolver, alertas,
 * Novedades, horas, cierres) lo lee, así que crear, editar, inactivar o
 * eliminar un grupo —o cambiar el grupo de una plantilla— nunca recalcula
 * cobertura ni reevalúa jornadas.
 *
 * Reglas:
 * - Código y nombre únicos sin distinguir mayúsculas ni espacios repetidos
 *   (normalizados en el schema); los índices únicos son la segunda defensa.
 * - INACTIVO no desclasifica: las plantillas ya asociadas siguen funcionando
 *   igual. Sólo impide asociar plantillas nuevas (`assertShiftGroupAssignable`).
 * - Eliminar sólo si no tiene plantillas; si no, se sugiere inactivar. La FK
 *   RESTRICT de ShiftTemplate.shiftGroupId es la segunda defensa.
 */
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { shiftGroupRepository } from "./shiftGroup.repository";
import type { CreateShiftGroupInput, ListShiftGroupsQuery, UpdateShiftGroupInput } from "./shiftGroup.schemas";

type ShiftGroupRow = Prisma.ShiftGroupGetPayload<{ include: { _count: { select: { templates: true } } } }>;

export type ShiftGroupResponse = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  status: "ACTIVO" | "INACTIVO";
  templateCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(row: ShiftGroupRow): ShiftGroupResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sortOrder: row.sortOrder,
    status: row.status,
    templateCount: row._count.templates,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Texto de auditoría: siempre código y nombre, nunca el id. */
export function describeShiftGroup(group: { code: string; name: string }) {
  return `${group.code} - ${group.name}`;
}

function auditSnapshot(row: ShiftGroupResponse | ShiftGroupRow) {
  const { id, code, name, sortOrder, status } = row;
  const templateCount = "templateCount" in row ? row.templateCount : row._count.templates;
  return { id, code, name, sortOrder, status, templateCount } as Prisma.InputJsonValue;
}

function duplicateError() {
  return new AppError("Ya existe un grupo de turnos con ese código o nombre", 409, "SHIFT_GROUP_DUPLICATE");
}

async function assertNoConflict(input: { code?: string; name?: string }, excludeId: string | null) {
  const conflicts = await shiftGroupRepository.findConflicting(input, excludeId);
  if (!conflicts.length) return;
  const sameCode = input.code && conflicts.some((item) => item.code.toLocaleLowerCase("es") === input.code!.toLocaleLowerCase("es"));
  throw new AppError(
    sameCode ? `Ya existe un grupo de turnos con el código «${input.code}»` : `Ya existe un grupo de turnos con el nombre «${input.name}»`,
    409,
    "SHIFT_GROUP_DUPLICATE",
  );
}

function isKnownError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function notFound() {
  return new AppError("No encontramos el grupo de turnos solicitado", 404, "SHIFT_GROUP_NOT_FOUND");
}

export const shiftGroupService = {
  async list(query: ListShiftGroupsQuery): Promise<ShiftGroupResponse[]> {
    const rows = await shiftGroupRepository.findMany(query.status);
    return rows.map(toResponse);
  },

  async create(input: CreateShiftGroupInput, audit?: AuditContext): Promise<ShiftGroupResponse> {
    await assertNoConflict({ code: input.code, name: input.name }, null);
    let row: ShiftGroupRow;
    try {
      row = await shiftGroupRepository.create(input, audit?.userId ?? null);
    } catch (error) {
      if (isKnownError(error, "P2002")) throw duplicateError();
      throw error;
    }
    const item = toResponse(row);
    await auditService.register({ ...audit, action: "CREATE", entity: "ShiftGroup", entityId: item.id, description: `Se creó el grupo de turnos ${describeShiftGroup(item)}.`, after: auditSnapshot(item) });
    return item;
  },

  async update(id: string, input: UpdateShiftGroupInput, audit?: AuditContext): Promise<ShiftGroupResponse> {
    const before = await shiftGroupRepository.findById(id);
    if (!before) throw notFound();
    await assertNoConflict({ code: input.code, name: input.name }, id);
    let row: ShiftGroupRow;
    try {
      row = await shiftGroupRepository.update(id, { ...input, updatedByUserId: audit?.userId ?? null });
    } catch (error) {
      if (isKnownError(error, "P2002")) throw duplicateError();
      if (isKnownError(error, "P2025")) throw notFound();
      throw error;
    }
    const item = toResponse(row);
    const statusChanged = input.status !== undefined && input.status !== before.status;
    const action = statusChanged ? (input.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
    const verb = { ACTIVATE: "Se activó", DEACTIVATE: "Se inactivó", UPDATE: "Se actualizó" }[action];
    const keepsTemplates = action === "DEACTIVATE" && item.templateCount > 0 ? ` Sus ${item.templateCount} turno(s) siguen asociados y funcionando; no se pueden asociar turnos nuevos.` : "";
    await auditService.register({
      ...audit,
      action,
      entity: "ShiftGroup",
      entityId: id,
      description: `${verb} el grupo de turnos ${describeShiftGroup(item)}.${keepsTemplates}`,
      before: auditSnapshot(before),
      after: auditSnapshot(item),
    });
    return item;
  },

  async remove(id: string, audit?: AuditContext): Promise<{ id: string }> {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const before = await shiftGroupRepository.findById(id, tx);
          if (!before) throw notFound();
          if (before._count.templates > 0) {
            throw new AppError(
              `No se puede eliminar el grupo ${describeShiftGroup(before)} porque tiene ${before._count.templates} turno(s) asociado(s). Inactivalo para que no se le asocien turnos nuevos.`,
              409,
              "SHIFT_GROUP_IN_USE",
            );
          }
          await shiftGroupRepository.delete(id, tx);
          await auditService.registerWithin(tx, { ...audit, action: "DELETE", entity: "ShiftGroup", entityId: id, description: `Se eliminó el grupo de turnos sin uso ${describeShiftGroup(before)}.`, before: auditSnapshot(before) });
          return { id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // FK RESTRICT (segunda defensa): una plantilla asociada en paralelo.
      if (isKnownError(error, "P2003")) throw new AppError("No se puede eliminar el grupo porque tiene turnos asociados. Inactivalo en su lugar.", 409, "SHIFT_GROUP_IN_USE");
      throw error;
    }
  },
};

/**
 * Valida el grupo que se quiere asociar a una plantilla (alta o edición).
 * - `null`/ausente: sin grupo, siempre válido.
 * - Debe existir.
 * - Asociar un grupo NUEVO para la plantilla exige que esté ACTIVO; conservar
 *   el grupo que ya tenía (aunque se haya inactivado después) está permitido.
 * Devuelve el grupo (para la auditoría) o null.
 */
export async function assertShiftGroupAssignable(
  shiftGroupId: string | null | undefined,
  currentShiftGroupId: string | null,
  db: Pick<PrismaTransactionClient, "shiftGroup"> = prisma,
): Promise<{ id: string; code: string; name: string; status: "ACTIVO" | "INACTIVO" } | null> {
  if (!shiftGroupId) return null;
  const group = await db.shiftGroup.findUnique({ where: { id: shiftGroupId }, select: { id: true, code: true, name: true, status: true } });
  if (!group) throw new AppError("El grupo de turnos indicado no existe", 404, "SHIFT_GROUP_NOT_FOUND");
  if (group.status !== "ACTIVO" && group.id !== currentShiftGroupId) {
    throw new AppError(`El grupo de turnos ${describeShiftGroup(group)} está inactivo: no se le pueden asociar turnos nuevos`, 409, "SHIFT_GROUP_INACTIVE");
  }
  return group;
}
