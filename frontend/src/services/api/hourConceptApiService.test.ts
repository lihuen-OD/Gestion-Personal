import { describe, expect, it } from "vitest";
import {
  buildHourConceptEmployeePath,
  buildHourConceptEmployeesPath,
  buildHourConceptPath,
  buildHourConceptRemovePath,
  mapHourConceptEmployeeAssociationFromApi,
  mapHourConceptFromApi,
  mapToApi,
} from "./hourConceptApiService";
import type { HourConcept } from "../../types/hourConcept.types";

describe("mapHourConceptEmployeeAssociationFromApi — empleados habilitados para el concepto (Etapa 8G)", () => {
  it("mapea employeeId y los datos del empleado habilitado", () => {
    const association = mapHourConceptEmployeeAssociationFromApi({
      employeeId: "employee-1",
      employee: {
        id: "employee-1",
        legajo: "100",
        cuil: "20-12345678-9",
        firstName: "Ana",
        lastName: "Prueba",
        status: "ACTIVO",
        sector: null,
        costCenter: { id: "cc-1", name: "Administración" },
        companies: [{ id: "company-1", name: "OD" }],
      },
    });

    expect(association).toEqual({
      employeeId: "employee-1",
      employee: {
        id: "employee-1",
        legajo: "100",
        cuil: "20-12345678-9",
        firstName: "Ana",
        lastName: "Prueba",
        status: "ACTIVO",
        sector: null,
        costCenter: { id: "cc-1", name: "Administración" },
        companies: [{ id: "company-1", name: "OD" }],
      },
    });
  });
});

// Etapa 8L: HourConcept perdió los campos decorativos (description, notes,
// allowedLoadRoles, approvalRoles, finnegansLinks, createdBy, updatedBy,
// history, rules) porque no existían en schema.prisma y se perdían
// silenciosamente al guardar. Etapa 8N: además, countsAsWorked (que SÍ
// existe en schema.prisma y SÍ se usa en backend) se sacó del frontend por
// decisión de producto — todo concepto horario cuenta como trabajado, así
// que deja de ser configurable desde esta pantalla. mapHourConceptFromApi ya
// no lo mapea, aunque la API lo siga devolviendo.
describe("mapHourConceptFromApi — solo campos reales y expuestos en esta pantalla (Etapa 8L/8N)", () => {
  it("mapea únicamente los campos que persiste el backend y se muestran en pantalla, sin inventar ninguno", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      countsAsWorked: true,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(concept).toEqual({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("no mapea countsAsWorked aunque la API lo devuelva (Etapa 8N: no debe aparecer en frontend)", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-2",
      code: "HOR-002",
      name: "Sereno",
      kind: "SERENO",
      status: "ACTIVO",
      countsAsWorked: false,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(concept).not.toHaveProperty("countsAsWorked");
  });

  // Etapa 8Q (auditoría UI/UX): igual que countsAsWorked — la API lo sigue
  // devolviendo (existe en schema.prisma desde la Etapa 8P), pero esta
  // pantalla ya no ofrece "ver eliminados", así que no se mapea al frontend.
  it("no mapea deletedAt aunque la API lo devuelva", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-3",
      code: "HOR-003",
      name: "Guardia",
      kind: "GUARDIA",
      status: "INACTIVO",
      countsAsWorked: true,
      deletedAt: "2026-08-20T12:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(concept).not.toHaveProperty("deletedAt");
  });

  it("no reconstruye description/notes/roles/history con valores hardcodeados", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      countsAsWorked: true,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(concept).not.toHaveProperty("description");
    expect(concept).not.toHaveProperty("notes");
    expect(concept).not.toHaveProperty("allowedLoadRoles");
    expect(concept).not.toHaveProperty("approvalRoles");
    expect(concept).not.toHaveProperty("finnegansLinks");
    expect(concept).not.toHaveProperty("createdBy");
    expect(concept).not.toHaveProperty("updatedBy");
    expect(concept).not.toHaveProperty("history");
    expect(concept).not.toHaveProperty("rules");
  });
});

describe("mapToApi — el payload de create/update solo envía campos reales y editables en esta pantalla (Etapa 8L/8N)", () => {
  const concept: HourConcept = {
    id: "concept-1",
    code: "HOR-001",
    name: "Guardia",
    kind: "GUARDIA",
    status: "ACTIVO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("envía exactamente code/name/kind/status, nada más", () => {
    expect(mapToApi(concept)).toEqual({
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
    });
  });

  it("no envía createdAt/updatedAt ni ningún campo decorativo", () => {
    const payload = mapToApi(concept);
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
    expect(payload).not.toHaveProperty("description");
    expect(payload).not.toHaveProperty("notes");
  });

  // Etapa 8N: countsAsWorked ya no existe en HourConcept (frontend) y
  // mapToApi no lo envía nunca — ni hardcodeado a true, ni desde el
  // concepto. Omitir la clave (en vez de forzar true) evita pisar en
  // silencio un valor real que el concepto ya tuviera en la base al editar.
  it("nunca envía countsAsWorked, ni hardcodeado ni de ninguna otra forma", () => {
    const payload = mapToApi(concept);
    expect(payload).not.toHaveProperty("countsAsWorked");
  });
});

describe("buildHourConceptPath — endpoint real de update/updateStatus/remove (Etapa 8O)", () => {
  it("arma /hour-concepts/:id", () => {
    expect(buildHourConceptPath("concept-abc")).toBe("/hour-concepts/concept-abc");
  });

  it("usa el id real pasado, no un valor fijo", () => {
    expect(buildHourConceptPath("otro-concepto")).toBe("/hour-concepts/otro-concepto");
  });
});

// Etapa 8P: el primer intento de eliminar nunca manda force — si el backend
// tiene uso histórico responde 409 y recién ahí, tras una segunda
// confirmación explícita del usuario, se reintenta con force=true.
describe("buildHourConceptRemovePath — delete sin uso vs eliminación forzada con uso histórico (Etapa 8P)", () => {
  it("sin force: solo /hour-concepts/:id (primer intento, sin uso => delete físico directo)", () => {
    expect(buildHourConceptRemovePath("concept-1")).toBe("/hour-concepts/concept-1");
  });

  it("force=false explícito se comporta igual que ausente", () => {
    expect(buildHourConceptRemovePath("concept-1", false)).toBe("/hour-concepts/concept-1");
  });

  it("force=true: agrega ?force=true (segunda confirmación tras 409 HOUR_CONCEPT_IN_USE)", () => {
    expect(buildHourConceptRemovePath("concept-1", true)).toBe("/hour-concepts/concept-1?force=true");
  });
});

describe("buildHourConceptEmployeesPath / buildHourConceptEmployeePath — endpoints reales de agregar/quitar (Etapa 8N)", () => {
  it("arma /hour-concepts/:id/employees para habilitar (POST)", () => {
    expect(buildHourConceptEmployeesPath("concept-abc")).toBe("/hour-concepts/concept-abc/employees");
  });

  it("arma /hour-concepts/:id/employees/:employeeId para quitar (DELETE)", () => {
    expect(buildHourConceptEmployeePath("concept-abc", "employee-1")).toBe("/hour-concepts/concept-abc/employees/employee-1");
  });

  it("usa los ids reales pasados, no valores fijos", () => {
    expect(buildHourConceptEmployeesPath("otro-concepto")).toBe("/hour-concepts/otro-concepto/employees");
    expect(buildHourConceptEmployeePath("otro-concepto", "otro-empleado")).toBe("/hour-concepts/otro-concepto/employees/otro-empleado");
  });
});
