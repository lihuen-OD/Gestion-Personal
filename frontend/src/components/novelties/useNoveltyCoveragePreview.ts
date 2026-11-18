import { useEffect, useState } from "react";
import { ApiError } from "../../services/api/apiClient";
import { noveltyApiService, type NoveltyCoveragePreview, type NoveltyCoveragePreviewInput } from "../../services/api/noveltyApiService";
import { useDebouncedValue } from "../../utils/useDebouncedValue";

export type NoveltyCoveragePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: NoveltyCoveragePreview }
  | { status: "error"; message: string; detail: string | null };

const PREVIEW_ERROR = "No pudimos calcular la vista previa. Intentá nuevamente.";

/**
 * Etapa 8: vista previa de cobertura con debounce. Sólo pide cuando hay datos
 * suficientes (input no nulo); cancela el pedido anterior al cambiar algo y
 * nunca muestra una respuesta vieja. Un error no bloquea el guardado: el alta
 * sigue siendo la fuente definitiva.
 */
export function useNoveltyCoveragePreview(input: NoveltyCoveragePreviewInput | null, delayMs = 400) {
  const key = input ? JSON.stringify(input) : "";
  const debouncedKey = useDebouncedValue(key, delayMs);
  const [result, setResult] = useState<{ key: string; state: NoveltyCoveragePreviewState }>({ key: "", state: { status: "idle" } });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!debouncedKey) return;
    const controller = new AbortController();
    setResult({ key: debouncedKey, state: { status: "loading" } });
    noveltyApiService.previewCoverage(JSON.parse(debouncedKey) as NoveltyCoveragePreviewInput, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: debouncedKey, state: { status: "success", data } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Un rechazo de negocio (rango demasiado largo, historia laboral faltante) se explica; el resto, genérico.
        const detail = error instanceof ApiError && error.status >= 400 && error.status < 500 && !error.message.startsWith("No pudimos completar") ? error.message : null;
        setResult({ key: debouncedKey, state: { status: "error", message: PREVIEW_ERROR, detail } });
      });
    return () => controller.abort();
  }, [debouncedKey, retry]);

  // Mientras el pedido vigente no corresponde a los datos actuales, se muestra "calculando".
  const state: NoveltyCoveragePreviewState = !key ? { status: "idle" } : result.key === key ? result.state : { status: "loading" };
  return { state, retry: () => setRetry((value) => value + 1) };
}
