import { employeeAccessWhere } from "../employees/employeeAccess";
import { pendingRepository } from "./pending.repository";
import type { PendingQuery } from "./pending.schemas";

function formatEmployee(employee: { legajo: string; firstName: string; lastName: string }) {
  return `${employee.legajo} - ${employee.lastName}, ${employee.firstName}`;
}

export const pendingService = {
  async list(query: PendingQuery, user: Express.AuthUser) {
    const accessWhere = employeeAccessWhere(user);
    const [novelties, timeEntries, breakdowns] = await Promise.all([
      query.kind === "timeEntries" ? Promise.resolve([]) : pendingRepository.findPendingNovelties(query, accessWhere),
      query.kind === "novelties" ? Promise.resolve([]) : pendingRepository.findPendingTimeEntries(query, accessWhere),
      // Etapa 6L.3: mismo filtro "timeEntries" agrupa TimeEntry y desgloses
      // manuales — ambos son "cargas horarias pendientes" desde la bandeja.
      query.kind === "novelties" ? Promise.resolve([]) : pendingRepository.findPendingHourConceptBreakdowns(query, accessWhere),
    ]);

    const noveltyItems = novelties.map((item) => ({
      kind: "novelty" as const,
      sourceId: item.id,
      status: item.status,
      date: item.fromDate,
      employeeId: item.employee.id,
      employeeLabel: formatEmployee(item.employee),
      title: item.noveltyType.name,
      subtitle: item.targetHourConcept ? `Aplica sobre ${item.targetHourConcept.name}` : item.noveltyType.code,
      quantity: item.quantityHours?.toString() || item.quantityDays?.toString() || null,
      createdAt: item.createdAt,
    }));

    const timeEntryItems = timeEntries.map((item) => ({
      kind: "timeEntry" as const,
      sourceId: item.id,
      status: item.status,
      date: item.date,
      employeeId: item.employee.id,
      employeeLabel: formatEmployee(item.employee),
      title: item.hourConcept.name,
      subtitle: `${item.hours.toString()} hs cargadas`,
      quantity: item.hours.toString(),
      createdAt: item.createdAt,
    }));

    const breakdownItems = breakdowns.map((item) => ({
      kind: "hourConceptBreakdown" as const,
      sourceId: item.id,
      status: item.status,
      date: item.date,
      employeeId: item.employee.id,
      employeeLabel: formatEmployee(item.employee),
      title: item.hourConcept.name,
      subtitle: "Desglose manual",
      quantity: (item.minutes / 60).toFixed(2),
      createdAt: item.createdAt,
    }));

    const items = [...noveltyItems, ...timeEntryItems, ...breakdownItems].sort((a, b) => {
      const byDate = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (byDate !== 0) return byDate;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return {
      summary: {
        total: items.length,
        novelties: noveltyItems.length,
        timeEntries: timeEntryItems.length,
        hourConceptBreakdowns: breakdownItems.length,
      },
      data: items.slice(0, query.take),
    };
  },
};
