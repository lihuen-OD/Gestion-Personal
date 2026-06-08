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

export function emptyPosition(): Omit<Position, "id" | "history" | "createdAt" | "updatedAt"> {
  return {
    code: "",
    name: "",
    areaDepartment: "",
    sector: "",
    reportsTo: "",
    supervises: "",
    location: "",
    lastUpdatedAt: new Date().toISOString().slice(0, 10),
    status: "ACTIVO",
    companyName: "",
    businessUnitName: "",
    establishmentName: "",
    suggestedCostCenterName: "",
    suggestedReceiptCategoryName: "",
    suggestedInternalCategoryName: "",
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
