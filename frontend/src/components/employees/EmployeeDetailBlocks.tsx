import { lazy, Suspense, useState } from "react";
import { GeoAddressFields } from "../GeoAddressFields";
import { employeeApiService } from "../../services/api/employeeApiService";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { locationService } from "../../services/locationService";
import type { Employee, User } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { Field, Select } from "../ui/FormControls";
import { Modal } from "../ui/Modal";
import { BlockHistoryTimeline } from "./FieldHistoryControls";
import { PeopleMultiSearch } from "./PeopleMultiSearch";
import { useHourOptions, userRoleOptions } from "./options/roleHourOptions";

const LocationMapPicker = lazy(() =>
  import("../LocationMapPicker").then((module) => ({ default: module.LocationMapPicker })),
);

type EmployeeBlockProps = {
  employee: Employee;
  user: User;
  canEdit: boolean;
  onSaved: (employee: Employee) => void;
};

const addressSummary = (employee: Employee) =>
  `${employee.domicilio.calle || "-"} ${employee.domicilio.numero || ""}, ${
    employee.domicilio.localidadNombre || employee.city || "-"
  }, ${employee.domicilio.departamentoNombre || "-"}, ${
    employee.domicilio.provinciaNombre || "-"
  }. CP ${employee.domicilio.codigoPostal || "-"}`;

const transportSummary = (employee: Employee) =>
  employee.transport
    ? `Utiliza transporte · ${employee.transportLocality || employee.city || "-"}${
        employee.transportNotes ? ` · ${employee.transportNotes}` : ""
      }`
    : "No utiliza transporte";

const hoursSummary = (employee: Employee) =>
  employee.enabledHours.length ? employee.enabledHours.join(", ") : "Sin horas especiales";

type EmployeeBlockPersistKind = "general" | "address" | "transport" | "assignments" | "hourConcepts";
type CreateBlockHistoryInput = { employeeId: string; section: string; block: string; blockLabel: string; oldValue: string | null; newValue: string; effectiveFrom: string; reason: string; };

async function recordBlockHistory(
  record: CreateBlockHistoryInput,
  _user: User,
  _auditEntity: string,
) {
  try {
    return await employeeHistoryApiService.createBlockHistory(record as Parameters<typeof employeeHistoryApiService.createBlockHistory>[0]);
  } catch (error) {
    throw error;
  }
}

async function persistEmployeeBlock(
  updated: Employee,
  _user: User,
  onSaved: (employee: Employee) => void,
  kind: EmployeeBlockPersistKind = "general",
) {
  try {
    const saved =
      kind === "address"
        ? await employeeApiService.updateAddress(updated)
        : kind === "transport"
          ? await employeeApiService.updateTransport(updated)
          : kind === "assignments"
            ? await employeeApiService.replaceAssignments(updated)
            : kind === "hourConcepts"
              ? await employeeApiService.replaceHourConcepts(updated)
              : await employeeApiService.update(updated);
    onSaved(saved);
  } catch (error) {
    throw error;
  }
}

function AddressMapCard({
  employee,
  readOnly,
  onChange,
}: {
  employee: Employee;
  readOnly: boolean;
  onChange: (employee: Employee) => void;
}) {
  const localityCenter = employee.domicilio.localidadId
    ? locationService.getLocalityCenter(employee.domicilio.localidadId)
    : undefined;
  return (
    <Suspense fallback={<div className="location-map-card">Cargando mapa...</div>}>
      <LocationMapPicker
        provinceName={employee.domicilio.provinciaNombre}
        departmentName={employee.domicilio.departamentoNombre}
        localityName={employee.domicilio.localidadNombre}
        addressStreet={employee.domicilio.calle}
        addressNumber={employee.domicilio.numero}
        initialCenter={localityCenter ? { ...localityCenter.center, zoom: localityCenter.zoom } : undefined}
        value={employee.domicilio.ubicacionMapa}
        readOnly={readOnly}
        onChange={(ubicacionMapa) =>
          onChange({
            ...employee,
            domicilio: { ...employee.domicilio, ubicacionMapa },
            locationMap: ubicacionMapa,
          })
        }
      />
    </Suspense>
  );
}

