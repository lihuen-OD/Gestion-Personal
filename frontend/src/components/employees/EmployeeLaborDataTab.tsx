import { useState } from "react";
import type { Employee, User } from "../../types";
import type { EmployeeWorkLocation } from "../../types/employeeWorkLocation.types";
import { FieldWithHistory } from "./FieldHistoryControls";
import { LaborMovementPanel } from "./LaborMovementPanel";
import { LaborStatusCard } from "./LaborStatusCard";
import { EmployeePositionField, MultiCompanyField } from "./LaborTrackedFields";
import { SalaryRangeValidationCard } from "./EmployeeLaborFields";
import { PositionScopeCard } from "./PositionScopeCard";
import { usePositionOptions } from "./options/positionOptions";
import { EmployeeWorkLocationsPanel } from "./workLocations/EmployeeWorkLocationsPanel";

type Props = {
  employee: Employee;
  user: User;
  editable: boolean;
  onSaved: (employee: Employee) => void;
  costCenterOptions: string[];
  receiptCategoryOptions: string[];
  internalCategoryOptions: string[];
};

/**
 * Datos Laborales (ORG_LOCATION_REORGANIZATION.md §3.3):
 *  A. Puesto y alcance (alcance de sólo lectura, desde el puesto).
 *  B. Ubicaciones de trabajo con vigencia.
 *  C. Empresa empleadora, categorías y demás datos laborales (sin cambios).
 * La información del modelo anterior queda visible para consulta y marcada
 * como pendiente de recarga; nunca se convierte automáticamente.
 */
export function EmployeeLaborDataTab({ employee, user, editable, onSaved, costCenterOptions, receiptCategoryOptions, internalCategoryOptions }: Props) {
  const positions = usePositionOptions();
  const [locations, setLocations] = useState<EmployeeWorkLocation[] | null>(null);
  const position = positions.find((item) => item.id === employee.positionId);
  const hasLegacyStructure = Boolean(employee.sector || employee.businessUnit || employee.establishment);

  const pending = [
    position && !position.orgScopes?.length ? `El puesto “${position.name}” no tiene alcance organizacional.` : "",
    locations && !locations.some((row) => row.state !== "ENDED") ? "No hay ubicaciones de trabajo vigentes ni futuras cargadas." : "",
    hasLegacyStructure ? "Conserva sector, unidad de negocio y establecimiento de la estructura anterior (sólo consulta)." : "",
  ].filter(Boolean);

  return (
    <>
      <LaborStatusCard employee={employee} />
      <LaborMovementPanel employee={employee} user={user} canEdit={editable} onSaved={onSaved} />

      {pending.length ? (
        <div className="info-note labor-pending-reload" role="status">
          <b>Pendiente de recarga</b>
          <ul>{pending.map((item) => <li key={item}>{item}</li>)}</ul>
          <p>Nada se convierte automáticamente. Podés seguir editando el resto de los datos laborales; las asignaciones nuevas usan la estructura nueva.</p>
        </div>
      ) : null}

      <p className="eyebrow tracked-grid-label">PUESTO Y ALCANCE ORGANIZACIONAL</p>
      <div className="tracked-grid position-scope-grid">
        <EmployeePositionField employee={employee} canEdit={editable} user={user} onSaved={onSaved} />
        <PositionScopeCard position={position} hasPositionId={Boolean(employee.positionId)} />
      </div>

      <p className="eyebrow tracked-grid-label">UBICACIONES DE TRABAJO</p>
      <div className="labor-block-wrap">
        <EmployeeWorkLocationsPanel employeeId={employee.id} canEdit={editable} onLoaded={setLocations} />
      </div>

      <p className="eyebrow tracked-grid-label">EMPRESA EMPLEADORA Y CATEGORÍAS</p>
      <div className="tracked-grid">
        <MultiCompanyField employee={employee} canEdit={editable} user={user} onSaved={onSaved} />
        <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="costCenter" label="Centro de costo" value={employee.costCenter} canEdit={editable} user={user} options={costCenterOptions} onSaved={onSaved} />
        <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="receiptCategory" label="Categoría de recibo" value={employee.receiptCategory} canEdit={editable} user={user} options={receiptCategoryOptions} onSaved={onSaved} />
        <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="internalCategory" label="Categoría interna" value={employee.internalCategory} canEdit={editable} user={user} options={internalCategoryOptions} onSaved={onSaved} />
        <SalaryRangeValidationCard employee={employee} />
        <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="agreement" label="Convenio" value={employee.agreement} canEdit={editable} user={user} onSaved={onSaved} />
        <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="healthInsurance" label="Obra Social" value={employee.healthInsurance} canEdit={editable} user={user} onSaved={onSaved} />
      </div>

      {hasLegacyStructure ? (
        <>
          <p className="eyebrow tracked-grid-label">ESTRUCTURA ANTERIOR · SÓLO CONSULTA</p>
          <div className="tracked-grid">
            <FieldWithHistory employee={employee} section="DATOS_LABORALES" field="sector" label="Sector anterior" value={employee.sector} canEdit={false} user={user} onSaved={onSaved} />
            <LegacyLaborField label="Unidad de negocio anterior" value={employee.businessUnit} />
            <LegacyLaborField label="Establecimiento anterior" value={employee.establishment} />
          </div>
        </>
      ) : null}
    </>
  );
}

function LegacyLaborField({ label, value }: { label: string; value: string }) {
  return (
    <div className="tracked-field legacy">
      <div className="tracked-main">
        <small>{label}</small>
        <b>{value || "Sin cargar"}</b>
        <span>Derivado del sector anterior. No se convierte en alcance ni en ubicación.</span>
      </div>
    </div>
  );
}
