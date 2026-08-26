import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { workforceApiService, type DoubleHourRuleCalendarDay } from "../../services/api/workforceApiService";
import { LoadingState } from "../ui/LoadingState";

const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function monthRange(year: number, month: number) {
  return { from: new Date(Date.UTC(year, month, 1)), to: new Date(Date.UTC(year, month + 1, 0)) };
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Etapa 8B: calendario de CONFIGURACIÓN — muestra qué Horas Especiales
// podrían aplicar cada día según su calendario+alcance, no fichadas reales.
// La resolución exacta por empleado sigue ocurriendo únicamente en el motor
// al fichar (ver docs/decisions/HORAS_ESPECIALES_8B.md).
//
// `refreshToken` (Etapa 8B — corrección de sincronización): este componente
// tiene su propio fetch, desacoplado del listado de reglas de la página —
// sin esta prop, crear/editar/activar/borrar una regla nunca le llegaba
// ninguna señal y el mes visible quedaba con datos viejos hasta que el
// usuario cambiaba de mes (lo que sí dispara `cursor`) o recargaba la
// página. El padre incrementa `refreshToken` después de cada mutación
// exitosa; acá sólo se usa como disparador de refetch, nunca se lee su
// valor. El refetch por cambio de token es SILENCIOSO (no vuelve a mostrar
// el esqueleto de carga ni borra la grilla mientras llega la respuesta) —
// sólo el primer fetch de cada mes muestra el loading de página completa.
export function SpecialHourRulesCalendarMonth({ refreshToken }: { refreshToken?: number } = {}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getUTCFullYear(), month: today.getUTCMonth() });
  const [daysByDate, setDaysByDate] = useState<Map<string, DoubleHourRuleCalendarDay>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedCurrentMonth = useRef(false);

  // Nuevo mes visible: la próxima carga es "inicial" para ese mes (sí muestra
  // el loading de página completa) — separado del efecto de fetch para que
  // el reset corra ANTES de que ese efecto decida si bloquear o no.
  useEffect(() => {
    hasLoadedCurrentMonth.current = false;
  }, [cursor.year, cursor.month]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const isInitialLoadForMonth = !hasLoadedCurrentMonth.current;
      if (isInitialLoadForMonth) setIsLoading(true);
      try {
        const { from, to } = monthRange(cursor.year, cursor.month);
        const days = await workforceApiService.doubleHourRulesCalendar(toDateKey(from), toDateKey(to));
        if (cancelled) return;
        setDaysByDate(new Map(days.map((day) => [day.date, day])));
        setError("");
        hasLoadedCurrentMonth.current = true;
      } catch {
        if (cancelled) return;
        // Refresh silencioso que falla: se avisa sin pisar la grilla ya
        // mostrada (que sigue siendo el último dato válido conocido) y sin
        // afectar el guardado de la regla, que ya se hizo antes de esto.
        setError(isInitialLoadForMonth ? "No se pudo cargar el calendario." : "No se pudo actualizar el calendario. La regla se guardó, pero la vista puede estar desactualizada.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [cursor, refreshToken]);

  const { from } = monthRange(cursor.year, cursor.month);
  const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const leadingBlanks = from.getUTCDay();
  const monthLabel = from.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

  const cells: Array<{ day: number; dateKey: string } | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, dateKey: toDateKey(new Date(Date.UTC(cursor.year, cursor.month, day))) });
  }

  const goToPreviousMonth = () => setCursor((current) => (current.month === 0 ? { year: current.year - 1, month: 11 } : { year: current.year, month: current.month - 1 }));
  const goToNextMonth = () => setCursor((current) => (current.month === 11 ? { year: current.year + 1, month: 0 } : { year: current.year, month: current.month + 1 }));

  return (
    <div className="special-hours-calendar">
      <div className="special-hours-calendar-header">
        <button type="button" className="table-icon-action" onClick={goToPreviousMonth} aria-label="Mes anterior">
          <ChevronLeft />
        </button>
        <strong className="special-hours-calendar-title">{monthLabel}</strong>
        <button type="button" className="table-icon-action" onClick={goToNextMonth} aria-label="Mes siguiente">
          <ChevronRight />
        </button>
      </div>
      {error ? (
        <div className="special-hours-calendar-refresh-error" role="alert">
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      ) : null}
      {isLoading ? (
        <LoadingState text="Cargando calendario..." />
      ) : (
        <div className="special-hours-calendar-grid">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="special-hours-calendar-weekday">
              {label}
            </div>
          ))}
          {cells.map((cell, index) => {
            if (!cell) return <div key={`blank-${index}`} className="special-hours-calendar-cell special-hours-calendar-cell-empty" />;
            const day = daysByDate.get(cell.dateKey);
            const cellClass = day?.hasConflict ? " has-conflict" : day?.hasOverlap ? " has-overlap" : "";
            return (
              <div key={cell.dateKey} className={`special-hours-calendar-cell${cellClass}`}>
                <span className="special-hours-calendar-day-number">{cell.day}</span>
                {day?.rules.map((appliedRule) => (
                  <span key={appliedRule.id} className="special-hours-calendar-chip" title={`Prioridad ${appliedRule.priority}`}>
                    {appliedRule.name} x{appliedRule.multiplier}
                  </span>
                ))}
                {day?.hasConflict ? (
                  <span className="special-hours-calendar-alert" title="Hay reglas superpuestas para esta fecha, con la misma prioridad. Revisá cuál debería aplicar.">
                    <AlertTriangle size={12} /> Conflicto
                  </span>
                ) : day?.hasOverlap ? (
                  <span className="special-hours-calendar-alert special-hours-calendar-alert-info" title="Se aplicará la regla con mayor prioridad.">
                    <AlertTriangle size={12} /> Superposición
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
