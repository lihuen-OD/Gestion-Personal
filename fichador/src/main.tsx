import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import { startInstallPromptCapture } from "./pwa/installPrompt";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-900.css";
import "./styles.css";

// F10: el aviso de instalación del navegador llega una sola vez y temprano;
// se guarda antes de renderizar para ofrecerlo en la guía de puesta en marcha.
startInstallPromptCapture();

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
