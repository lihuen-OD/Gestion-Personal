import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./context/AuthContext";
import { demoMode } from "./config/runtimeMode";
import { cleanupLegacyDemoStorage } from "./services/legacyDemoStorage";
import { ApiErrorNotice } from "./components/ui/ApiErrorNotice";
import { AppDialogHost } from "./components/ui/AppDialogHost";
import "./styles.css";

if (!demoMode) cleanupLegacyDemoStorage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ApiErrorNotice />
        <AppDialogHost />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
