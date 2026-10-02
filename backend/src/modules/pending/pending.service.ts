import { employeeAccessWhere } from "../employees/employeeAccess";
import { pendingRepository } from "./pending.repository";
import type { PendingQuery } from "./pending.schemas";

function formatEmployee(employee: { legajo: string; firstName: string; lastName: string }) {
  return `${employee.legajo} - ${employee.lastName}, ${employee.firstName}`;
}

export const pendingService = {
  async list(query: PendingQuery, user: Express.AuthUser) {
    const accessWhere = employeeAccessWhere(user);
    const includeNovelties = query.kind === "all" || query.kind === "novelties";
    const includeTimeEntries = query.kind === "all" || query.kind === "timeEntries";
    // Etapa 6L.3: mismo filtro "timeEntries" agrupa TimeEntry y desgloses
    // manuales — ambos son "cargas horarias pendientes" desde la bandeja.
    const includeBreakdowns = query.kind === "all" || query.kind === "timeEntries" || query.kind === "hourConceptBreakdowns";
    // Sólo los kinds de una fuente paginan; los combinados siempre devuelven
    // la primera página de cada fuente (paginar una unión de 3 tablas con
    // OFFSET independiente por tabla daría páginas incorrectas).
    const paginated = query.kind === "novelties" || query.kind === "hourConceptBreakdowns";
    const sourceQuery = paginated ? query : { ...query, page: 1 };
    const none = Promise.resolve([]);
    const zero = Promise.resolve(0);
    const [novelties, timeEntries, breakdowns, noveltyTotal, timeEntryTotal, breakdownTotal] = await Promise.all([
      includeNovelties ? pendingRepository.findPendingNovelties(sourceQuery, accessWhere) : none,
      includeTimeEntries ? pendingRepository.findPendingTimeEntries(sourceQuery, accessWhere) : none,
      includeBreakdowns ? pendingRepository.findPendingHourConceptBreakdowns(sourceQuery, accessWhere) : none,
      includeNovelties ? pendingRepository.countPendingNovelties(query, accessWhere) : zero,
      includeTimeEntries ? pendingRepository.countPendingTimeEntries(query, accessWhere) : zero,
      includeBreakdowns ? pendingRepository.countPendingHourConceptBreakdowns(query, accessWhere) : zero,
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
      // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: quien revisa tiene
      // que saber si aprobar esta carga cambia el total trabajado.
      subtitle: item.hourConcept.workTreatment === "ADDITIVE_TO_WORKED_TOTAL"
        ? "Carga manual · Hora adicional (suma al total trabajado)"
        : "Carga manual · Dentro de la jornada (no suma al total)",
      quantity: (item.minutes / 60).toFixed(2),
      createdAt: item.createdAt,
    }));

    const items = [...noveltyItems, ...timeEntryItems, ...breakdownItems].sort((a, b) => {
      const byDate = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (byDate !== 0) return byDate;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const total = noveltyTotal + timeEntryTotal + breakdownTotal;
    const data = items.slice(0, query.take);
    const page = paginated ? query.page ?? 1 : 1;
    return {
      // Totales reales (count), no la cantidad de filas traídas: antes con
      // take=300 la bandeja nunca podía informar más de 300 pendientes.
      summary: {
        total,
        novelties: noveltyTotal,
        timeEntries: timeEntryTotal,
        hourConceptBreakdowns: breakdownTotal,
      },
      data,
      meta: {
        total,
        page,
        pageSize: query.take,
        hasMore: paginated ? page * query.take < total : data.length < total,
      },
    };
  },
};
