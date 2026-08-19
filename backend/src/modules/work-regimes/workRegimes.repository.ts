import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateWorkRegimeInput, ListWorkRegimesQuery, UpdateWorkRegimeInput } from "./workRegimes.schemas";

// Régimen vigente de un empleado en una fecha calendario dada: vigente si
// effectiveFrom <= fecha y (effectiveTo es null o effectiveTo >= fecha). Si
// hay mas de una fila vigente, gana la de effectiveFrom mas reciente.
export function findActiveEmployeeWorkRegime(employeeId: string, referenceDate: Date) {
  return prisma.employeeWorkRegime.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: referenceDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: referenceDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
    include: { workRegime: true },
  });
}

function buildWorkRegimeWhere(query: ListWorkRegimesQuery): Prisma.WorkRegimeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

// Overlap de vigencias para un mismo empleado (V1: no se permiten dos
// EmployeeWorkRegime vigentes solapados). Dos rangos [aFrom, aTo] / [bFrom,
// bTo] (con null = sin límite) se solapan sii aFrom <= (bTo ?? +inf) Y
// (aTo ?? +inf) >= bFrom. excludeId sirve para re-chequear al editar una
// asignación existente sin que se choque contra sí misma.
function findOverlappingAssignment(employeeId: string, effectiveFrom: Date, effectiveTo: Date | null | undefined, excludeId?: string) {
  return prisma.employeeWorkRegime.findFirst({
    where: {
      employeeId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      AND: [
        effectiveTo ? { effectiveFrom: { lte: effectiveTo } } : {},
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
      ],
    },
    include: { workRegime: { select: { code: true, name: true } } },
  });
}

export const workRegimesRepository = {
  async findMany(query: ListWorkRegimesQuery) {
    const where = buildWorkRegimeWhere(query);
    const skip = (query.page - 1) * query.take;
    const [items, total] = await prisma.$transaction([
      prisma.workRegime.findMany({
        where,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.workRegime.count({ where }),
    ]);
    return [items, total] as const;
  },

  findById(id: string) {
    return prisma.workRegime.findUniqueOrThrow({ where: { id } });
  },

  create(data: CreateWorkRegimeInput, createdByUserId?: string | null) {
    return prisma.workRegime.create({
      data: { ...data, createdByUserId: createdByUserId || null, updatedByUserId: createdByUserId || null },
    });
  },

  update(id: string, data: UpdateWorkRegimeInput, updatedByUserId?: string | null) {
    return prisma.workRegime.update({
      where: { id },
      data: { ...data, updatedByUserId: updatedByUserId || null },
    });
  },

  employeeExists(employeeId: string) {
    return prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  },

  findHistoryByEmployee(employeeId: string) {
    return prisma.employeeWorkRegime.findMany({
      where: { employeeId },
      include: { workRegime: true },
      orderBy: { effectiveFrom: "desc" },
    });
  },

  findAssignmentById(employeeId: string, assignmentId: string) {
    return prisma.employeeWorkRegime.findFirst({
      where: { id: assignmentId, employeeId },
      include: { workRegime: true },
    });
  },

  findOverlappingAssignment,

  createAssignment(data: { employeeId: string; workRegimeId: string; effectiveFrom: Date; effectiveTo?: Date | null; assignedByUserId?: string | null }) {
    return prisma.employeeWorkRegime.create({
      data: {
        employeeId: data.employeeId,
        workRegimeId: data.workRegimeId,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        assignedByUserId: data.assignedByUserId || null,
      },
      include: { workRegime: true },
    });
  },

  updateAssignment(id: string, data: { workRegimeId?: string; effectiveFrom?: Date; effectiveTo?: Date | null }) {
    return prisma.employeeWorkRegime.update({
      where: { id },
      data,
      include: { workRegime: true },
    });
  },
};
