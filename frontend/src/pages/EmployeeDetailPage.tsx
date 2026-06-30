import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { auditApiService } from "../services/api/auditApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import { calculateEmployeeStatus } from "../services/employeeStatusService";
import { EmployeeDocumentsPanel } from "../components/documents/EmployeeDocumentsPanel";
import { EmployeeNoveltiesPanel } from "../components/novelties/EmployeeNoveltiesPanel";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { Field, Select } from "../components/ui/FormControls";
import { Section } from "../components/ui/Section";
import {
  employeeDetailTabSections,
  SectionChangeHistory,
} from "../components/employees/SectionChangeHistory";
import { LaborStatusCard } from "../components/employees/LaborStatusCard";
import { FieldWithHistory } from "../components/employees/FieldHistoryControls";
import { EmployeePositionField, MultiCompanyField } from "../components/employees/LaborTrackedFields";
import { LaborMovementPanel } from "../components/employees/LaborMovementPanel";
import {
  AddressEditBlock,
  AssignmentBlock,
  HoursSpecialBlock,
  TransportBlock,
} from "../components/employees/EmployeeDetailBlocks";
import { SalaryRangeValidationCard } from "../components/employees/EmployeeLaborFields";
import { useLaborSelectOptions, useStructureSelectOptions } from "../components/employees/employeeOptions";
import type { Employee, User } from "../types";
import { displayLegajo } from "../utils/employee";
import { roleLevel } from "../utils/roles";
import { statusClass } from "../utils/status";

const tabs = [
  "Información General",
  "Contacto y Domicilio",
  "Datos Laborales",
  "Responsables / Asignaciones",
  "Transporte",
  "Configuración Horaria",
  "Ausentismo / Novedades",
  "Gestión Documental",
  "Historial de Eventos",
  "Auditoría",
];

