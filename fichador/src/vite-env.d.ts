/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Versión informativa que el panel de RRHH ve por dispositivo; nunca autentica. */
  readonly VITE_APP_VERSION?: string;
}
