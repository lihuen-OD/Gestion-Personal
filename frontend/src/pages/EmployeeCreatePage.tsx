import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Field, Select } from "../components/ui/FormControls";
import {
  CompanyMultiCreateField,
  EmployeePositionCreateField,
  SalaryRangeValidationCard,
} from "../components/employees/EmployeeLaborFields";
import { ContactAddressFields } from "../components/employees/ContactAddressFields";
import { PeopleMultiSearch } from "../components/employees/PeopleMultiSearch";
import {
  useHourOptions,
  useLaborSelectOptions,
  useStructureSelectOptions,
  userRoleOptions,
} from "../components/employees/employeeOptions";
import { employeeApiService } from "../services/api/employeeApiService";
import { calculateEmployeeStatus } from "../services/employeeStatusService";
import type { Employee } from "../types";

const entryReasons = [
  "Alta inicial",
  "Reingreso",
  "Transferencia desde otra empresa",
  "Contratacion eventual",
  "Otro",
];

const emptyMap = { lat: null, lng: null, source: "MOCK" as const, label: "" };

const blankEmployee: Employee = {
  id: "",
  legajo: "",
  legajoInterno: "",
  legajoFinnegans: "",
  firstName: "",
  lastName: "",
  dni: "",
  cuil: "",
  birthDate: "",
  gender: "",
  civilStatus: "",
  nationality: "Argentina",
  phone: "",
  mobile: "",
  email: "",
  address: "",
  addressStreet: "",
  addressNumber: "S/N",
  city: "",
  department: "",
  province: "",
  zip: "",
  domicilio: {
    calle: "",
    numero: "S/N",
    provinciaId: "",
    provinciaNombre: "",
    departamentoId: "",
    departamentoNombre: "",
    localidadId: "",
    localidadNombre: "",
    codigoPostal: "",
    ubicacionMapa: emptyMap,
  },
  emergencyContact: "",
  emergencyRelation: "",
  emergencyPhone: "",
  company: "",
  companies: [],
  businessUnit: "",
  establishment: "",
  costCenter: "",
  sector: "",
  position: "",
  positionId: "",
  puestoId: "",
  puestoNombre: "",
  receiptCategory: "",
  internalCategory: "",
  agreement: "",
  healthInsurance: "",
  directManager: "",
  directManagerFrom: "",
  directManagerTo: "",
  directManagerStatus: "",
  directManagerNotes: "",
  timeResponsible: "",
  timeResponsibleRole: "Nivel 3 - Administrativo de Carga Horaria",
  timeResponsibleFrom: "",
  timeResponsibleTo: "",
  timeResponsibleStatus: "",
  timeResponsibleNotes: "",
  startDate: "",
  endDate: "",
  exitReason: "",
  workday: "8 h",
  shift: "Mañana",
  transport: false,
  transportRoute: "",
  transportNotes: "",
  mapLocation: "",
  locationMap: emptyMap,
  enabledHours: ["Hora normal"],
  settlementType: "Normal",
  affectsSettlement: true,
  exportable: true,
  attendanceBonus: true,
  award: false,
  productiveGoals: false,
  humanGoals: false,
  settlementNotes: "",
  status: "Activo",
  laborMovements: [],
  novelties: [],
  documents: [],
  historyEvents: [],
  audit: [],
  routeHistory: [],
};

