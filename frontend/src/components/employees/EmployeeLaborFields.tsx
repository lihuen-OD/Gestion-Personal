import { useEffect, useState } from "react";
import { employeeApiService, type EmployeePositionValidation } from "../../services/api/employeeApiService";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import { positionApiService } from "../../services/api/positionApiService";
import { salaryCategoryApiService } from "../../services/api/salaryCategoryApiService";
import { salaryRangeMockService } from "../../services/salaryRangeMockService";
import type { Employee } from "../../types";
import type { Position } from "../../types/position.types";

function useCompanyNames() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService.getCatalog()
      .then((catalog) => {
        if (mounted) setItems(catalog.companies.filter((company) => company.status === "ACTIVO").map((company) => company.name));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return items;
}

function usePositions(activeOnly = false) {
  const [items, setItems] = useState<Position[]>([]);

  useEffect(() => {
    let mounted = true;
    positionApiService.getAll()
      .then((positions) => {
        if (!mounted) return;
        setItems(activeOnly ? positions.filter((position) => position.status === "ACTIVO") : positions);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [activeOnly]);

  return items;
}

function selectedEmployeePosition(employee: Employee, positions: Position[]) {
  return (
    positions.find((position) => position.id === employee.positionId) ||
    positions.find((position) => position.name === (employee.puestoNombre || employee.position))
  );
}

function positionAllowedValues(
  position: ReturnType<typeof selectedEmployeePosition>,
  field: "businessUnit" | "establishment" | "sector",
) {
  if (!position) return [];
  if (field === "businessUnit") {
    return position.businessUnitNames?.length
      ? position.businessUnitNames
      : ([position.businessUnitName].filter(Boolean) as string[]);
  }
  if (field === "establishment") {
    return position.establishmentNames?.length
      ? position.establishmentNames
      : ([position.establishmentName].filter(Boolean) as string[]);
  }
  return position.sectorNames?.length ? position.sectorNames : ([position.sector].filter(Boolean) as string[]);
}

export function CompanyMultiCreateField({
  value,
  setValue,
}: {
  value: Employee;
  setValue: (employee: Employee) => void;
}) {
  const companyNames = useCompanyNames();
  const selected = value.companies?.length ? value.companies : [value.company].filter(Boolean);
  const toggle = (company: string) => {
    const next = selected.includes(company) ? selected.filter((item) => item !== company) : [...selected, company];
    setValue({ ...value, companies: next, company: next[0] || "" });
  };

  return (
    <div className="form-wide">
      <small>Empresa *</small>
      <div className="check-grid inline">
        {companyNames.map((company) => (
          <label className="check-card" key={company}>
            <input type="checkbox" checked={selected.includes(company)} onChange={() => toggle(company)} />
            {company}
          </label>
        ))}
      </div>
      <p className="info-note compact">
        Podes seleccionar mas de una empresa para directivos y gerentes. La primera seleccionada queda como
        referencia principal del legajo.
      </p>
    </div>
  );
}

export function EmployeePositionCreateField({
  value,
  setValue,
}: {
  value: Employee;
  setValue: (employee: Employee) => void;
}) {
  const positions = usePositions(true);
  const selected = positions.find((position) => position.id === value.positionId);
  const select = (id: string) => {
    const position = positions.find((item) => item.id === id);
    setValue(
      position
        ? {
            ...value,
            positionId: position.id,
            puestoId: position.id,
            puestoNombre: position.name,
            position: position.name,
          }
        : { ...value, positionId: "", puestoId: "", puestoNombre: "", position: "" },
    );
  };

  return (
    <div className="form-wide position-selector-card">
      <label>
        Puesto
        <select value={selected?.id || ""} onChange={(event) => select(event.target.value)}>
          <option value="">Seleccionar puesto existente</option>
          {positions.map((position) => (
            <option key={position.id} value={position.id}>
              {position.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

type SalaryRangeValidationCardProps = {
  employee: Employee;
  useBackendValidation?: boolean;
};

export function SalaryRangeValidationCard({
  employee,
  useBackendValidation = true,
}: SalaryRangeValidationCardProps) {
  const positions = usePositions();
  const [backendValidation, setBackendValidation] = useState<EmployeePositionValidation | null>(null);
  const [, setSalaryCatalogLoaded] = useState(0);
  const position = selectedEmployeePosition(employee, positions);
  const categoryResult = salaryRangeMockService.compareCategoryToPosition(position, employee.internalCategory);
  const check = (label: string, value: string, allowed: string[]) => ({
    label,
    value: value || "Sin cargar",
    allowed,
    ok: !position || !allowed.length || allowed.includes(value),
    missing: !value,
  });
  const rows = [
    check("Unidad de negocio", employee.businessUnit, positionAllowedValues(position, "businessUnit")),
    check("Establecimiento", employee.establishment, positionAllowedValues(position, "establishment")),
    check("Sector", employee.sector, positionAllowedValues(position, "sector")),
  ];
  const structuralMismatch = rows.some((row) => position && row.allowed.length && !row.ok && !row.missing);
  const categoryMismatch = ["BELOW_RANGE", "ABOVE_RANGE", "UNKNOWN_CATEGORY"].includes(categoryResult.status);
  const categoryPending = ["NO_POSITION", "NO_RANGE"].includes(categoryResult.status) || !employee.internalCategory;
  const tone = !position
    ? "neutral"
    : structuralMismatch || categoryMismatch
      ? "danger"
      : categoryPending || rows.some((row) => row.missing)
        ? "warning"
        : "success";
  const title = !position
    ? "Puesto sin seleccionar"
    : tone === "success"
      ? "Datos laborales dentro del puesto"
      : tone === "danger"
        ? "Hay datos fuera del puesto"
        : "Validacion pendiente";
  const categoryText = {
    IN_RANGE: `${employee.internalCategory} esta dentro del rango salarial.`,
    BELOW_RANGE: `${employee.internalCategory} esta por debajo del rango salarial.`,
    ABOVE_RANGE: `${employee.internalCategory} esta por encima del rango salarial.`,
    NO_POSITION: "No hay puesto seleccionado. Se puede guardar igual; la validacion queda pendiente.",
    NO_RANGE: "El puesto no tiene rango salarial configurado.",
    UNKNOWN_CATEGORY: "La categoria interna no se encuentra en el catalogo salarial.",
  }[categoryResult.status];
  const localValidation: EmployeePositionValidation = {
    tone,
    title,
    categoryText,
    checks: rows,
    category: {
      status: categoryResult.status,
      value: employee.internalCategory || "Sin cargar",
      range: categoryResult.range,
    },
  };
  const validation = backendValidation || localValidation;

  useEffect(() => {
    let mounted = true;
    salaryCategoryApiService
      .getGroups()
      .then((groups) => {
        if (!mounted || !groups.length) return;
        salaryRangeMockService.setApiGroups(groups);
        setSalaryCatalogLoaded((value) => value + 1);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!useBackendValidation || !employee.id) {
      setBackendValidation(null);
      return () => {
        mounted = false;
      };
    }
    employeeApiService
      .getPositionValidation(employee.id)
      .then((result) => {
        if (mounted) setBackendValidation(result);
      })
      .catch(() => {
        if (mounted) setBackendValidation(null);
      });
    return () => {
      mounted = false;
    };
  }, [
    useBackendValidation,
    employee.id,
    employee.positionId,
    employee.internalCategory,
    employee.businessUnit,
    employee.establishment,
    employee.sector,
  ]);

  return (
    <div className={`salary-range-check ${validation.tone}`}>
      <small>Validacion contra Puestos</small>
      <b>{validation.title}</b>
      <p>{validation.categoryText}</p>
      <div className="structure-check-list">
        {validation.checks.map((row) => (
          <span className={row.ok && !row.missing ? "ok" : row.missing ? "pending" : "bad"} key={row.label}>
            {row.label}: {row.value}
            {row.allowed.length ? ` · Puesto permite: ${row.allowed.join(", ")}` : ""}
          </span>
        ))}
        <span className={validation.category.status === "IN_RANGE" ? "ok" : ["NO_POSITION", "NO_RANGE"].includes(validation.category.status) ? "pending" : "bad"}>
          Categoria interna: {validation.category.value} · Rango:{" "}
          {validation.category.range.length ? validation.category.range.join(", ") : "Sin rango"}
        </span>
      </div>
    </div>
  );
}
