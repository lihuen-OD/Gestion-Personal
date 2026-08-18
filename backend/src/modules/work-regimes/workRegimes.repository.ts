import { prisma } from "../../shared/prisma/client";

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
