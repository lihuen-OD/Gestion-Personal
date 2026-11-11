import { useRef, type KeyboardEvent } from "react";
import { AlertCircle, ChevronRight, Search, X } from "lucide-react";
import type { ClockEmployee } from "../../services/api/timeClockApiService";
import { employeeIdentity, employeeInitials, employeeListName } from "./employeeLabels";

/** Mínimo de caracteres para consultar al backend (TimeClockPage). */
export const MIN_SEARCH_LENGTH = 2;

export type SearchState = "idle" | "hint" | "pending" | "results" | "empty" | "error";

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Resalta la parte del nombre que coincide con lo escrito (sin tildes ni mayúsculas). */
function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = normalize(query.trim());
  // NFD + quitar diacríticos conserva el largo de los caracteres precompuestos (NFC).
  const start = needle ? normalize(text).indexOf(needle) : -1;
  if (start < 0 || text.normalize("NFC") !== text) return <>{text}</>;
  const end = start + needle.length;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/**
 * Paso 1: buscar a la persona. Sólo presentación: la consulta, su debounce y
 * la selección siguen en TimeClockPage.
 */
export function EmployeeSearch({ value, state, matches, errorMessage, onChange, onClear, onSelect }: {
  value: string;
  state: SearchState;
  matches: ClockEmployee[];
  errorMessage: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSelect: (employee: ClockEmployee) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const rows = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>(".kiosk-row") ?? []);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowDown") return;
    const first = rows()[0];
    if (!first) return;
    event.preventDefault();
    first.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const all = rows();
    const index = all.indexOf(event.currentTarget);
    const next = event.key === "ArrowDown" ? all[index + 1] : all[index - 1] ?? input.current;
    next?.focus();
  };

  const showList = matches.length > 0 && (state === "results" || state === "pending");

  return (
    <>
      <div className="kiosk-intro">
        <h2>Registrá tu entrada o salida</h2>
        <p>Buscá tu nombre para empezar.</p>
      </div>

      <div className="kiosk-search">
        <Search size={22} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          placeholder="Apellido o nombre"
          aria-label="Buscar por nombre o apellido"
          aria-controls="kiosk-search-results"
        />
        <span className="kiosk-search-trail">
          {state === "pending" ? (
            <span className="kiosk-spinner" role="img" aria-label="Buscando" />
          ) : value ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Borrar búsqueda"
              onClick={() => {
                onClear();
                input.current?.focus();
              }}
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          ) : null}
        </span>
      </div>

      <div id="kiosk-search-results" className="kiosk-search-results" aria-live="polite">
        {state === "hint" ? <p className="kiosk-helper">Escribí al menos {MIN_SEARCH_LENGTH} letras.</p> : null}

        {state === "pending" && !matches.length ? (
          <>
            <ul className="kiosk-results" aria-hidden="true">
              {[0, 1, 2].map((key) => (
                <li key={key}>
                  <div className="kiosk-row is-skeleton">
                    <span className="kiosk-avatar skeleton-bar" />
                    <span className="kiosk-row-text">
                      <span className="skeleton-bar kiosk-skeleton-name" />
                      <span className="skeleton-bar kiosk-skeleton-meta" />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <span className="sr-only">Buscando…</span>
          </>
        ) : null}

        {showList ? (
          <ul className="kiosk-results" ref={list} aria-label={matches.length === 1 ? "1 coincidencia" : `${matches.length} coincidencias`}>
            {matches.map((employee) => (
              <li key={employee.id}>
                <button type="button" className="kiosk-row" onClick={() => onSelect(employee)} onKeyDown={onRowKeyDown}>
                  <span className="kiosk-avatar" aria-hidden="true">{employeeInitials(employee)}</span>
                  <span className="kiosk-row-text">
                    <span className="kiosk-row-name"><Highlighted text={employeeListName(employee)} query={value} /></span>
                    <span className="kiosk-row-meta">{employeeIdentity(employee)}</span>
                  </span>
                  <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {state === "empty" ? (
          <div className="kiosk-empty">
            <span className="kiosk-empty-icon" aria-hidden="true"><Search size={22} strokeWidth={1.75} /></span>
            <strong>No encontramos a “{value.trim()}”</strong>
            <p>Revisá cómo está escrito o probá sólo con tu apellido.</p>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="kiosk-notice tone-danger" role="alert">
            <AlertCircle size={22} strokeWidth={1.75} aria-hidden="true" />
            <p>{errorMessage}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
