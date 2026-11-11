/**
 * Modo de bajo consumo del fichador («Biometric Future»). Sólo presentación:
 * con "low" se apagan las capas ambientales animadas, los desenfoques, los
 * brillos y los bucles decorativos (ver `:root[data-power="low"]` en las hojas).
 * No cambia la cámara, el detector ni ninguna regla de la fichada.
 *
 * Orden de decisión:
 * 1. `?consumo=bajo` o `?consumo=normal` en la URL: se aplica y se recuerda en
 *    este equipo (para dejar un kiosco configurado una sola vez).
 * 2. Lo recordado en el equipo.
 * 3. Automático: equipos modestos (≤ 2 GB de memoria declarada o ≤ 2 núcleos)
 *    arrancan en bajo consumo.
 */
export type PowerMode = "low" | "normal";

export const POWER_MODE_STORAGE_KEY = "fichador.consumo";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type HardwareHints = { deviceMemory?: number; hardwareConcurrency?: number };

function parse(value: string | null | undefined): PowerMode | null {
  if (value === "bajo" || value === "low") return "low";
  if (value === "normal") return "normal";
  return null;
}

export function resolvePowerMode(search: string, storage: StorageLike | null, hints: HardwareHints): PowerMode {
  const requested = parse(new URLSearchParams(search).get("consumo"));
  if (requested) {
    try {
      storage?.setItem(POWER_MODE_STORAGE_KEY, requested);
    } catch {
      // Almacenamiento no disponible (modo privado): vale sólo para esta carga.
    }
    return requested;
  }
  let stored: PowerMode | null = null;
  try {
    stored = parse(storage?.getItem(POWER_MODE_STORAGE_KEY));
  } catch {
    stored = null;
  }
  if (stored) return stored;
  const modestMemory = typeof hints.deviceMemory === "number" && hints.deviceMemory <= 2;
  const modestCpu = typeof hints.hardwareConcurrency === "number" && hints.hardwareConcurrency > 0 && hints.hardwareConcurrency <= 2;
  return modestMemory || modestCpu ? "low" : "normal";
}

/** Marca `<html data-power>` al arrancar. */
export function applyPowerMode(doc: Document = document, win: Window = window) {
  let storage: StorageLike | null = null;
  try {
    storage = win.localStorage;
  } catch {
    storage = null;
  }
  const nav = win.navigator as Navigator & { deviceMemory?: number };
  const mode = resolvePowerMode(win.location.search, storage, { deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency });
  doc.documentElement.dataset.power = mode;
  return mode;
}
