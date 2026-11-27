import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getUserErrorMessage } from "../../services/api/apiClient";
import { hourConceptApiService } from "../../services/api/hourConceptApiService";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../../services/api/noveltyTypeApiService";
import { useAuth } from "../../context/AuthContext";
import type { Employee, Novelty } from "../../types";
import type { HourConcept } from "../../types/hourConcept.types";
import type { NoveltyType } from "../../types/noveltyType.types";
import { displayLegajo, fullName } from "../../utils/employee";
import {
  adaptNoveltyLoadValues,
  buildNoveltyCreateInput,
  buildNoveltyPreviewInput,
  initialNoveltyLoadValues,
  MAX_EMPLOYEES_WITH_DOCUMENT,
  noveltyLoadIssues,
  noveltyLoadLayout,
  type NoveltyLoadValues,
} from "../../utils/noveltyLoad";
import { currentMonthPeriod } from "../../utils/period";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { EmployeeRemoteSelector } from "../employees/EmployeeRemoteSelector";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { NoveltyCoveragePreviewPanel } from "./NoveltyCoveragePreviewPanel";
import { NoveltyLoadFields, NoveltyTypeLoadSummary } from "./NoveltyLoadFields";
import { useNoveltyCoveragePreview } from "./useNoveltyCoveragePreview";

// Etapa 8 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §15): alta de una
// novedad guiada por su Tipo, con vista previa de la cobertura calculada por
// el backend. Las cantidades que se envían están documentadas en
// utils/noveltyLoad.ts. Etapa 15L.5: quantityDays lo calcula sólo el backend.

const PERIOD_CLOSED_MESSAGE = "No se puede cargar esta novedad porque el período está cerrado. Reabrilo desde Cierres mensuales para modificarlo.";

function saveErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "PERIOD_CLOSED") return PERIOD_CLOSED_MESSAGE;
  // Duplicado/solapamiento y el resto de los rechazos de negocio llegan ya en
  // lenguaje de negocio (apiClient filtra códigos y textos técnicos).
  return getUserErrorMessage(error, "No pudimos guardar la novedad. Revisá los datos e intentá nuevamente.");
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
  // opcional al abrir el modal desde una alerta. Todo sigue siendo editable.
  initialFromDate?: string;
  initialQuantityHours?: number;
  initialObservation?: string;
  suggestedNoveltyTypeCode?: string;
  contextNote?: string;
}) {
  const { user } = useAuth();
  const [allActiveTypes, setAllActiveTypes] = useState<NoveltyType[]>([]);
  const [hourConcepts, setHourConcepts] = useState<HourConcept[]>([]);
  const defaultDate = initialFromDate || `${currentMonthPeriod()}-01`;

  // Etapa 15L.2B, punto 25: RRHH mantiene autoridad global (mismo criterio
  // que el backend, assertCanLoad); el resto sólo ve los tipos que puede cargar.
  const isRrhh = user?.role === "Nivel 1 - RRHH";
  const activeTypes = isRrhh ? allActiveTypes : allActiveTypes.filter((item) => item.allowedLoadRoles.includes(user!.role));

  const [selectedEmployees, setSelectedEmployees] = useState<Employee[]>(employees);
  const [typeId, setTypeId] = useState("");
  const [values, setValues] = useState<NoveltyLoadValues>(() => initialNoveltyLoadValues(undefined, { fromDate: defaultDate, observation: initialObservation }));
  const [targetHour, setTargetHour] = useState("Hora normal");
  const [showIssues, setShowIssues] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "success" | "error">("loading");
  const [catalogRetry, setCatalogRetry] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

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
          // El tipo sugerido por una alerta gana si existe, está activo y el
          // usuario puede cargarlo; si no, el primer tipo cargable.
          const suggested = suggestedNoveltyTypeCode ? loadable.find((item) => item.code === suggestedNoveltyTypeCode) : undefined;
          const initial = suggested || loadable[0];
          setTypeId(initial?.id || "");
          if (initial) setValues(initialNoveltyLoadValues(initial, { fromDate: defaultDate, quantityHours: initialQuantityHours, observation: initialObservation }));
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
  const layout = selectedType ? noveltyLoadLayout(selectedType) : null;
  const employeeIds = selectedEmployees.map((employee) => employee.id);
  const issues = noveltyLoadIssues(selectedType, values, employeeIds.length);
  const previewInput = useMemo(() => buildNoveltyPreviewInput(selectedType, values, employeeIds), [selectedType, values, employeeIds.join(",")]);
  const preview = useNoveltyCoveragePreview(previewInput);

  // Etapa 15L.2B.1: "Aplica sobre hora" sigue atado a la carga de horas del tipo (allowsHours).
  const requiresTargetHour = Boolean(selectedType?.rules.allowsHours);
  const targetHourOptions = Array.from(new Set(selectedEmployees.flatMap((employee) => ["Hora normal", ...(employee.enabledHours || [])]))).filter(Boolean);
  const normalizedTargetHour = targetHourOptions.includes(targetHour) ? targetHour : targetHourOptions[0] || "Hora normal";

  useEffect(() => {
    if (!focusRequest) return;
    const invalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]");
    invalid?.focus();
  }, [focusRequest]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!selectedType) return;
    if (issues.length) {
      setError("Faltan datos para guardar. Revisá los campos marcados.");
      setShowIssues(true);
      return setFocusRequest((value) => value + 1);
    }
    setError("");
    const targetConcept = hourConcepts.find((concept) => concept.name === normalizedTargetHour);
    let created: Novelty[];
    const input = buildNoveltyCreateInput(selectedType, values, employeeIds, {
      targetHourConceptId: requiresTargetHour ? targetConcept?.id || null : null,
    });
    try {
      // Con documento, un único pedido: si el archivo no se guarda, la novedad
      // tampoco (el backend compensa). Reintentar no duplica nada.
      created = values.file
        ? await noveltyApiService.createWithDocument(input, values.file, values.observation.trim() || null)
        : await noveltyApiService.create(input);
    } catch (apiError) {
      return setError(saveErrorMessage(apiError));
    }
    saved(created);
  });

  const formIssues = showIssues ? issues : undefined;
  const employeesIssue = issues.find((issue) => issue.field === "employees")?.message;
  const missingHint = layout?.quantity === "MANUAL" ? "Completá la fecha y la duración para ver cómo quedará la novedad." : "Completá la persona y la fecha para ver cómo quedará la novedad.";

  return (
    <Modal title="Nueva novedad" close={close} size="wide">
      <div className="novelty-load" ref={formRef}>
        {contextNote ? <div className="info-note compact">{contextNote}</div> : null}
        {catalogStatus === "loading" ? (
          <LoadingState text="Cargando tipos de novedades..." />
        ) : catalogStatus === "error" ? (
          <ErrorState message="No pudimos cargar los tipos de novedades." onRetry={() => setCatalogRetry((value) => value + 1)} />
        ) : activeTypes.length ? (
          <div className="novelty-load-layout">
            <div className="novelty-load-form">
              <div className="document-upload-card">
                <b>Personas</b>
                <p>Podés cargar la misma novedad para una o varias personas. Se genera un registro por legajo.</p>
                {employees.length === 1 ? (
                  <div className="selected-people"><span>{displayLegajo(employees[0])} · {fullName(employees[0])}</span></div>
                ) : (
                  <EmployeeRemoteSelector selected={selectedEmployees} multiple onChange={setSelectedEmployees} />
                )}
                {layout?.documentationRequired ? (
                  <p className="field-hint">Con documentación, hasta {MAX_EMPLOYEES_WITH_DOCUMENT} personas por vez: se guarda una copia del archivo en el legajo de cada persona.</p>
                ) : null}
                {/* Superar el límite se avisa enseguida, sin esperar a guardar. */}
                {employeesIssue && (showIssues || employeeIds.length > 0) ? <p className="field-error" role="alert">{employeesIssue}</p> : null}
              </div>

              <label>
                Tipo de novedad
                <select
                  value={typeId}
                  onChange={(event) => {
                    const next = activeTypes.find((item) => item.id === event.target.value);
                    setTypeId(event.target.value);
                    if (next) setValues((current) => adaptNoveltyLoadValues(current, next));
                    setError("");
                    setShowIssues(false);
                  }}
                >
                  {activeTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>

              {selectedType ? <NoveltyTypeLoadSummary type={selectedType} /> : null}
              {selectedType ? <NoveltyLoadFields type={selectedType} values={values} onChange={setValues} issues={formIssues} /> : null}

              {requiresTargetHour ? (
                <label>
                  Aplica sobre hora
                  <select value={normalizedTargetHour} onChange={(event) => setTargetHour(event.target.value)}>
                    {(targetHourOptions.length ? targetHourOptions : ["Hora normal"]).map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
              ) : null}

            </div>

            <NoveltyCoveragePreviewPanel state={preview.state} layout={layout} employeeCount={employeeIds.length} missingHint={missingHint} onRetry={preview.retry} />

            <div className="novelty-load-footer">
              {error ? <p className="error" role="alert">{error}</p> : null}
              <div className="form-actions">
                <Button variant="subtle" onClick={close}>Cancelar</Button>
                <Button variant="primary" onClick={save} disabled={isSaving}>
                  {isSaving ? "Guardando..." : "Guardar novedad"}
                </Button>
              </div>
            </div>
          </div>
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
