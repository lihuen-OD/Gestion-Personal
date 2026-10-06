/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Token compartido TEMPORAL del kiosco; se retira en F4–F6 (ClockDevice). */
  readonly VITE_CLOCK_DEVICE_TOKEN?: string;
}
