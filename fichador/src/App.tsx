import { TimeClockPage } from "./pages/TimeClockPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// El fichador standalone tiene una sola pantalla. No hay router ni rutas
// administrativas: cualquier otra URL (por ejemplo /legajos, /configuracion,
// /usuarios o /auditoria escritas a mano) muestra el 404 propio, y esas
// páginas ni siquiera existen en el bundle (ver scripts/check-bundle-isolation.mjs).
const KIOSK_PATHS = new Set(["/", "/index.html"]);

export function isKioskPath(pathname: string) {
  return KIOSK_PATHS.has(pathname);
}

export function App({ pathname = window.location.pathname }: { pathname?: string }) {
  return isKioskPath(pathname) ? <TimeClockPage /> : <NotFoundPage />;
}
