import { z } from "zod";

// Booleano de query string. `z.coerce.boolean()` aplica `Boolean(valor)`:
// todo string no vacío — incluido "false" — da `true`, así que un filtro
// `?mandatory=false` filtraba exactamente al revés (mismo bug ya corregido
// puntualmente en employees.schemas.ts::includeDetails, Etapa 14I.9). Acá
// sólo "true"/"false" (y booleanos reales) son válidos; cualquier otro valor
// es un 400 VALIDATION_ERROR en vez de interpretarse en silencio.
export function queryBoolean() {
  return z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean());
}
