import { useRef, type KeyboardEvent } from "react";

type TabItem = { key: string; label: string };

/** Ids estables pestaña ↔ panel cuando el llamador renderiza el panel (`idBase`). */
export function tabIds(idBase: string, key: string) {
  return { tab: `${idBase}-tab-${key}`, panel: `${idBase}-panel-${key}` };
}

/** Props del contenedor del contenido de la pestaña activa (patrón WAI-ARIA Tabs). */
export function tabPanelProps(idBase: string, key: string) {
  const ids = tabIds(idBase, key);
  return { role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab } as const;
}

/**
 * Pestañas con semántica WAI-ARIA (R4.8A): `tablist`/`tab`/`aria-selected`,
 * una sola pestaña en el orden de tabulación (la activa) y flechas, Inicio y
 * Fin para moverse (activación automática, como ya ocurría al hacer clic).
 * Sin cambios visuales: mismas clases `.tabs` y `button.active`.
 */
export function Tabs({ tabs, active, onChange, className = "", ariaLabel, idBase }: { tabs: TabItem[]; active: string; onChange: (key: string) => void; className?: string; ariaLabel?: string; idBase?: string }) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = tabs.findIndex((tab) => tab.key === active);
  const focusableIndex = activeIndex >= 0 ? activeIndex : 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    if (tabs[next]!.key !== active) onChange(tabs[next]!.key);
  };

  return (
    <div className={`tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const selected = tab.key === active;
        const ids = idBase ? tabIds(idBase, tab.key) : null;
        return (
          <button
            key={tab.key}
            ref={(element) => { buttons.current[index] = element; }}
            type="button"
            role="tab"
            id={ids?.tab}
            aria-controls={ids && selected ? ids.panel : undefined}
            aria-selected={selected}
            tabIndex={index === focusableIndex ? 0 : -1}
            className={selected ? "active" : ""}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
