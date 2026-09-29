/**
 * Convierte CORS_ORIGIN ("a,b,c") en la allowlist exacta que recibe `cors`.
 *
 * El header `Origin` que manda el navegador nunca trae path ni barra final
 * (`https://host`, no `https://host/`), y `cors` compara por igualdad
 * estricta. Una barra final pegada desde la barra de direcciones (caso real
 * con la URL de VS Code Dev Tunnels) dejaba el origin afuera de la allowlist
 * sin ningún error visible, así que se normaliza acá. Sigue siendo una lista
 * explícita: no acepta comodines ni cualquier origin.
 */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}
