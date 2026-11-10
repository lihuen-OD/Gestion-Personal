import { useEffect, useState } from "react";

/**
 * Conexión del equipo según el navegador (sólo para mostrarla). No decide si
 * se puede fichar: eso sigue en TimeClockPage, que vuelve a mirar
 * navigator.onLine al iniciar y al confirmar cada fichada.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
