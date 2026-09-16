import { useEffect, useState } from "react";
import { ApiError } from "../../services/api/apiClient";
import { hourConceptApiService } from "../../services/api/hourConceptApiService";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../../services/api/noveltyTypeApiService";
import { useAuth } from "../../context/AuthContext";
import type { Employee, Novelty } from "../../types";
import type { HourConcept } from "../../types/hourConcept.types";
import type { NoveltyType } from "../../types/noveltyType.types";
import { displayLegajo, fullName } from "../../utils/employee";
import { calendarDaysInclusive } from "../../utils/noveltyDateRange";
import { currentMonthPeriod } from "../../utils/period";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { Field, Select } from "../ui/FormControls";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { EmployeeRemoteSelector } from "../employees/EmployeeRemoteSelector";
import { noveltyTimeEntryBehaviorLabel } from "../novelty-types/NoveltyTypeFields";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";

// Etapa 15L.2B.1 (corrección puntual, docs/decisions/
// NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): qué cantidad se puede cargar
// es una decisión OPERATIVA de la novedad (allowsHours) -- nunca depende
// de finnegansValueUnit, que sólo describe cómo Finnegans va a interpretar
// esa cantidad al exportar (un tema del exportador, no de esta carga). La
// versión anterior de esta etapa decidía qué enviar mirando
// finnegansValueUnit, lo que descartaba en silencio una cantidad de horas
// que el usuario sí veía y completaba en pantalla (allowsHours=true) sólo
// porque el tipo exportaba como DAYS/UNIT. No modifica TimeEntry en ningún
// caso -- quantityHours/quantityDays son sólo metadato de la novedad.
//
// Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md): ya no
// manda ningún `quantityDays` calculado -- el backend es la única
// autoridad (`novelties.service.ts::resolveQuantities`) y recalcula ese
// valor sobre el rango real completo, sin importar lo que llegue acá. La
// previsualización en pantalla ("Cantidad de días: N") usa
// `calendarDaysInclusive` sólo para mostrarle algo a RRHH antes de guardar.
function resolveNoveltyQuantities(allowsHours: boolean, hoursImpact: number) {
  if (allowsHours) return { quantityHours: hoursImpact, quantityDays: null };
  return { quantityHours: null, quantityDays: null };
}

