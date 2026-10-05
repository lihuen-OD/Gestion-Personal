// Todos los ids de este sistema son UUID (`@default(uuid())`). Un UUID en un
// texto visible es siempre un id técnico filtrado: ningún dato de negocio
// (legajo, CUIL, DNI, código) tiene esa forma.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const HIDDEN_TECHNICAL_ID = "—";

export function containsTechnicalId(text: string) {
  return new RegExp(UUID_PATTERN.source, "i").test(text);
}

export function maskTechnicalIds(text: string, replacement = HIDDEN_TECHNICAL_ID) {
  return text.replace(UUID_PATTERN, replacement);
}

/** "/api/employees/<uuid>/overview?x=<uuid>" -> "/api/employees/:id/overview?x=:id" */
export function describeRequestPath(url: string) {
  return maskTechnicalIds(url, ":id");
}
