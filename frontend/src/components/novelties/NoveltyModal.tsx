import { useEffect, useState } from "react";
import { hourConceptApiService } from "../../services/api/hourConceptApiService";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../../services/api/noveltyTypeApiService";
import type { Employee, Novelty } from "../../types";
import type { HourConcept } from "../../types/hourConcept.types";
import type { NoveltyType } from "../../types/noveltyType.types";
import { displayLegajo, fullName } from "../../utils/employee";
import { currentMonthPeriod } from "../../utils/period";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { Field, Select } from "../ui/FormControls";
import { Modal } from "../ui/Modal";
import { EmployeeRemoteSelector } from "../employees/EmployeeRemoteSelector";

export function NoveltyModal({
  employees,
  close,
  saved,
}: {
  employees: Employee[];
  close: () => void;
  saved: (items: Novelty[]) => void;
}) {
  const [activeTypes, setActiveTypes] = useState<NoveltyType[]>([]);
  const [hourConcepts, setHourConcepts] = useState<HourConcept[]>([]);
  const defaultPeriod = currentMonthPeriod();
  const defaultDate = `${defaultPeriod}-01`;

  const [selectedEmployees, setSelectedEmployees] = useState<Employee[]>(employees);
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [hours, setHours] = useState("1");
  const [targetHour, setTargetHour] = useState("Hora normal");
  const [fileName, setFileName] = useState("");
  const [docNotes, setDocNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([noveltyTypeApiService.getAll(), hourConceptApiService.getAll()])
      .then(([types, concepts]) => {
        if (!mounted) return;
        const active = types.filter((item) => item.status === "ACTIVO");
        setActiveTypes(active);
        setHourConcepts(concepts.filter((item) => item.status === "ACTIVO"));
        if (!active.some((item) => item.id === typeId)) setTypeId(active[0]?.id || "");
      })
      .catch(() => {
        if (!mounted) return;
        setActiveTypes([]);
        setHourConcepts([]);
        setError("No se pudieron cargar tipos de novedades desde backend.");
      });
    return () => {
      mounted = false;
    };
  }, []);

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
  const requiresTargetHour = Boolean(
    selectedType?.rules.allowsHours ||
      selectedType?.rules.timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS",
  );

  const dateRange = () => {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(
      `${selectedType?.rules.allowsDateTo ? to : from}T00:00:00`,
    );
    const days: number[] = [];
    for (
      const current = new Date(start);
      current <= end;
      current.setDate(current.getDate() + 1)
    ) {
      if (current.getMonth() === start.getMonth()) days.push(current.getDate());
    }
    return days;
  };

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!selectedType) return;
    if (!employeeIds.length) return setError("Selecciona al menos un legajo.");
    if (requiresTargetHour && !normalizedTargetHour) {
      return setError("Selecciona sobre que tipo de hora aplica esta novedad.");
    }
    if (selectedType.rules.requiresDocumentation && !fileName) {
      return setError("Adjunta la documentacion requerida para guardar esta novedad.");
    }
    if (selectedType.rules.hasValidity && selectedType.rules.allowsDateTo && to < from) {
      return setError("La fecha hasta no puede ser anterior a la fecha desde.");
    }

    const hoursImpact = selectedType.rules.allowsHours ? Number(hours) || 0 : 0;
    const targetConcept = hourConcepts.find((concept) => concept.name === normalizedTargetHour);

    try {
      const created = await noveltyApiService.create({
        employeeIds,
        noveltyTypeId: selectedType.id,
        fromDate: from,
        toDate: selectedType.rules.allowsDateTo ? to : null,
        quantityHours: selectedType.rules.allowsHours ? hoursImpact : null,
        quantityDays: selectedType.rules.allowsHours ? null : Math.max(1, dateRange().length),
        observation: docNotes || null,
        targetHourConceptId: requiresTargetHour ? targetConcept?.id || null : null,
      });
      saved(created);
      return;
    } catch (apiError) {
      if (String((apiError as Error)?.message || "").includes("uuid")) {
        return setError("Para guardar en backend, los legajos y tipos de novedad deben venir desde la base real.");
      }
      return setError("No se pudo guardar la novedad en backend. Revisa los datos e intenta nuevamente.");
    }

  });

  return (
    <Modal title="Nueva novedad" close={close}>
      <div className="form-stack">
        {activeTypes.length ? (
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
                  <span>Origen: {selectedType.origin}</span>
                  <span>Horas: {selectedType.rules.timeImpact}</span>
                  <span>
                    {selectedType.rules.blocksTimeEntry
                      ? "Bloquea carga diaria"
                      : "Convive con horas"}
                  </span>
                  <span>Finnegans: {activeLink?.code || "No exporta"}</span>
                </div>
              </div>
            ) : null}

            <div className="form-grid">
              <Field label="Desde" type="date" value={from} set={setFrom} />
              {selectedType?.rules.allowsDateTo ? (
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
            ) : null}

            {error ? <p className="error">{error}</p> : null}

            <div className="form-actions">
              <button className="button subtle" onClick={close}>
                Cancelar
              </button>
              <button className="button primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar novedad"}
              </button>
            </div>
          </>
        ) : (
          <div className="empty">
            No hay tipos de novedades activos. Cargalos desde Configuracion &gt;
            Tipos de novedades.
          </div>
        )}
      </div>
    </Modal>
  );
}