export function EmployeeCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [value, setValue] = useState<Employee>({ ...blankEmployee, id: crypto.randomUUID() });
  const [error, setError] = useState("");
  const [tab, setTab] = useState(0);
  const [entryReason, setEntryReason] = useState(entryReasons[0]);
  const [entryObservation, setEntryObservation] = useState("");
  const laborOptions = useLaborSelectOptions(value);
  const structureOptions = useStructureSelectOptions({ costCenter: value.costCenter });
  const enabledHourOptions = useHourOptions();

  const upd = (field: keyof Employee, next: Employee[keyof Employee]) =>
    setValue({ ...value, [field]: next });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const all = await employeeApiService.getAll();
    if (
      !value.legajoInterno ||
      !value.dni ||
      !value.cuil ||
      !value.firstName ||
      !value.lastName ||
      !value.company ||
      !value.costCenter ||
      !value.startDate
    ) {
      return setError(
        "Completá los campos obligatorios de Información General y Datos Laborales, incluida la fecha de alta.",
      );
    }
    if (!entryReason) return setError("El motivo de alta es obligatorio.");
    if (all.some((employee) => employee.legajoInterno === value.legajoInterno)) {
      return setError("Ya existe un colaborador con este Legajo Interno.");
    }
    if (
      value.legajoFinnegans &&
      all.some((employee) => employee.legajoFinnegans === value.legajoFinnegans)
    ) {
      return setError("Ya existe un colaborador con este Legajo Finnegans.");
    }
    if (all.some((employee) => employee.dni === value.dni)) {
      return setError("El DNI ya existe.");
    }

    const laborMovements = [
      {
        id: crypto.randomUUID(),
        type: "ALTA" as const,
        effectiveFrom: value.startDate,
        reason: entryReason,
        observation: entryObservation,
        createdAt: new Date().toISOString(),
        createdByUserId: user!.id,
        createdByUserName: user!.name,
      },
    ];

    const created: Employee = {
      ...value,
      companies: value.companies?.length ? value.companies : [value.company],
      legajo: value.legajoInterno,
      address: value.addressStreet,
      endDate: "",
      exitReason: "",
      laborMovements,
      status: calculateEmployeeStatus({ ...value, laborMovements }),
      historyEvents: [
        {
          id: crypto.randomUUID(),
          date: new Date().toLocaleDateString("es-AR"),
          type: "Alta",
          description: "Se creó el legajo del colaborador.",
          user: user!.name,
        },
      ],
    };

    try {
      const saved = await employeeApiService.create(created);
      navigate(`/legajos/${saved.id}`, { state: { created: true } });
    } catch {
      setError("No se pudo guardar el legajo. Intentá de nuevo.");
    }
  };

  const sections = [
    "Información General",
    "Contacto y Domicilio",
    "Datos Laborales",
    "Responsables / Asignaciones",
    "Transporte",
    "Configuración Horaria",
  ];

  return (
    <>
      <PageHeader
        eyebrow="ALTA DE PERSONAL"
        title="Crear nuevo legajo"
        description="Cargá la ficha integral del colaborador. Los datos quedarán disponibles inmediatamente en el detalle."
      />
      <form onSubmit={save}>
        <div className="tabs create-tabs">
          {sections.map((section, index) => (
            <button
              type="button"
              className={tab === index ? "active" : ""}
              onClick={() => setTab(index)}
              key={section}
            >
              {index + 1}. {section}
            </button>
          ))}
        </div>

        <Section
          title={sections[tab]}
          subtitle="Los campos marcados con * son obligatorios."
        >
          {tab === 0 ? (
            <div className="form-grid">
              <Field
                label="Legajo Interno *"
                value={value.legajoInterno}
                set={(next) => upd("legajoInterno", next)}
              />
              <Field
                label="Legajo Finnegans"
                value={value.legajoFinnegans || ""}
                set={(next) => upd("legajoFinnegans", next)}
              />
              <Field label="Apellido *" value={value.lastName} set={(next) => upd("lastName", next)} />
              <Field label="Nombre *" value={value.firstName} set={(next) => upd("firstName", next)} />
              <Field label="DNI *" value={value.dni} set={(next) => upd("dni", next)} />
              <Field label="CUIL *" value={value.cuil} set={(next) => upd("cuil", next)} />
              <Field
                label="Fecha de nacimiento"
                type="date"
                value={value.birthDate}
                set={(next) => upd("birthDate", next)}
              />
              <Select
                label="Sexo"
                value={value.gender}
                set={(next) => upd("gender", next)}
                options={["Femenino", "Masculino", "Otro"]}
              />
              <Field
                label="Estado civil"
                value={value.civilStatus}
                set={(next) => upd("civilStatus", next)}
              />
              <Field
                label="Nacionalidad"
                value={value.nationality}
                set={(next) => upd("nationality", next)}
              />
            </div>
          ) : null}

          {tab === 1 ? <ContactAddressFields value={value} setValue={setValue} /> : null}

          {tab === 2 ? (
            <>
              <div className="info-note">
                <b>Alta laboral</b>
                <p>
                  La baja no se carga en el alta inicial. El estado laboral se calculará luego
                  desde los movimientos de Alta / Baja laboral.
                </p>
              </div>
              <div className="form-grid">
                <CompanyMultiCreateField value={value} setValue={setValue} />
                <Select
                  label="Unidad de negocio"
                  value={value.businessUnit}
                  set={(next) => upd("businessUnit", next)}
                  options={laborOptions.businessUnit}
                />
                <Select
                  label="Establecimiento"
                  value={value.establishment}
                  set={(next) => upd("establishment", next)}
                  options={laborOptions.establishment}
                />
                <Select
                  label="Centro de costo *"
                  value={value.costCenter}
                  set={(next) => upd("costCenter", next)}
                  options={structureOptions.costCenter}
                />
                <Select
                  label="Sector"
                  value={value.sector}
                  set={(next) => upd("sector", next)}
                  options={laborOptions.sector}
                />
                <EmployeePositionCreateField value={value} setValue={setValue} />
                <Select
                  label="Categoría de recibo"
                  value={value.receiptCategory}
                  set={(next) => upd("receiptCategory", next)}
                  options={laborOptions.receiptCategory}
                />
                <Select
                  label="Categoría interna"
                  value={value.internalCategory}
                  set={(next) => upd("internalCategory", next)}
                  options={laborOptions.internalCategory}
                />
                <SalaryRangeValidationCard employee={value} />
                <Field label="Convenio" value={value.agreement} set={(next) => upd("agreement", next)} />
                <Field
                  label="Obra Social"
                  value={value.healthInsurance}
                  set={(next) => upd("healthInsurance", next)}
                />
                <Field
                  label="Fecha desde / Fecha de alta *"
                  type="date"
                  value={value.startDate}
                  set={(next) => upd("startDate", next)}
                />
                <Select
                  label="Motivo de alta *"
                  value={entryReason}
                  set={setEntryReason}
                  options={entryReasons}
                />
                <Field
                  label="Observación de alta"
                  value={entryObservation}
                  set={setEntryObservation}
                />
              </div>
            </>
          ) : null}

          {tab === 3 ? (
            <div className="assignment-create">
              <div>
                <h3>A. Encargado directo</h3>
                <p>Responsable jerárquico o funcional. Se utiliza para organigramas.</p>
                <div className="form-grid">
                  <PeopleMultiSearch
                    label="Encargados directos"
                    selected={
                      value.directManagers?.length
                        ? value.directManagers
                        : [value.directManager].filter(Boolean)
                    }
                    onChange={(names) =>
                      setValue({ ...value, directManagers: names, directManager: names[0] || "" })
                    }
                    excludeId={value.id}
                  />
                  <Field
                    label="Fecha desde"
                    type="date"
                    value={value.directManagerFrom}
                    set={(next) => upd("directManagerFrom", next)}
                  />
                  <Field
                    label="Observacion"
                    value={value.directManagerNotes}
                    set={(next) => upd("directManagerNotes", next)}
                  />
                </div>
              </div>

              <div>
                <h3>B. Responsable de carga horaria</h3>
                <p>
                  Usuario autorizado a visualizar y cargar horas, ausencias y novedades del
                  empleado.
                </p>
                <div className="form-grid">
                  <PeopleMultiSearch
                    label="Responsables de carga horaria"
                    selected={
                      value.timeResponsibles?.length
                        ? value.timeResponsibles
                        : [value.timeResponsible].filter(Boolean)
                    }
                    onChange={(names) =>
                      setValue({
                        ...value,
                        timeResponsibles: names,
                        timeResponsible: names[0] || "",
                      })
                    }
                    excludeId={value.id}
                  />
                  <Select
                    label="Rol"
                    value={value.timeResponsibleRole}
                    set={(next) => upd("timeResponsibleRole", next)}
                    options={userRoleOptions(value.timeResponsibleRole)}
                  />
                  <Field
                    label="Fecha desde"
                    type="date"
                    value={value.timeResponsibleFrom}
                    set={(next) => upd("timeResponsibleFrom", next)}
                  />
                  <Field
                    label="Observacion"
                    value={value.timeResponsibleNotes}
                    set={(next) => upd("timeResponsibleNotes", next)}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {tab === 4 ? (
            <div className="form-grid">
              <Select
                label="Utiliza transporte de la empresa"
                value={value.transport ? "Sí" : "No"}
                set={(next) => setValue({ ...value, transport: next === "Sí", transportRoute: "" })}
                options={["Sí", "No"]}
              />
              {value.transport ? (
                <Field label="Ciudad de origen" value={value.city} set={(next) => upd("city", next)} />
              ) : null}
              <Field
                label="Observaciones de transporte"
                value={value.transportNotes}
                set={(next) => upd("transportNotes", next)}
              />
            </div>
          ) : null}

          {tab === 5 ? (
            <>
              <p className="info-note">
                Las horas seleccionadas serán las opciones disponibles al cargar horas para este
                legajo. Las novedades se cargan por separado.
              </p>
              <div className="check-grid">
                {enabledHourOptions.map((hour) => (
                  <label className="check-card" key={hour}>
                    <input
                      type="checkbox"
                      checked={value.enabledHours.includes(hour)}
                      onChange={(event) =>
                        upd(
                          "enabledHours",
                          event.target.checked
                            ? [...value.enabledHours, hour]
                            : value.enabledHours.filter((item) => item !== hour),
                        )
                      }
                    />
                    {hour}
                  </label>
                ))}
              </div>
            </>
          ) : null}

          {error ? <p className="error create-error">{error}</p> : null}

          <div className="form-actions create-actions">
            <Link to="/legajos" className="button subtle">
              Cancelar
            </Link>
            {tab > 0 ? (
              <button type="button" className="button subtle" onClick={() => setTab(tab - 1)}>
                Anterior
              </button>
            ) : null}
            {tab < sections.length - 1 ? (
              <button type="button" className="button subtle" onClick={() => setTab(tab + 1)}>
                Siguiente
              </button>
            ) : null}
            <button className="button primary">Guardar nuevo legajo</button>
          </div>
        </Section>
      </form>
    </>
  );
}
