import { registerSW } from "virtual:pwa-register";
import { kioskActivity } from "./kioskActivity";
import { createKioskUpdater } from "./kioskUpdates";

// Una vez por hora el kiosco pregunta si hay versión nueva; si la hay, la
// aplica (skipWaiting + recarga) en cuanto esté ocioso.
const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      updater.notifyUpdateReady();
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration) window.setInterval(() => void registration.update(), UPDATE_CHECK_EVERY_MS);
    },
  });
  const updater = createKioskUpdater({
    isIdle: kioskActivity.isIdle,
    applyUpdate: () => void updateServiceWorker(true),
  });
}
