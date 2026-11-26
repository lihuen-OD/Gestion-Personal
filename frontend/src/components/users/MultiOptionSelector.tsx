import { Check } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SearchInput } from "../ui/SearchInput";

export type MultiOption = {
  id: string;
  label: string;
  /** Segunda línea (email, código…). También se busca por ella. */
  detail?: string;
  /** Opción inactiva: se muestra con badge (sólo debería ofrecerse si ya estaba seleccionada). */
  inactive?: boolean;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Selección múltiple con buscador, resultados con check y chips (mismo patrón
 * visual que el selector de empleados, `.people-search`). Filtra en memoria:
 * pensado para catálogos chicos ya cargados en la pantalla. Lo usan los
 * responsables de carga supervisados y los grupos de turnos de un Nivel 2.
 */
export function MultiOptionSelector({
  title,
  help,
  options,
  selectedIds,
  onChange,
  disabled = false,
  status = "ready",
  onRetry,
  labels,
}: {
  title: string;
  help: string;
  options: MultiOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** Estado de carga del catálogo de opciones. */
  status?: "loading" | "error" | "ready";
  onRetry?: () => void;
  labels: {
    searchPlaceholder: string;
    searchLabel: string;
    resultsLabel: string;
    noMatch: string;
    noOptions: string;
    noneSelected: string;
    loading?: string;
    error?: string;
    /** "2 responsables seleccionados". */
    count: (count: number) => string;
  };
}) {
  const headingId = useId();
  const helpId = useId();
  const [search, setSearch] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const query = normalize(search.trim());
  const visible = options.filter((option) => !query || normalize(`${option.label} ${option.detail ?? ""}`).includes(query));
  const selectedOptions = selectedIds.map((id) => byId.get(id)).filter((option): option is MultiOption => Boolean(option));

  const toggle = (id: string) => onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);

  return (
    <section className="people-search multi-option-select" aria-labelledby={headingId} aria-describedby={helpId} aria-busy={status === "loading"}>
      <div className="multi-option-select-head">
        <b id={headingId}>{title}</b>
        <small id={helpId}>{help}</small>
      </div>
      {status === "loading" ? (
        <small role="status">{labels.loading ?? "Cargando opciones..."}</small>
      ) : status === "error" ? (
        <div className="multi-option-select-error" role="alert">
          <small>{labels.error ?? "No pudimos cargar las opciones."}</small>
          {onRetry ? <Button variant="subtle" onClick={onRetry}>Reintentar</Button> : null}
        </div>
      ) : options.length ? (
        <>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchLabel}
            disabled={disabled}
          />
          <div className="people-search-results" role="group" aria-label={labels.resultsLabel}>
            {visible.length ? visible.map((option) => (
              <button key={option.id} type="button" className={selected.has(option.id) ? "is-selected" : ""} aria-pressed={selected.has(option.id)} disabled={disabled} onClick={() => toggle(option.id)}>
                <span className="people-result-check">{selected.has(option.id) ? <Check size={14} /> : null}</span>
                <span>
                  <b>{option.label}{option.inactive ? <Badge tone="neutral">Inactivo</Badge> : null}</b>
                  {option.detail ? <small>{option.detail}</small> : null}
                </span>
              </button>
            )) : <span>{labels.noMatch}</span>}
          </div>
        </>
      ) : (
        <small>{labels.noOptions}</small>
      )}
      {status === "ready" ? (
        <>
          <div className="selected-people" aria-live="polite">
            {selectedOptions.length ? selectedOptions.map((option) => (
              <span key={option.id}>
                {option.label}
                <button type="button" aria-label={`Quitar ${option.label}`} disabled={disabled} onClick={() => toggle(option.id)}>×</button>
              </span>
            )) : <em>{labels.noneSelected}</em>}
          </div>
          {selectedOptions.length ? (
            <div className="people-selection-summary">
              <span>{labels.count(selectedOptions.length)}</span>
              <button type="button" disabled={disabled} onClick={() => onChange([])}>Quitar todos</button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
