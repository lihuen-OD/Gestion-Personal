import { clearWorkedTimeDerivedReadCaches } from "../time-entries/workedTimeReadCaches";
import { clearNoveltiesReadCaches } from "./novelties.cache";

/**
 * Única invalidación después de cualquier cambio que reinterpreta la
 * cobertura de novedades (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13.7):
 * las cachés derivadas de horas (grilla por legajo y panel de cierre, grilla
 * de período/resumen, dashboard y cierres) más las de Novedades. La llaman los
 * controllers después del commit, nunca dentro de la transacción.
 */
export function clearNoveltyCoverageReadCaches() {
  clearWorkedTimeDerivedReadCaches();
  clearNoveltiesReadCaches();
}
