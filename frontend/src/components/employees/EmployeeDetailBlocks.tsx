import { useState } from "react";
import { GeoAddressFields } from "../GeoAddressFields";
import { LocationMapPicker } from "../LocationMapPicker";
import { employeeApiService } from "../../services/api/employeeApiService";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import { employeeBlockHistoryMockService } from "../../services/employeeBlockHistoryMockService";
import { employeeMockService } from "../../services/employeeMockService";
import { locationService } from "../../services/locationService";
import type { Employee, User } from "../../types";
import { Field, Select } from "../ui/FormControls";
import { Modal } from "../ui/Modal";
import { BlockHistoryTimeline } from "./FieldHistoryControls";
import { PeopleMultiSearch } from "./PeopleMultiSearch";
import { useHourOptions, userRoleOptions } from "./employeeOptions";

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
    ? `Utiliza transporte · ${employee.city || "-"}${
        employee.transportNotes ? ` · ${employee.transportNotes}` : ""
      }`
    : "No utiliza transporte";

const hoursSummary = (employee: Employee) =>
  employee.enabledHours.length ? employee.enabledHours.join(", ") : "Sin horas especiales";

type EmployeeBlockPersistKind = "general" | "address" | "transport" | "assignments" | "hourConcepts";
type CreateBlockHistoryInput = Parameters<typeof employeeBlockHistoryMockService.create>[0];

async function recordBlockHistory(
  record: CreateBlockHistoryInput,
  user: User,
  auditEntity: string,
) {
  try {
    return await employeeHistoryApiService.createBlockHistory(record);
  } catch (error) {
    return employeeBlockHistoryMockService.create(record, user, auditEntity);
  }
}

async function persistEmployeeBlock(
  updated: Employee,
  user: User,
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
    onSaved(employeeMockService.update(updated, user));
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

  const save = async () => {
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
    await persistEmployeeBlock(updated, user, onSaved, "address");
    setEditing(false);
    setShowHistory(true);
  };

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
              <LocationMapPicker
                provinceName={draft.provinciaNombre}
                departmentName={draft.departamentoNombre}
                localityName={draft.localidadNombre}
                addressStreet={draft.calle}
                addressNumber={draft.numero}
                value={draft.ubicacionMapa}
                onChange={(ubicacionMapa) => setAddress({ ubicacionMapa })}
              />
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
              <button className="button primary" onClick={save}>
                Guardar domicilio
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

  const save = async () => {
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
    await persistEmployeeBlock(updated, user, onSaved, "assignments");
    setEditing(false);
    setShowHistory(true);
  };

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
              <button className="button primary" onClick={save}>
                Guardar asignacion
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
  const [editing, setEditing] = useState(false);
  const [transport, setTransport] = useState(employee.transport ? "Sí" : "No");
  const [city, setCity] = useState(employee.city);
  const [notes, setNotes] = useState(employee.transportNotes);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const save = async () => {
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    const updated = {
      ...employee,
      transport: transport === "Sí",
      city,
      transportRoute: "",
      transportNotes: notes,
    };
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
    await persistEmployeeBlock(updated, user, onSaved, "transport");
    setEditing(false);
    setShowHistory(true);
  };

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
            <button className="button primary" onClick={() => setEditing(true)}>
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
              <button className="button primary" onClick={save}>
                Guardar transporte
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

  const save = async () => {
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    const updated = { ...employee, enabledHours: hours };
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
    await persistEmployeeBlock(updated, user, onSaved, "hourConcepts");
    setEditing(false);
    setShowHistory(true);
  };

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
              <button className="button primary" onClick={save}>
                Guardar horas
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
