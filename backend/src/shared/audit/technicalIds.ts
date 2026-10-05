// Todos los ids de este sistema son UUID (`@default(uuid())`). Un UUID en un
// texto visible es siempre un id técnico filtrado: ningún dato de negocio
// (legajo, CUIL, DNI, código) tiene esa forma.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function containsTechnicalId(text: string) {
  return new RegExp(UUID, "i").test(text);
}

/**
 * Última defensa, no presentación: los textos se arman con identidad humana
 * en el origen. Si igual llega un UUID, se reemplaza por lenguaje neutro que
 * siga leyéndose bien ("para el legajo correspondiente", "duplicado de otro
 * registro"), nunca por un placeholder ("legajo —").
 */
export function maskTechnicalIds(text: string) {
  return text
    .replace(new RegExp(`/${UUID}`, "gi"), "/:id")
    .replace(new RegExp(`=${UUID}`, "gi"), "=:id")
    .replace(new RegExp(`\\b(de|a|para|por|en|con)\\s+${UUID}`, "gi"), "$1 otro registro")
    .replace(new RegExp(`\\b(del|al)\\s+${UUID}`, "gi"), "$1 registro correspondiente")
    .replace(new RegExp(`(\\p{L}+)\\s+${UUID}`, "giu"), "$1 correspondiente")
    .replace(new RegExp(UUID, "gi"), "registro correspondiente");
}

/** "/api/employees/<uuid>/overview?x=<uuid>" -> "/api/employees/:id/overview?x=:id" */
export function describeRequestPath(url: string) {
  return maskTechnicalIds(url);
}
