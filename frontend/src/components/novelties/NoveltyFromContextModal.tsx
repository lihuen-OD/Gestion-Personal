import type { Employee, Novelty } from "../../types";
import type { NoveltyPrefillContext } from "../../utils/noveltyFromAlert";
import { NoveltyModal } from "./NoveltyModal";

/**
 * Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md). Puente entre
 * una alerta de fichador/turnos y `NoveltyModal`.
 *
 * Ajuste (evitar over-fetching): esta versión ya NO llama a
 * `employeeApiService.getById` para resolver el legajo completo antes de
 * montar el modal. `NoveltyModal` sólo lee `id`/`legajo`/`firstName`/
 * `lastName` (vía `displayLegajo`/`fullName`) y `enabledHours` (con
 * fallback a `[]` si falta) del array `employees` cuando ese array tiene
 * exactamente 1 elemento — que es siempre el caso acá — y en ese camino
 * nunca monta `EmployeeRemoteSelector` (el selector múltiple, que sí
 * necesita el `Employee` completo). La alerta/incidente/jornada de origen
 * ya trae id/legajo/nombre/apellido en su propio sub-objeto `employee`
 * (ver `noveltyFromAlert.ts`), así que no hace falta ningún fetch
 * adicional para abrir el modal.
 *
 * `context.employee` es deliberadamente un subconjunto de `Employee` (le
 * faltan ~45 campos administrativos que este camino nunca lee) — el cast
 * de abajo es acotado a este flujo puntual. Si `NoveltyModal` alguna vez
 * necesitara leer otro campo de `Employee`, o si este componente pasara a
 * recibir más de un empleado (dispararía `EmployeeRemoteSelector`, que sí
 * exige el tipo completo), hay que revisar este adaptador — y ahí sí
 * volver a resolver el legajo completo por red.
 */
export function NoveltyFromContextModal({
  context,
  close,
  saved,
}: {
  context: NoveltyPrefillContext;
  close: () => void;
  saved: (items: Novelty[]) => void;
}) {
  return (
    <NoveltyModal
      employees={[context.employee as Employee]}
      close={close}
      saved={saved}
      initialFromDate={context.fromDate}
      initialQuantityHours={context.quantityHours}
      initialObservation={context.observation}
      suggestedNoveltyTypeCode={context.suggestedNoveltyTypeCode}
      contextNote="Se precargaron los datos detectados por la alerta. Revisá el tipo y la observación antes de guardar. RRHH aprueba o rechaza esta novedad como cualquier otra."
    />
  );
}
