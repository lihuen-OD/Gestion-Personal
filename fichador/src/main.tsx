import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import { startInstallPromptCapture } from "./pwa/installPrompt";
import { applyPowerMode } from "./utils/powerMode";
// «Biometric Future»: 300 sólo para el reloj y la hora de la confirmación.
import "@fontsource/inter/latin-300.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles/index.css";

// F10: el aviso de instalación del navegador llega una sola vez y temprano;
// se guarda antes de renderizar para ofrecerlo en la guía de puesta en marcha.
startInstallPromptCapture();

// Bajo consumo (sólo presentación): antes del primer render, sin parpadeo.
applyPowerMode();

// Sin AuthProvider, sin router y sin providers administrativos: el fichador
// no tiene sesión de usuario (ver services/api/apiClient.ts).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// F3: service worker (precache del shell + MediaPipe). Sólo existe en el
// build; en `npm run dev` el registro no hace nada.
registerServiceWorker();