const tabSections = employeeDetailTabSections;

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const level = roleLevel(user!.role);
  const [tab, setTab] = useState(0);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [auditRows, setAuditRows] = useState<Awaited<ReturnType<typeof auditApiService.getAll>>>([]);
  const [notice, setNotice] = useState(location.state?.created ? "Legajo creado correctamente." : "");
  const [loading, setLoading] = useState(!!id);
  const laborOptions = useLaborSelectOptions(employee || undefined);
  const structureOptions = useStructureSelectOptions({ costCenter: employee?.costCenter || "" });

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setLoading(true);
    employeeApiService
      .getById(id)
      .then((item) => {
        if (mounted) setEmployee(item);
      })
      .catch(() => {
        if (mounted) setEmployee(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (!employee) return;
    let mounted = true;
    auditApiService
      .getAll({ entityId: employee.id, take: 200 })
      .then((items) => {
        if (mounted) setAuditRows(items);
      })
      .catch(() => {
        if (mounted) setAuditRows([]);
      });
    return () => {
      mounted = false;
    };
  }, [employee?.id]);

  if (loading) return <div className="page-loading">Cargando legajo...</div>;
  if (!loading && !employee) return <Navigate to="/legajos" />;
  const editable = level === 1;

  const save = async () => {
    const all = (await employeeApiService.getAll()).filter((item) => item.id !== employee!.id);
    if (!employee!.legajoInterno) return setNotice("Legajo Interno es obligatorio.");
    if (!employee!.startDate) return setNotice("Fecha de alta / ingreso es obligatoria.");
    if (employee!.endDate && employee!.startDate && employee!.endDate < employee!.startDate) {
      return setNotice("Fecha de baja / egreso no puede ser anterior a la fecha de alta.");
    }
    if (employee!.endDate && !employee!.exitReason) {
      return setNotice("Si cargás fecha de baja / egreso, debés indicar el motivo.");
    }
    if (all.some((item) => item.legajoInterno === employee!.legajoInterno)) {
      return setNotice("Ya existe un colaborador con este Legajo Interno.");
    }
    if (
      employee!.legajoFinnegans &&
      all.some((item) => item.legajoFinnegans === employee!.legajoFinnegans)
    ) {
      return setNotice("Ya existe un colaborador con este Legajo Finnegans.");
    }
    try {
      const updated = await employeeApiService.update({ ...employee!, legajo: employee!.legajoInterno, address: employee!.addressStreet });
      setEmployee(updated);
      setNotice("Cambios guardados correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch {
      setNotice("Error al guardar. Verifica que el backend esté activo.");
      setTimeout(() => setNotice(""), 3000);
    }
  };

  const laborStatus = calculateEmployeeStatus(employee);

  return (
    <>
      <div className="detail-hero">
        <Link to="/legajos" className="back-link">
          ← Volver a legajos
        </Link>
        <div>
          <div className="avatar">
            {employee.firstName[0]}
            {employee.lastName[0]}
          </div>
          <div>
            <p className="eyebrow">LEGAJO {displayLegajo(employee)}</p>
            <h1>
              {employee.firstName} {employee.lastName}
            </h1>
            <p>
              {employee.cuil} · {employee.company} · {employee.costCenter}
            </p>
          </div>
        </div>
        <div className="hero-actions">
          <span className={statusClass(laborStatus)}>{laborStatus}</span>
          {editable ? (
            <button className="button primary" onClick={save}>
              Guardar cambios
            </button>
          ) : null}
        </div>
      </div>

      {notice ? <div className="toast">{notice}</div> : null}
      <div className="tabs">
        {tabs
          .filter((_, index) => index !== 9 || level === 1)
          .map((tabName, index) => (
            <button
              className={tab === index ? "active" : ""}
              onClick={() => setTab(index)}
              key={tabName}
            >
              {tabName}
            </button>
          ))}
      </div>
      <Section
        title={tabs[tab]}
        subtitle={
          tab === 3
            ? "Separación explícita entre jerarquía funcional y permisos de carga."
            : "Información consolidada del colaborador."
        }
      >
        <fieldset className="readonly-scope" disabled={!editable}>
          {renderEmployeeTab(tab, employee, setEmployee, editable, user!, structureOptions, laborOptions, auditRows)}
        </fieldset>
      </Section>
      {![2, 3, 4, 5, 6, 7].includes(tab) && tabSections[tab] ? (
        <SectionChangeHistory
          employeeId={employee.id}
          section={tabSections[tab]}
          title="Historial de cambios de esta sección"
        />
      ) : null}
    </>
  );
}

function renderEmployeeTab(
  tab: number,
  employee: Employee,
  setEmployee: (employee: Employee) => void,
  editable: boolean,
  user: User,
  structureOptions: ReturnType<typeof useStructureSelectOptions>,
  laborOptions: ReturnType<typeof useLaborSelectOptions>,
  auditRows: Awaited<ReturnType<typeof auditApiService.getAll>>,
): ReactNode {
  const update = (field: keyof Employee, value: Employee[keyof Employee]) =>
    setEmployee({ ...employee, [field]: value });

  if (tab === 0) {
    return (
      <div className="form-grid">
        <Field
          label="Legajo Interno"
          value={employee.legajoInterno}
          set={(value) => setEmployee({ ...employee, legajoInterno: value, legajo: value })}
        />
        <Field label="Legajo Finnegans" value={employee.legajoFinnegans || ""} set={(value) => update("legajoFinnegans", value)} />
        <Field label="Apellido" value={employee.lastName} set={(value) => update("lastName", value)} />
        <Field label="Nombre" value={employee.firstName} set={(value) => update("firstName", value)} />
        <Field label="DNI" value={employee.dni} set={(value) => update("dni", value)} />
        <Field label="CUIL" value={employee.cuil} set={(value) => update("cuil", value)} />
        <Field label="Fecha nacimiento" type="date" value={employee.birthDate} set={(value) => update("birthDate", value)} />
        <Select label="Sexo" value={employee.gender} set={(value) => update("gender", value)} options={["Femenino", "Masculino", "Otro"]} />
        <Field label="Estado civil" value={employee.civilStatus} set={(value) => update("civilStatus", value)} />
        <Field label="Nacionalidad" value={employee.nationality} set={(value) => update("nationality", value)} />
      </div>
    );
  }

  if (tab === 1) {
    return (
      <>
        <div className="form-grid">
          <Field label="Teléfono" value={employee.phone} set={(value) => update("phone", value)} />
          <Field label="Celular" value={employee.mobile} set={(value) => update("mobile", value)} />
          <Field label="Email" value={employee.email} set={(value) => update("email", value)} />
          <Field label="Contacto de emergencia" value={employee.emergencyContact} set={(value) => update("emergencyContact", value)} />
          <Field label="Parentesco" value={employee.emergencyRelation} set={(value) => update("emergencyRelation", value)} />
          <Field label="Teléfono de emergencia" value={employee.emergencyPhone} set={(value) => update("emergencyPhone", value)} />
        </div>
        <div className="block-wrap">
          <AddressEditBlock employee={employee} user={user} canEdit={editable} onSaved={setEmployee} />
        </div>
      </>
    );
  }

  if (tab === 2) {
    return (
      <>
        <LaborStatusCard employee={employee} />
        <LaborMovementPanel employee={employee} user={user} canEdit={editable} onSaved={setEmployee} />
        <div className="tracked-grid">
          <MultiCompanyField employee={employee} canEdit={editable} user={user} onSaved={setEmployee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="businessUnit" label="Unidad de negocio" value={employee.businessUnit} canEdit={editable} user={user} options={laborOptions.businessUnit} onSaved={setEmployee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="establishment" label="Establecimiento" value={employee.establishment} canEdit={editable} user={user} options={laborOptions.establishment} onSaved={setEmployee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="costCenter" label="Centro de costo" value={employee.costCenter} canEdit={editable} user={user} options={structureOptions.costCenter} onSaved={setEmployee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="sector" label="Sector" value={employee.sector} canEdit={editable} user={user} options={laborOptions.sector} onSaved={setEmployee} />
          <EmployeePositionField employee={employee} canEdit={editable} user={user} onSaved={setEmployee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="receiptCategory" label="Categoría de recibo" value={employee.receiptCategory} canEdit={editable} user={user} options={laborOptions.receiptCategory} onSaved={setEmployee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="internalCategory" label="Categoría interna" value={employee.internalCategory} canEdit={editable} user={user} options={laborOptions.internalCategory} onSaved={setEmployee} />
          <SalaryRangeValidationCard employee={employee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="agreement" label="Convenio" value={employee.agreement} canEdit={editable} user={user} onSaved={setEmployee} />
          <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="healthInsurance" label="Obra Social" value={employee.healthInsurance} canEdit={editable} user={user} onSaved={setEmployee} />
        </div>
      </>
    );
  }

  if (tab === 3) {
    return (
      <div className="block-wrap two">
        <AssignmentBlock employee={employee} user={user} canEdit={editable} onSaved={setEmployee} kind="MANAGER" />
        <AssignmentBlock employee={employee} user={user} canEdit={editable} onSaved={setEmployee} kind="TIME" />
      </div>
    );
  }

  if (tab === 4) {
    return (
      <div className="block-wrap">
        <TransportBlock employee={employee} user={user} canEdit={editable} onSaved={setEmployee} />
      </div>
    );
  }

  if (tab === 5) {
    return (
      <div className="block-wrap">
        <HoursSpecialBlock employee={employee} user={user} canEdit={editable} onSaved={setEmployee} />
      </div>
    );
  }

  if (tab === 6) return <EmployeeNoveltiesPanel employee={employee} user={user} onSaved={setEmployee} />;
  if (tab === 7) return <EmployeeDocumentsPanel employee={employee} user={user} onSaved={setEmployee} />;
  if (tab === 8) {
    return (
      <div className="timeline">
        {employee.historyEvents.map((event) => (
          <div key={event.id}>
            <i />
            <b>{event.type}</b>
            <span>{event.date}</span>
            <p>
              {event.description} · {event.user}
            </p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <TableShell minWidth={860}>
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Usuario</th>
            <th>Acción</th>
            <th>Valor anterior</th>
            <th>Valor nuevo</th>
          </tr>
        </thead>
        <tbody>
          {auditRows.map((audit) => (
              <tr key={audit.id}>
                <td>
                  {audit.date} {audit.time}
                </td>
                <td>{audit.user}</td>
                <td>{audit.action}</td>
                <td>
                  <OverflowCell value={audit.previous} />
                </td>
                <td>
                  <OverflowCell value={audit.next} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </TableShell>
  );
}
