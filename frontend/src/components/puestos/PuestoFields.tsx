import type { Position, PositionCompetency, PositionEvaluationCriterion, PositionIndicator, PositionRelation, PositionResponsibility, WorkModality } from "../../types/position.types";

export function PuestoField({ label, value, onChange, type = "text", disabled = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; disabled?: boolean }) {
  return <label>{label}<input disabled={disabled} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function PuestoTextarea({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="form-wide">{label}<textarea disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function PuestoSelect({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; disabled?: boolean }) {
  return <label>{label}<select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Seleccionar</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

export function PuestoIdSelect({ label, value, onChange, options, disabled = false, placeholder = "Sin asignar" }: { label: string; value: string | undefined; onChange: (id: string | undefined) => void; options: Array<{ id: string; name: string }>; disabled?: boolean; placeholder?: string }) {
  return <label>{label}<select disabled={disabled} value={value || ""} onChange={(event) => onChange(event.target.value || undefined)}>
    <option value="">{placeholder}</option>
    {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
  </select></label>;
}

export function PuestoDerivedField({ label, value }: { label: string; value: string }) {
  return <label>{label}<input disabled value={value || "Se completa segun el sector"} /></label>;
}

export function emptyPosition(): Omit<Position, "id" | "history" | "createdAt" | "updatedAt"> {
  return {
    code: "",
    name: "",
    reportsTo: "",
    supervises: "",
    location: "",
    lastUpdatedAt: new Date().toISOString().slice(0, 10),
    status: "ACTIVO",
    sectorId: undefined,
    derivedSectorName: "",
    derivedAreaName: "",
    derivedEstablishmentName: "",
    derivedBusinessUnitName: "",
    derivedCompanyName: "",
    salaryCategoryIds: [],
    salaryCategoryNames: [],
    mission: "",
    responsibilities: [],
    internalRelations: [],
    externalRelations: [],
    competencies: [],
    workConditions: { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" },
    performanceIndicators: [],
    evaluationCriteria: [],
    createdBy: "",
    updatedBy: "",
  };
}

export function addResponsibility(items: PositionResponsibility[]) {
  return [...items, { id: crypto.randomUUID(), description: "", order: items.length + 1 }];
}

export function addRelation(items: PositionRelation[]) {
  return [...items, { id: crypto.randomUUID(), name: "", description: "" }];
}

export function addCompetency(items: PositionCompetency[]) {
  return [...items, { id: crypto.randomUUID(), name: "", description: "", active: true }];
}

export function addIndicator(items: PositionIndicator[]) {
  return [...items, { id: crypto.randomUUID(), name: "", description: "", target: "", active: true }];
}

export function addCriterion(items: PositionEvaluationCriterion[]) {
  return [...items, { id: crypto.randomUUID(), name: "", description: "", rule: "", weight: undefined, active: true }];
}

export const modalityOptions: WorkModality[] = ["PRESENCIAL", "HIBRIDA", "REMOTA", "OTRA"];
