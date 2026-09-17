import { useEffect, useState } from "react";
import { AlertTriangle, Bell, Clock3, Coins, ShieldAlert } from "lucide-react";
import { employeeApiService, type EmployeeTimeGrid } from "../../services/api/employeeApiService";
import type { MonthlyClosure } from "../../services/api/workforceApiService";
import { additionalBreakdownMinutes, totalWorkedMinutesFromRows } from "../../utils/employeeHoursGrid";
import { formatDurationMinutes } from "../../utils/hours";
import { formatPeriodLabel } from "../../utils/period";
import { monthlyClosureStatusText, monthlyClosureStatusTone } from "../../utils/monthlyClosureStatus";
import { Badge } from "../ui/Badge";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
import { StatCard } from "../ui/StatCard";
import { MonthlyHoursReviewGrid } from "./MonthlyHoursReviewGrid";

// Etapa 15K: contenedor de carga — carga lazy (una sola llamada, sólo para
// `closure.employeeId`) y delega toda la presentación de la grilla a
// MonthlyHoursReviewGrid. No conoce reglas de cierre ni ejecuta acciones:
// aprobar/enviar/devolver siguen viviendo, sin cambios, en MonthlyClosuresPage.
export function MonthlyClosureReviewPanel({ closure, period, close }: { closure: MonthlyClosure; period: string; close: () => void }) {
  const [grid, setGrid] = useState<EmployeeTimeGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setGrid(null);
    employeeApiService
      .getTimeGrid(closure.employeeId, period, { includeDetails: true })
      .then((result) => {
        if (cancelled) return;
        setGrid(result);
      })
      .catch(() => {
        if (!cancelled) setError("No pudimos cargar las horas de este legajo. Reintentá en unos segundos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [closure.employeeId, period]);

  const totalMinutes = grid ? totalWorkedMinutesFromRows(grid.rows) : 0;
  const additionalTotalMinutes = grid ? additionalBreakdownMinutes(grid.rows) : 0;
  const noveltyCount = grid?.novelties.length ?? 0;
  const hasLiquidable = Boolean(grid && grid.specialHourAdditionalMinutes > 0);

  return (
    <Modal
      title={`${closure.employee.lastName}, ${closure.employee.firstName}`}
      subtitle={`Legajo ${closure.employee.legajo} · ${formatPeriodLabel(period)}`}
      close={close}
    >
      <div className="monthly-hours-review-panel">
        <div className="review-panel-head">
          <Badge tone={monthlyClosureStatusTone(closure.status)}>{monthlyClosureStatusText[closure.status]}</Badge>
        </div>

        {loading ? <LoadingState text="Cargando horas del período..." /> : null}

        {!loading && error ? <div className="form-error">{error}</div> : null}

        {!loading && !error && grid ? (
          <>
            <div className={hasLiquidable ? "stat-grid five" : "stat-grid"}>
              <StatCard label="Horas reales trabajadas" value={formatDurationMinutes(totalMinutes)} icon={Clock3} />
              <StatCard label="Conceptos horarios adicionales" value={formatDurationMinutes(additionalTotalMinutes)} icon={AlertTriangle} tone="orange" />
              <StatCard label="Incidencias del período" value={grid.attendanceIssues} icon={ShieldAlert} tone="red" />
              <StatCard label="Novedades del período" value={noveltyCount} icon={Bell} tone="purple" />
              {hasLiquidable ? (
                <StatCard
                  label="Valor liquidable"
                  value={formatDurationMinutes(grid.specialHourLiquidableTotalMinutes)}
                  detail={`Incluye Hora especial: +${formatDurationMinutes(grid.specialHourAdditionalMinutes)}`}
                  icon={Coins}
                  tone="green"
                />
              ) : null}
            </div>
            <MonthlyHoursReviewGrid grid={grid} period={period} />
          </>
        ) : null}
      </div>
    </Modal>
  );
}
