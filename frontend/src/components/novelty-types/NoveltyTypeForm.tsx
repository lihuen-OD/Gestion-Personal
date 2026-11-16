import { useEffect, useRef, type ReactNode } from "react";
import type { NoveltyType } from "../../types/noveltyType.types";
import { coverageConfigChanged, coverageHasDayRules, describeNoveltyTypeConfig, type NoveltyTypeIssue } from "../../utils/noveltyTypeCoverage";
import { noveltyColorClass } from "../../utils/noveltyColor";
import { Section } from "../ui/Section";
import { CoverageDayFields, CoverageImpactFields, CoverageTimeFields } from "./NoveltyTypeCoverageFields";
import { NoveltyTypeGeneralFields } from "./NoveltyTypeGeneralFields";
import { NoveltyTypeIntegrationFields } from "./NoveltyTypeIntegrationFields";
import { NoveltyTypeLoadControlFields } from "./NoveltyTypeLoadControlFields";

// Etapa 7 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §14): formulario único
// de alta y edición de un Tipo de Novedad, por secciones de negocio, con un
// resumen generado desde la configuración.

export function NoveltyTypeConfigSummary({ item }: { item: NoveltyType }) {
  return <aside className="novelty-type-summary-panel" aria-labelledby="novelty-type-summary-title">
    <h3 id="novelty-type-summary-title">Resumen</h3>
    <span className={`cell-novelty-pill ${noveltyColorClass(item.uiColor, item.uiColor)}`}>{item.name.trim() || "Nueva novedad"}</span>
    <ul>
      {describeNoveltyTypeConfig(item).map((line) => <li key={line}>{line}</li>)}
    </ul>
  </aside>;
}

export function NoveltyTypeForm({
  item,
  setItem,
  issues,
  original,
  error,
  actions,
  focusIssuesRequest = 0,
  disabled,
}: {
  item: NoveltyType;
  setItem: (item: NoveltyType) => void;
  /** Datos faltantes a marcar en cada campo (sólo después de intentar guardar). */
  issues?: NoveltyTypeIssue[];
  /** Tipo tal como está guardado (edición): avisa si cambia lo que cubre. */
  original?: NoveltyType;
  error?: string;
  actions: ReactNode;
  /** Cambia en cada envío rechazado por datos faltantes: lleva el foco al primer campo marcado. */
  focusIssuesRequest?: number;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusIssuesRequest) return;
    const invalid = containerRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]");
    if (!invalid) return;
    // En un grupo (opciones o días) se enfoca su primera opción.
    const target = invalid.matches("input, select, textarea") ? invalid : invalid.querySelector<HTMLElement>("input:checked, input");
    target?.focus();
    invalid.scrollIntoView?.({ block: "center" });
  }, [focusIssuesRequest]);
  const showDays = coverageHasDayRules(item.coverage);
  const sections = [
    { key: "general", title: "Datos generales", subtitle: "Cómo se identifica la novedad en la grilla y en los listados.", body: <NoveltyTypeGeneralFields item={item} setItem={setItem} issues={issues} disabled={disabled} /> },
    { key: "time", title: "Tiempo que cubre", subtitle: "Si la novedad representa horas y cómo se calcula su cantidad.", body: <CoverageTimeFields item={item} setItem={setItem} issues={issues} disabled={disabled} /> },
    ...(showDays ? [{ key: "days", title: "Días y situaciones especiales", subtitle: "Qué días de una novedad cuentan y qué pasa con francos y feriados.", body: <CoverageDayFields item={item} setItem={setItem} issues={issues} disabled={disabled} /> }] : []),
    { key: "impact", title: "Impacto en el cálculo", subtitle: "Cómo intervienen sus horas en los totales y en la revisión del día.", body: <CoverageImpactFields item={item} setItem={setItem} issues={issues} disabled={disabled} /> },
    { key: "load", title: "Carga y control", subtitle: "Quién la carga, qué se exige y cómo se aprueba.", body: <NoveltyTypeLoadControlFields item={item} setItem={setItem} disabled={disabled} /> },
    { key: "integration", title: "Integración y otras opciones", subtitle: "Exportación a Finnegans y notas internas.", body: <NoveltyTypeIntegrationFields item={item} setItem={setItem} issues={issues} disabled={disabled} /> },
  ];
  const recalculates = original ? coverageConfigChanged(original.coverage, item.coverage) : false;

  return <div className="novelty-type-editor" ref={containerRef}>
    <div className="novelty-type-editor-main">
      {sections.map((section, index) => (
        <Section key={section.key} className="novelty-type-section" title={`${index + 1}. ${section.title}`} subtitle={section.subtitle}>{section.body}</Section>
      ))}
      <div className="novelty-type-editor-footer">
        {recalculates ? (
          <p className="info-note compact">Este cambio puede recalcular novedades ya cargadas en períodos abiertos.</p>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="form-actions">{actions}</div>
      </div>
    </div>
    <NoveltyTypeConfigSummary item={item} />
  </div>;
}
