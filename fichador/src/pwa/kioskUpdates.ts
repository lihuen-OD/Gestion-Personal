// F3: un kiosco no tiene a quién preguntarle "¿actualizar?". Cuando el
// service worker avisa que hay una versión nueva, se aplica sola en el
// primer momento en que el fichador está ocioso.
export type KioskUpdater = {
  /** El service worker tiene una versión nueva esperando. */
  notifyUpdateReady: () => void;
  stop: () => void;
};

export function createKioskUpdater({
  isIdle,
  applyUpdate,
  checkEveryMs = 15_000,
  setTimer = (callback: () => void, ms: number) => window.setInterval(callback, ms),
  clearTimer = (id: number) => window.clearInterval(id),
}: {
  isIdle: () => boolean;
  applyUpdate: () => void;
  checkEveryMs?: number;
  setTimer?: (callback: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}): KioskUpdater {
  let timer: number | undefined;
  let applied = false;

  const tryApply = () => {
    if (applied || !isIdle()) return;
    applied = true;
    if (timer !== undefined) clearTimer(timer);
    applyUpdate();
  };

  return {
    notifyUpdateReady() {
      if (applied || timer !== undefined) return;
      tryApply();
      if (!applied) timer = setTimer(tryApply, checkEveryMs);
    },
    stop() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
  };
}
