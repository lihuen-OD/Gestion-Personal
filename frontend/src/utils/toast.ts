// Etapa 15M.16 (docs/PROJECT_UI_CONTEXT.md "Feedback temporal vs banners
// persistentes"): duración estándar de un mensaje de éxito transitorio
// (".toast" en styles.css). No es un valor nuevo -- es el mismo que ya usan
// ~10 pantallas (EmployeeDetailPage, WorkRegimesPage, HourConceptsPage,
// AssociatedEmployeesPanel, etc.), cada una con el número hardcodeado por su
// cuenta. Se documenta acá para que código nuevo lo importe en vez de volver
// a inventar un número distinto — no implica reescribir esas ~10 pantallas.
export const TOAST_SUCCESS_MS = 2200;