export function NoveltyModal({
  employees,
  close,
  saved,
  initialFromDate,
  initialQuantityHours,
  initialObservation,
  suggestedNoveltyTypeCode,
  contextNote,
}: {
  employees: Employee[];
  close: () => void;
  saved: (items: Novelty[]) => void;
  // Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): precarga
  // opcional al abrir el modal desde una alerta de fichador/turnos. Todo
  // sigue siendo editable por el usuario antes de guardar — nada de esto
  // se envía "a ciegas" ni bypassea el flujo normal de creación.
  initialFromDate?: string;
  initialQuantityHours?: number;
  initialObservation?: string;
  suggestedNoveltyTypeCode?: string;
  contextNote?: string;
}) {
  const { user } = useAuth();
  const [allActiveTypes, setAllActiveTypes] = useState<NoveltyType[]>([]);
  const [hourConcepts, setHourConcepts] = useState<HourConcept[]>([]);
  const defaultPeriod = currentMonthPeriod();
  const defaultDate = initialFromDate || `${defaultPeriod}-01`;

  // Etapa 15L.2B, punto 25: RRHH mantiene autoridad global (mismo criterio
  // que el backend, assertCanLoad); el resto sólo ve los tipos que el
  // backend le va a aceptar -- evita mostrar una opción que después se
  // rechaza con 403 NOVELTY_LOAD_FORBIDDEN.
  const isRrhh = user?.role === "Nivel 1 - RRHH";
  const activeTypes = isRrhh ? allActiveTypes : allActiveTypes.filter((item) => item.allowedLoadRoles.includes(user!.role));

  const [selectedEmployees, setSelectedEmployees] = useState<Employee[]>(employees);
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [hours, setHours] = useState(initialQuantityHours != null ? String(initialQuantityHours) : "1");
  const [targetHour, setTargetHour] = useState("Hora normal");
  const [fileName, setFileName] = useState("");
  const [docNotes, setDocNotes] = useState(initialObservation || "");
  const [error, setError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "success" | "error">("loading");
  const [catalogRetry, setCatalogRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    setCatalogStatus("loading");
    Promise.all([noveltyTypeApiService.getAll(), hourConceptApiService.getAll()])
      .then(([types, concepts]) => {
        if (!mounted) return;
        const active = types.filter((item) => item.status === "ACTIVO");
        setAllActiveTypes(active);
        setHourConcepts(concepts.filter((item) => item.status === "ACTIVO"));
        const loadable = isRrhh ? active : active.filter((item) => item.allowedLoadRoles.includes(user!.role));
        if (!loadable.some((item) => item.id === typeId)) {
          // El tipo sugerido por una alerta gana si existe, está activo y
          // el usuario puede cargarlo; si no (código inexistente, tipo
          // dado de baja, fuera de sus roles, o no vino ninguno), cae al
          // primer tipo cargable -- mismo comportamiento de siempre, sin
          // romper la carga manual.
          const suggested = suggestedNoveltyTypeCode
            ? loadable.find((item) => item.code === suggestedNoveltyTypeCode)
            : undefined;
          setTypeId(suggested?.id || loadable[0]?.id || "");
        }
        setCatalogStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setAllActiveTypes([]);
        setHourConcepts([]);
        setCatalogStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [catalogRetry]);

  const selectedType = activeTypes.find((item) => item.id === typeId);
  const activeLink = selectedType?.finnegansLinks.find((link) => link.status === "ACTIVO");
  const employeeIds = selectedEmployees.map((employee) => employee.id);
  const targetHourOptions = Array.from(
    new Set(
      selectedEmployees.flatMap((employee) => [
        "Hora normal",
        ...(employee.enabledHours || []),
      ]),
    ),
  ).filter(Boolean);
  const normalizedTargetHour = targetHourOptions.includes(targetHour)
    ? targetHour
    : targetHourOptions[0] || "Hora normal";
  // Etapa 15L.2C: timeImpact==="REGISTRA_HORAS_NO_TRABAJADAS" se mantiene
  // -- sin equivalente en el enum nuevo de 2 valores (timeEntryBehavior:
  // NO_BLOQUEA/BLOQUEA_NUEVA_CARGA), migrarlo perdería esta distinción
  // (docs/decisions/NOVELTY_TYPE_CONSUMER_MIGRATION_15L2C.md).
  const requiresTargetHour = Boolean(
    selectedType?.rules.allowsHours ||
      selectedType?.rules.timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS",
  );

  // Etapa 15L.5: sólo previsualización -- el backend recalcula quantityDays
  // sobre el rango real completo al crear la novedad (ver
  // resolveNoveltyQuantities más abajo, que ya no manda ningún valor).
  const previewDays = selectedType && !selectedType.rules.allowsHours
    ? calendarDaysInclusive(from, selectedType.rules.allowsDateRange ? to : from)
    : null;

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!selectedType) return;
    if (!employeeIds.length) return setError("Selecciona al menos un legajo.");
    if (requiresTargetHour && !normalizedTargetHour) {
      return setError("Selecciona sobre que tipo de hora aplica esta novedad.");
    }
    if (selectedType.rules.requiresDocumentation && !fileName) {
      return setError("Adjunta la documentacion requerida para guardar esta novedad.");
    }
    if (selectedType.rules.finnegansRequiresValidity && selectedType.rules.allowsDateRange && to < from) {
      return setError("La fecha hasta no puede ser anterior a la fecha desde.");
    }

    const hoursImpact = selectedType.rules.allowsHours ? Number(hours) || 0 : 0;
    const targetConcept = hourConcepts.find((concept) => concept.name === normalizedTargetHour);
    // Etapa 15L.2B.1: allowsHours decide qué cantidad se envía -- decisión
    // operativa de la novedad, independiente de finnegansValueUnit (que
    // sólo interpreta esa cantidad para Finnegans, sin decidir si existe).
    // Etapa 15L.5: quantityDays ya no se calcula acá -- el backend es la
    // única autoridad (ver resolveNoveltyQuantities arriba).
    const quantities = resolveNoveltyQuantities(selectedType.rules.allowsHours, hoursImpact);

    try {
      const created = await noveltyApiService.create({
        employeeIds,
        noveltyTypeId: selectedType.id,
        fromDate: from,
        toDate: selectedType.rules.allowsDateRange ? to : null,
        ...quantities,
        observation: docNotes || null,
        targetHourConceptId: requiresTargetHour ? targetConcept?.id || null : null,
      });
      saved(created);
      return;
    } catch (apiError) {
      // Etapa 15G.3 (docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md):
      // el backend ya arma un mensaje humano y específico (tipo + legajo,
      // sin ids técnicos) para estos dos códigos -- se muestra tal cual en
      // vez del genérico de abajo. No se reimplementa la regla de
      // duplicado/solapamiento acá: sólo se refleja lo que el backend ya
      // decidió.
      if (apiError instanceof ApiError && (apiError.code === "NOVELTY_DUPLICATE" || apiError.code === "NOVELTY_OVERLAP")) {
        return setError(apiError.message);
      }
      if (String((apiError as Error)?.message || "").includes("uuid")) {
        return setError("El legajo o el tipo de novedad seleccionado no es válido. Volvé a seleccionarlo.");
      }
      return setError("No pudimos guardar la novedad. Revisá los datos e intentá nuevamente.");
    }

  });

  return (
    <Modal title="Nueva novedad" close={close}>
      <div className="form-stack">
        {contextNote ? <div className="info-note compact">{contextNote}</div> : null}
        {catalogStatus === "loading" ? (
          <LoadingState text="Cargando tipos de novedades..." />
        ) : catalogStatus === "error" ? (
          <ErrorState message="No pudimos cargar los tipos de novedades." onRetry={() => setCatalogRetry((value) => value + 1)} />
        ) : activeTypes.length ? (
          <>
            <label>
              Tipo de novedad
              <select
                value={typeId}
                onChange={(event) => {
                  setTypeId(event.target.value);
                  setFileName("");
                  setDocNotes("");
                  setError("");
                }}
              >
                {activeTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="document-upload-card">
              <b>Legajos alcanzados</b>
              <p>
                Podes cargar la misma novedad para una o varias personas. Se genera
                un registro individual por legajo.
              </p>
              {employees.length === 1 ? (
                <div className="selected-people"><span>{displayLegajo(employees[0])} · {fullName(employees[0])}</span></div>
              ) : (
                <EmployeeRemoteSelector selected={selectedEmployees} multiple onChange={setSelectedEmployees} />
              )}
            </div>

            {selectedType ? (
              <div className="novelty-impact-card">
                <b>{selectedType.name}</b>
                <p>{selectedType.description}</p>
                <div>
                  <span>{noveltyTimeEntryBehaviorLabel(selectedType.rules.timeEntryBehavior)}</span>
                  <span>Finnegans: {selectedType.rules.exportsToFinnegans ? (activeLink?.code || "Configuración pendiente") : "No exporta"}</span>
                </div>
              </div>
            ) : null}

            <div className="form-grid">
              <Field label="Desde" type="date" value={from} set={setFrom} />
              {selectedType?.rules.allowsDateRange ? (
                <Field label="Hasta" type="date" value={to} set={setTo} />
              ) : null}
              {selectedType?.rules.allowsHours ? (
                <Field
                  label="Cantidad de horas"
                  type="number"
                  value={hours}
                  set={setHours}
                />
              ) : null}
              {requiresTargetHour ? (
                <Select
                  label="Aplica sobre hora"
                  value={normalizedTargetHour}
                  set={setTargetHour}
                  options={targetHourOptions.length ? targetHourOptions : ["Hora normal"]}
                />
              ) : null}
            </div>

            {previewDays !== null ? (
              // Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md
              // §8): sólo previsualización -- el backend calcula el valor
              // definitivo al guardar, sobre el rango real completo.
              <p className="table-sub">Cantidad de días: {previewDays}</p>
            ) : null}

            {selectedType?.rules.requiresDocumentation ? (
              <div className="document-upload-card">
                <b>Documentacion requerida</b>
                <p>
                  Adjunta el comprobante, certificado o archivo respaldatorio de
                  esta novedad.
                </p>
                <label>
                  Adjuntar documento
                  <input
                    type="file"
                    onChange={(event) =>
                      setFileName(event.target.files?.[0]?.name || "")
                    }
                  />
                </label>
                {fileName ? <small>Archivo seleccionado: {fileName}</small> : null}
                <label>
                  Observacion documental
                  <textarea
                    value={docNotes}
                    onChange={(event) => setDocNotes(event.target.value)}
                    placeholder="Detalle opcional del documento adjunto"
                  />
                </label>
              </div>
            ) : contextNote ? (
              // Etapa 15G.2: si el tipo no exige documentación, el campo de
              // arriba no se renderiza -- pero cuando el modal viene
              // precargado desde una alerta, la observación sugerida
              // (contexto de la alerta) igual se envía en el payload. Sin
              // este campo, quedaría invisible: el usuario no podría
              // revisarla ni corregirla antes de guardar.
              <label>
                Observación
                <textarea
                  value={docNotes}
                  onChange={(event) => setDocNotes(event.target.value)}
                  placeholder="Detalle de la novedad"
                />
              </label>
            ) : null}

            {error ? <p className="error">{error}</p> : null}

            <div className="form-actions">
              <Button variant="subtle" onClick={close}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar novedad"}
              </Button>
            </div>
          </>
        ) : (
          <div className="empty">
            {allActiveTypes.length
              ? "Tu rol no tiene tipos de novedad habilitados para cargar."
              : <>No hay tipos de novedades activos. Cargalos desde Configuracion &gt; Tipos de novedades.</>}
          </div>
        )}
      </div>
    </Modal>
  );
}
