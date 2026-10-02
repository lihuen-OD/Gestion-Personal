import { Clock3, Coins } from "lucide-react";
import type { PeriodAccountingSummary } from "../../types/workedTimeAccounting.types";
import { formatDurationMinutes } from "../../utils/hours";
import { StatCard } from "../ui/StatCard";

// KPIs del modelo de tiempo trabajado (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md),
// compartidos por el detalle por legajo y el panel de revisión de cierre: el
// total trabajado real y, sólo si hubo Hora Especial, la equivalencia para
// liquidación (que ya parte de las categorías sin duplicar).
export function AccountingStatCards({ accounting }: { accounting: PeriodAccountingSummary }) {
  const baseDetail = accounting.additiveMinutes > 0
    ? `Base ${formatDurationMinutes(accounting.baseMinutes)} + adicionales ${formatDurationMinutes(accounting.additiveMinutes)}`
    : "Horas base registradas";
  return (
    <>
      <StatCard label="Total trabajado" value={formatDurationMinutes(accounting.totalWorkedMinutes)} detail={baseDetail} icon={Clock3} />
      {accounting.hasSpecialMultiplier ? (
        <StatCard
          label="Para liquidación"
          value={formatDurationMinutes(accounting.settlement.totalMinutes)}
          detail="Equivalencia con Hora especial"
          icon={Coins}
          tone="green"
        />
      ) : null}
    </>
  );
}
