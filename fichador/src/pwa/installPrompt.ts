import { useEffect, useState } from "react";

// F10: en navegadores con aviso de instalación propio (Chromium), el evento
// llega una sola vez y temprano. Se guarda para ofrecer "Instalar en este
// equipo" desde la guía de puesta en marcha. iOS no lo tiene: ahí la guía
// explica "Agregar a pantalla de inicio" (pwa/platform.ts).
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Se llama una vez al arrancar (main.tsx), antes de que el navegador dispare el evento. */
export function startInstallPromptCapture(target: Window = window) {
  target.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  target.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export function useInstallPrompt() {
  const [available, setAvailable] = useState(deferred !== null);
  useEffect(() => {
    const update = () => setAvailable(deferred !== null);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  const prompt = async () => {
    const event = deferred;
    if (!event) return;
    // El evento sirve una sola vez.
    deferred = null;
    notify();
    await event.prompt();
  };
  return { available, prompt };
}
