import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { auditApiService } from "../services/api/auditApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import { ApiError } from "../services/api/apiClient";
import { calculateEmployeeStatus } from "../services/employeeStatusService";
import { EmployeeDocumentsPanel } from "../components/documents/EmployeeDocumentsPanel";
import { EmployeeNoveltiesPanel } from "../components/novelties/EmployeeNoveltiesPanel";
import { OverflowCell } from "../components/ui/OverflowCell";
import { Field, Select } from "../components/ui/FormControls";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
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
import { useAsyncAction } from "../utils/useAsyncAction";
import { roleLevel } from "../utils/roles";
import { statusTone } from "../utils/status";

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
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [notice, setNotice] = useState(location.state?.created ? "Legajo creado correctamente." : "");
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">(id ? "loading" : "success");
  const [loadRetry, setLoadRetry] = useState(0);
  const laborOptions = useLaborSelectOptions(employee || undefined);
  const structureOptions = useStructureSelectOptions({ costCenter: employee?.costCenter || "" });

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setLoadStatus("loading");
    employeeApiService
      .getOverviewById(id)
      .then((item) => {
        if (!mounted) return;
        setEmployee(item);
        setLoadStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setEmployee(null);
        setLoadStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [id, loadRetry]);

  useEffect(() => {
    if (!employee || tab !== 9 || auditLoaded) return;
    let mounted = true;
    auditApiService
      .getAll({ entityId: employee.id, take: 200 })
      .then((items) => {
        if (mounted) {
          setAuditRows(items);
          setAuditLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setAuditRows([]);
          setAuditLoaded(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [auditLoaded, employee, tab]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!employee) return;
    const currentEmployee = employee;
    if (!currentEmployee.legajoInterno) return setNotice("Legajo Interno es obligatorio.");
    if (!currentEmployee.birthDate) return setNotice("Fecha de nacimiento es obligatoria.");
    if (!currentEmployee.gender) return setNotice("Sexo es obligatorio.");
    if (!currentEmployee.nationality) return setNotice("Nacionalidad es obligatoria.");
    if (currentEmployee.endDate && !currentEmployee.startDate) {
      return setNotice("Para cargar una baja / egreso primero debe existir una fecha de alta.");
    }
    if (currentEmployee.endDate && currentEmployee.startDate && currentEmployee.endDate < currentEmployee.startDate) {
      return setNotice("Fecha de baja / egreso no puede ser anterior a la fecha de alta.");
    }
    if (currentEmployee.endDate && !currentEmployee.exitReason) {
      return setNotice("Si cargás fecha de baja / egreso, debés indicar el motivo.");
    }
    try {
      const duplicateCandidates = await employeeApiService
        .list({ search: currentEmployee.legajoInterno, take: 10 })
        .then((result) => result.items.filter((item) => item.id !== currentEmployee.id))
        .catch(() => []);
      if (duplicateCandidates.some((item) => item.legajoInterno === currentEmployee.legajoInterno)) {
        return setNotice("Ya existe un colaborador con este Legajo Interno.");
      }
      if (currentEmployee.legajoFinnegans) {
        const finnegansCandidates = await employeeApiService
          .list({ search: currentEmployee.legajoFinnegans, take: 10 })
          .then((result) => result.items.filter((item) => item.id !== currentEmployee.id))
          .catch(() => []);
        if (finnegansCandidates.some((item) => item.legajoFinnegans === currentEmployee.legajoFinnegans)) {
          return setNotice("Ya existe un colaborador con este Legajo Finnegans.");
        }
      }
      const updated = await employeeApiService.update({ ...currentEmployee, legajo: currentEmployee.legajoInterno, address: currentEmployee.addressStreet });
      setEmployee(updated);
      setAuditLoaded(false);
      setNotice("Cambios guardados correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setNotice("No se pudo guardar: ya existe otro legajo con el mismo Legajo, Legajo Finnegans, CUIL o DNI.");
      } else if (error instanceof ApiError) {
        setNotice(`No se pudo guardar: ${error.message} (${error.code}).`);
      } else {
      setNotice("Error al guardar. Verifica que el backend esté activo.");
      }
      setTimeout(() => setNotice(""), 3000);
    }
  });

  if (loadStatus === "loading") return <Section title="Legajo"><LoadingState text="Cargando legajo..." /></Section>;
  if (loadStatus === "error") return <Section title="Legajo"><ErrorState message="No se pudo cargar el legajo." onRetry={() => setLoadRetry((value) => value + 1)} /></Section>;
  if (!employee) return <Navigate to="/legajos" />;
  const currentEmployee = employee!;
  const editable = level === 1;

  const laborStatus =
    currentEmployee.laborMovements?.length || currentEmployee.startDate
      ? calculateEmployeeStatus(currentEmployee)
      : currentEmployee.status;

  return (
    <>
      <div className="detail-hero">
        <Link to="/legajos" className="back-link">
          ← Volver a legajos
        </Link>
        <div>
          <div className="avatar">
            {currentEmployee.firstName[0]}
            {currentEmployee.lastName[0]}
          </div>
          <div>
            <p className="eyebrow">LEGAJO {displayLegajo(currentEmployee)}</p>
            <h1>
              {currentEmployee.firstName} {currentEmployee.lastName}
            </h1>
            <p>
              {currentEmployee.cuil} · {currentEmployee.company} · {currentEmployee.costCenter}
            </p>
          </div>
        </div>
        <div className="hero-actions">
          <Badge tone={statusTone(laborStatus)}>{laborStatus}</Badge>
          {editable ? (
            <Button variant="primary" onClick={save} disabled={isSaving}>
              {isSaving ? "Guardando..." : "Guardar cambios"}
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? <div className="toast">{notice}</div> : null}
      <Tabs
        tabs={tabs.filter((_, index) => index !== 9 || level === 1).map((tabName, index) => ({ key: String(index), label: tabName }))}
        active={String(tab)}
        onChange={(key) => setTab(Number(key))}
      />
      <Section
        title={tabs[tab]}
        subtitle={
          tab === 3
            ? "Separación explícita entre jerarquía funcional y permisos de carga."
            : "Información consolidada del colaborador."
        }
      >
        <fieldset className="readonly-scope" disabled={!editable}>
          {renderEmployeeTab(tab, currentEmployee, setEmployee, editable, user!, structureOptions, laborOptions, auditRows)}
        </fieldset>
      </Section>
      {![2, 3, 4, 5, 6, 7].includes(tab) && tabSections[tab] ? (
        <SectionChangeHistory
          employeeId={currentEmployee.id}
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
        <Field label="Fecha nacimiento *" type="date" value={employee.birthDate} set={(value) => update("birthDate", value)} />
        <Select label="Sexo *" value={employee.gender} set={(value) => update("gender", value)} options={["Femenino", "Masculino", "Otro"]} />
        <Field label="Estado civil" value={employee.civilStatus} set={(value) => update("civilStatus", value)} />
        <Field label="Nacionalidad *" value={employee.nationality} set={(value) => update("nationality", value)} />
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
          <DerivedLaborField label="Unidad de negocio" value={employee.businessUnit} />
          <DerivedLaborField label="Establecimiento" value={employee.establishment} />
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
    <DataTable status={auditRows.length ? "ready" : "empty"} minWidth={960} emptyText="Todavía no hay eventos de auditoría para este legajo.">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Usuario</th>
            <th>Acción</th>
            <th>Detalle</th>
            <th>Cambio</th>
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
                  <OverflowCell value={audit.reason} />
                </td>
                <td>
                  <OverflowCell value={`${audit.previous !== "-" ? `Antes: ${audit.previous}` : ""}${audit.previous !== "-" && audit.next !== "-" ? " | " : ""}${audit.next !== "-" ? `Despues: ${audit.next}` : ""}` || "-"} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </DataTable>
  );
}

function DerivedLaborField({ label, value }: { label: string; value: string }) {
  return (
    <div className="tracked-field">
      <div className="tracked-main">
        <small>{label}</small>
        <b>{value || "Sin cargar"}</b>
        <span>Dato derivado del sector seleccionado</span>
      </div>
    </div>
  );
}
