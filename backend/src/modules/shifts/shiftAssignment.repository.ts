import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { ListShiftAssignmentsQuery } from "./shiftAssignment.schemas";

const employeeSelect = { id: true, legajo: true, firstName: true, lastName: true, status: true } as const;
const shiftTemplateSelect = { id: true, code: true, name: true, categoryName: true, startTime: true, endTime: true, crossesMidnight: true, status: true } as const;

export type ShiftAssignmentVigencyData = {
  observation?: string | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  weekdays: number[];
};

export const shiftAssignmentRepository = {
  findMany(query: ListShiftAssignmentsQuery, employeeScope: Prisma.EmployeeWhereInput) {
    return prisma.shiftAssignment.findMany({
      where: {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.shiftTemplateId ? { shiftTemplateId: query.shiftTemplateId } : {}),
        ...(query.status ? { status: query.status } : {}),
        employee: employeeScope,
      },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
      orderBy: [{ status: "asc" }, { assignedAt: "desc" }],
    });
  },

  findById(id: string) {
    return prisma.shiftAssignment.findUnique({
      where: { id },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },

  findByIds(ids: string[]) {
    return prisma.shiftAssignment.findMany({
      where: { id: { in: ids } },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
      orderBy: [{ status: "asc" }, { assignedAt: "desc" }],
    });
  },

  findExisting(employeeId: string, shiftTemplateId: string) {
    return prisma.shiftAssignment.findUnique({ where: { employeeId_shiftTemplateId: { employeeId, shiftTemplateId } } });
  },

  create(employeeId: string, shiftTemplateId: string, data: ShiftAssignmentVigencyData, userId: string | null) {
    return prisma.shiftAssignment.create({
      data: {
        employeeId,
        shiftTemplateId,
        status: "HABILITADO",
        assignedByUserId: userId,
        observation: data.observation ?? null,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        weekdays: data.weekdays,
      },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },

  // Reactivar una asignación DESHABILITADO es, en los hechos, una reasignación:
  // RRHH está diciendo "desde ahora, con esta vigencia/días" — por eso
  // reEnable pisa effectiveFrom/effectiveTo/weekdays con los valores nuevos
  // en vez de conservar los de la vigencia anterior (ya vencida/cerrada).
  reEnable(id: string, data: ShiftAssignmentVigencyData, userId: string | null) {
    return prisma.shiftAssignment.update({
      where: { id },
      data: {
        status: "HABILITADO",
        assignedAt: new Date(),
        assignedByUserId: userId,
        disabledAt: null,
        disabledByUserId: null,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        weekdays: data.weekdays,
        ...(data.observation !== undefined ? { observation: data.observation } : {}),
      },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },

  updateObservation(id: string, observation: string | null) {
    return prisma.shiftAssignment.update({
      where: { id },
      data: { observation },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },

  update(id: string, data: Prisma.ShiftAssignmentUpdateInput) {
    return prisma.shiftAssignment.update({
      where: { id },
      data,
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },

  remove(id: string) {
    return prisma.shiftAssignment.delete({ where: { id } });
  },
};
