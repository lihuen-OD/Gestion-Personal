import { useEffect, useRef, useState } from "react";
import { Bell, ShieldAlert } from "lucide-react";
import { employeeApiService, type EmployeeTimeGrid } from "../../services/api/employeeApiService";
import type { MonthlyClosure } from "../../services/api/workforceApiService";
import { formatPeriodLabel } from "../../utils/period";
import { monthlyClosureStatusText, monthlyClosureStatusTone } from "../../utils/monthlyClosureStatus";
import { Badge } from "../ui/Badge";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
import { StatCard } from "../ui/StatCard";
import { AccountingStatCards } from "./AccountingStatCards";
import { HoursAccountingSummary } from "./HoursAccountingSummary";
import { MonthlyHoursReviewGrid } from "./MonthlyHoursReviewGrid";
import { NoveltyCoverageResolutionModal, type NoveltyCoverageReviewTarget } from "./NoveltyCoverage";
import { monthDate } from "../../utils/period";
import { formatCalendarDate } from "../../utils/date";

// Etapa 15K: contenedor de carga — carga lazy (una sola llamada, sólo para
// `closure.employeeId`) y delega toda la presentación de la grilla a
// MonthlyHoursReviewGrid. No conoce reglas de cierre ni ejecuta acciones:
// aprobar/enviar/devolver siguen viviendo, sin cambios, en MonthlyClosuresPage.
export function MonthlyClosureReviewPanel({ closure, period, close }: { closure: MonthlyClosure; period: string; close: () => void }) {
  const [grid, setGrid] = useState<EmployeeTimeGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [coverageReview, setCoverageReview] = useState<NoveltyCoverageReviewTarget | null>(null);
  const hasLoadedGrid = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasLoadedGrid.current) setLoading(true);
    setError("");
    if (!hasLoadedGrid.current) setGrid(null);
    employeeApiService
      .getTimeGrid(closure.employeeId, period, { includeDetails: true })
      .then((result) => {
        if (cancelled) return;
        setGrid(result);
        hasLoadedGrid.current = true;
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
  }, [closure.employeeId, period, refresh]);

  const noveltyCount = grid?.novelties.length ?? 0;
  const firstReview = grid ? Object.entries(grid.noveltiesByDay).flatMap(([day, items]) => items.filter((item) => item.reviewRequired).map((item) => ({ item, day: Number(day) })))[0] : undefined;

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
            <div className={grid.accounting.hasSpecialMultiplier ? "stat-grid" : "stat-grid three"}>
              <AccountingStatCards accounting={grid.accounting} />
              <StatCard label="Incidencias del período" value={grid.attendanceIssues} icon={ShieldAlert} tone="red" />
              <StatCard label="Novedades del período" value={noveltyCount} icon={Bell} tone="purple" />
            </div>
            <HoursAccountingSummary accounting={grid.accounting} concepts={grid.rows.map((row) => row.concept)} />
            {grid.accounting.novelty.reviewDays > 0 ? <div className="novelty-review-banner" role="status"><ShieldAlert size={18} /><div><b>{grid.accounting.novelty.reviewDays} día(s) bloquean el cierre</b><span>{grid.accounting.novelty.reviewDates.map(formatCalendarDate).join(" · ")}</span></div>{firstReview ? <button type="button" className="table-link" onClick={() => setCoverageReview({ item: firstReview.item, date: monthDate(period, firstReview.day), employeeId: closure.employeeId, period, workedMinutes: grid.accounting.days[String(firstReview.day)]?.totalWorkedMinutes ?? 0 })}>Revisar primer día</button> : null}</div> : null}
            <MonthlyHoursReviewGrid grid={grid} period={period} onReviewNovelty={(item, day) => setCoverageReview({ item, date: monthDate(period, day), employeeId: closure.employeeId, period, workedMinutes: grid.accounting.days[String(day)]?.totalWorkedMinutes ?? 0, computableMinutes: grid.accounting.days[String(day)]?.computableMinutes })} />
          </>
        ) : null}
      </div>
      {coverageReview ? <NoveltyCoverageResolutionModal target={coverageReview} close={() => setCoverageReview(null)} onResolved={() => setRefresh((value) => value + 1)} /> : null}
    </Modal>
  );
}