export function AddressEditBlock({ employee, user, canEdit, onSaved }: EmployeeBlockProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(employee.domicilio);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const setAddress = (patch: Partial<Employee["domicilio"]>) =>
    setDraft({
      ...draft,
      ...patch,
      ...(patch.ubicacionMapa?.source === "MANUAL"
        ? ({ fuenteGeocoding: "MANUAL_MARKER" } as const)
        : null),
    });

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    const oldValue = addressSummary(employee);
    const updated = {
      ...employee,
      domicilio: draft,
      addressStreet: draft.calle,
      address: draft.calle,
      addressNumber: draft.numero,
      city: draft.localidadNombre,
      department: draft.departamentoNombre,
      province: draft.provinciaNombre,
      zip: draft.codigoPostal,
      locationMap: draft.ubicacionMapa,
    };
    try {
      await persistEmployeeBlock(updated, user, onSaved, "address");
      await recordBlockHistory(
        {
          employeeId: employee.id,
          section: "CONTACTO_DOMICILIO",
          block: "DOMICILIO",
          blockLabel: "Domicilio",
          oldValue,
          newValue: addressSummary(updated),
          effectiveFrom: from,
          reason,
        },
        user,
        `Legajo ${employee.legajoInterno || employee.legajo}`,
      );
    } catch (error) {
      setError(getUserErrorMessage(error, "No pudimos guardar el domicilio. Intentá nuevamente."));
      return;
    }
    setEditing(false);
    setShowHistory(true);
  });

  return (
    <div className="block-card">
      <div className="block-card-head">
        <div>
          <h3>Domicilio actual</h3>
          <p>{addressSummary(employee)}</p>
          <small>
            Ubicación en mapa: {employee.domicilio.ubicacionMapa?.label || "Sin ubicación definida"}
          </small>
        </div>
        <div className="tracked-actions">
          <button className="button subtle" onClick={() => setShowHistory(!showHistory)}>
            Ver historial
          </button>
          {canEdit ? (
            <button
              className="button primary"
              onClick={() => {
                setDraft(employee.domicilio);
                setEditing(true);
              }}
            >
              Modificar domicilio
            </button>
          ) : null}
        </div>
      </div>
      <AddressMapCard employee={employee} readOnly onChange={() => undefined} />
      {showHistory ? (
        <BlockHistoryTimeline
          employeeId={employee.id}
          section="CONTACTO_DOMICILIO"
          block="DOMICILIO"
          empty="Todavía no hay historial de domicilio registrado."
        />
      ) : null}
      {editing ? (
        <Modal title="Modificar domicilio" close={() => setEditing(false)}>
          <div className="address-edit-layout">
            <div className="address-edit-card">
              <div>
                <b>Datos de domicilio</b>
                <span>Completá la dirección en orden para alimentar el mapa y el historial.</span>
              </div>
              <GeoAddressFields value={draft} onChange={setDraft} />
            </div>
            <div className="address-edit-card map-card">
              <div>
                <b>Ubicación en mapa</b>
                <span>Buscá la dirección, abrila en Google Maps si hace falta, o ajustá el marcador manualmente.</span>
              </div>
              <Suspense fallback={<div className="location-map-card">Cargando mapa...</div>}>
                <LocationMapPicker
                  provinceName={draft.provinciaNombre}
                  departmentName={draft.departamentoNombre}
                  localityName={draft.localidadNombre}
                  addressStreet={draft.calle}
                  addressNumber={draft.numero}
                  value={draft.ubicacionMapa}
                  onChange={(ubicacionMapa) => setAddress({ ubicacionMapa })}
                />
              </Suspense>
            </div>
            <div className="address-edit-card change-card">
              <div>
                <b>Datos del cambio</b>
                <span>Estos datos quedan guardados en el historial de domicilio.</span>
              </div>
              <div className="address-change-grid">
                <Field label="Fecha desde" type="date" value={from} set={setFrom} />
                <Field label="Motivo del cambio" value={reason} set={setReason} />
              </div>
              {error ? <p className="error">{error}</p> : null}
            </div>
            <div className="form-actions">
              <button className="button subtle" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button className="button primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar domicilio"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function AssignmentBlock({
  employee,
  user,
  canEdit,
  onSaved,
  kind,
}: EmployeeBlockProps & { kind: "MANAGER" | "TIME" }) {
  const isManager = kind === "MANAGER";
  const block = isManager ? "ENCARGADO_DIRECTO" : "RESPONSABLE_CARGA_HORARIA";
  const title = isManager ? "Encargado directo actual" : "Responsable de carga horaria actual";
  const currentList = isManager
    ? employee.directManagers?.length
      ? employee.directManagers
      : [employee.directManager].filter(Boolean)
    : employee.timeResponsibles?.length
      ? employee.timeResponsibles
      : [employee.timeResponsible].filter(Boolean);
  const role = isManager ? "" : employee.timeResponsibleRole;
  const fromValue = isManager ? employee.directManagerFrom : employee.timeResponsibleFrom;
  const notesValue = isManager ? employee.directManagerNotes : employee.timeResponsibleNotes;
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<string[]>(currentList);
  const [roleDraft, setRole] = useState(role);
  const [from, setFrom] = useState(fromValue || new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(notesValue || "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const summary = (values = currentList) =>
    isManager
      ? `${values.length ? values.join(", ") : "Sin asignar"} · Desde ${fromValue || "Sin cargar"}`
      : `${values.length ? values.join(", ") : "Sin asignar"} · ${role || "Sin rol"} · Desde ${
          fromValue || "Sin cargar"
        }`;

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    const clean = names.filter(Boolean);
    const updated = isManager
      ? {
          ...employee,
          directManagers: clean,
          directManager: clean[0] || "",
          directManagerFrom: from,
          directManagerTo: "",
          directManagerStatus: "",
          directManagerNotes: notes,
        }
      : {
          ...employee,
          timeResponsibles: clean,
          timeResponsible: clean[0] || "",
          timeResponsibleRole: roleDraft,
          timeResponsibleFrom: from,
          timeResponsibleTo: "",
          timeResponsibleStatus: "",
          timeResponsibleNotes: notes,
        };
    const nextSummary = isManager
      ? `${clean.length ? clean.join(", ") : "Sin asignar"} · Desde ${from}`
      : `${clean.length ? clean.join(", ") : "Sin asignar"} · ${roleDraft || "Sin rol"} · Desde ${from}`;
    try {
      await persistEmployeeBlock(updated, user, onSaved, "assignments");
      await recordBlockHistory(
        {
          employeeId: employee.id,
          section: "RESPONSABLES_ASIGNACIONES",
          block,
          blockLabel: title,
          oldValue: summary(),
          newValue: nextSummary,
          effectiveFrom: from,
          reason,
        },
        user,
        `Legajo ${employee.legajoInterno || employee.legajo}`,
      );
    } catch (error) {
      setError(getUserErrorMessage(error, "No pudimos guardar las asignaciones. Intentá nuevamente."));
      return;
    }
    setEditing(false);
    setShowHistory(true);
  });

  return (
    <div className="block-card">
      <div className="block-card-head">
        <div>
          <h3>{title}</h3>
          <p>{summary()}</p>
          <small>
            {isManager
              ? "Relacion jerarquica o funcional para organigramas."
              : "Usuarios autorizados a cargar horas, ausencias y novedades horarias."}
          </small>
        </div>
        <div className="tracked-actions">
          <button className="button subtle" onClick={() => setShowHistory(!showHistory)}>
            Ver historial
          </button>
          {canEdit ? (
            <button
              className="button primary"
              onClick={() => {
                setNames(currentList);
                setEditing(true);
              }}
            >
              {currentList.length
                ? isManager
                  ? "Editar encargados"
                  : "Editar responsables"
                : isManager
                  ? "Agregar encargado"
                  : "Agregar responsable"}
            </button>
          ) : null}
        </div>
      </div>
      {showHistory ? (
        <BlockHistoryTimeline
          employeeId={employee.id}
          section="RESPONSABLES_ASIGNACIONES"
          block={block}
          empty="Todavia no hay historial registrado."
        />
      ) : null}
      {editing ? (
        <Modal title={title} close={() => setEditing(false)}>
          <div className="form-stack">
            <PeopleMultiSearch
              label={isManager ? "Encargados directos" : "Responsables de carga horaria"}
              selected={names}
              onChange={setNames}
              excludeId={employee.id}
            />
            {!isManager ? (
              <Select
                label="Rol"
                value={roleDraft}
                set={setRole}
                options={userRoleOptions(roleDraft)}
              />
            ) : null}
            <Field label="Fecha desde" type="date" value={from} set={setFrom} />
            <Field label="Observacion" value={notes} set={setNotes} />
            <Field label="Motivo del cambio" value={reason} set={setReason} />
            {error ? <p className="error">{error}</p> : null}
            <div className="form-actions">
              <button className="button subtle" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button className="button primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar asignacion"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function TransportBlock({ employee, user, canEdit, onSaved }: EmployeeBlockProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [transport, setTransport] = useState(employee.transport ? "Sí" : "No");
  const [city, setCity] = useState(employee.transportLocality || employee.city);
  const [notes, setNotes] = useState(employee.transportNotes);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    const updated = {
      ...employee,
      transport: transport === "Sí",
      transportLocality: transport === "Sí" ? city : "",
      transportRoute: "",
      transportNotes: notes,
    };
    try {
      await persistEmployeeBlock(updated, user, onSaved, "transport");
      await recordBlockHistory(
        {
          employeeId: employee.id,
          section: "TRANSPORTE",
          block: "TRANSPORTE",
          blockLabel: "Transporte",
          oldValue: transportSummary(employee),
          newValue: transportSummary(updated),
          effectiveFrom: from,
          reason,
        },
        user,
        `Legajo ${employee.legajoInterno || employee.legajo}`,
      );
      setHistoryVersion((version) => version + 1);
    } catch (error) {
      setError(getUserErrorMessage(error, "No pudimos guardar los datos de transporte. Intentá nuevamente."));
      return;
    }
    setEditing(false);
    setShowHistory(true);
  });

  return (
    <div className="block-card">
      <div className="block-card-head">
        <div>
          <h3>Transporte actual</h3>
          <p>{transportSummary(employee)}</p>
        </div>
        <div className="tracked-actions">
          <button className="button subtle" onClick={() => setShowHistory(!showHistory)}>
            Ver historial
          </button>
          {canEdit ? (
            <button
              className="button primary"
              onClick={() => {
                setTransport(employee.transport ? "Sí" : "No");
                setCity(employee.transportLocality || employee.city);
                setNotes(employee.transportNotes);
                setError("");
                setEditing(true);
              }}
            >
              Modificar transporte
            </button>
          ) : null}
        </div>
      </div>
      {showHistory ? (
        <BlockHistoryTimeline
          employeeId={employee.id}
          section="TRANSPORTE"
          block="TRANSPORTE"
          refreshKey={historyVersion}
          empty="Todavía no hay historial de transporte registrado."
        />
      ) : null}
      {editing ? (
        <Modal title="Modificar transporte" close={() => setEditing(false)}>
          <div className="form-stack">
            <Select
              label="Utiliza transporte de empresa"
              value={transport}
              set={setTransport}
              options={["Sí", "No"]}
            />
            {transport === "Sí" ? (
              <Field label="Ciudad / Localidad de origen" value={city} set={setCity} />
            ) : null}
            <Field label="Observaciones" value={notes} set={setNotes} />
            <Field label="Fecha desde" type="date" value={from} set={setFrom} />
            <Field label="Motivo del cambio" value={reason} set={setReason} />
            {error ? <p className="error">{error}</p> : null}
            <div className="form-actions">
              <button className="button subtle" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button className="button primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar transporte"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function HoursSpecialBlock({ employee, user, canEdit, onSaved }: EmployeeBlockProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState(employee.enabledHours);
  const enabledHourOptions = useHourOptions();
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    const updated = { ...employee, enabledHours: hours };
    try {
      await persistEmployeeBlock(updated, user, onSaved, "hourConcepts");
      await recordBlockHistory(
        {
          employeeId: employee.id,
          section: "CONFIGURACION_HORARIA_LIQUIDACION",
          block: "HORAS_ESPECIALES",
          blockLabel: "Horas especiales habilitadas",
          oldValue: hoursSummary(employee),
          newValue: hoursSummary(updated),
          effectiveFrom: from,
          reason,
        },
        user,
        `Legajo ${employee.legajoInterno || employee.legajo}`,
      );
    } catch (error) {
      setError(getUserErrorMessage(error, "No pudimos guardar la configuración horaria. Intentá nuevamente."));
      return;
    }
    setEditing(false);
    setShowHistory(true);
  });

  return (
    <div className="block-card">
      <div className="block-card-head">
        <div>
          <h3>Horas especiales habilitadas</h3>
          <p>{hoursSummary(employee)}</p>
        </div>
        <div className="tracked-actions">
          <button className="button subtle" onClick={() => setShowHistory(!showHistory)}>
            Ver historial
          </button>
          {canEdit ? (
            <button className="button primary" onClick={() => setEditing(true)}>
              Modificar configuración horaria
            </button>
          ) : null}
        </div>
      </div>
      {showHistory ? (
        <BlockHistoryTimeline
          employeeId={employee.id}
          section="CONFIGURACION_HORARIA_LIQUIDACION"
          block="HORAS_ESPECIALES"
          empty="Todavía no hay historial registrado."
        />
      ) : null}
      {editing ? (
        <Modal title="Modificar configuración horaria" close={() => setEditing(false)}>
          <div className="form-stack">
            <div className="check-grid">
              {enabledHourOptions.map((hour) => (
                <label className="check-card" key={hour}>
                  <input
                    type="checkbox"
                    checked={hours.includes(hour)}
                    onChange={(event) =>
                      setHours(
                        event.target.checked
                          ? [...hours, hour]
                          : hours.filter((item) => item !== hour),
                      )
                    }
                  />
                  {hour}
                </label>
              ))}
            </div>
            <Field label="Fecha desde" type="date" value={from} set={setFrom} />
            <Field label="Motivo del cambio" value={reason} set={setReason} />
            {error ? <p className="error">{error}</p> : null}
            <div className="form-actions">
              <button className="button subtle" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button className="button primary" onClick={save} disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar horas"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
