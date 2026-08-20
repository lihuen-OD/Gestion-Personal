import { describe, expect, it } from "vitest";
import { mapHourConceptEmployeeAssociationFromApi, mapHourConceptFromApi, mapToApi } from "./hourConceptApiService";
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
// silenciosamente al guardar. Estos tests confirman que el mapper ya no los
// reconstruye con valores inventados, y que el payload de create/update solo
// manda campos reales.
describe("mapHourConceptFromApi — solo campos reales (Etapa 8L)", () => {
  it("mapea únicamente los campos que persiste el backend, sin inventar ninguno", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      countsAsWorked: true,
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

  it("no reconstruye description/notes/roles/history con valores hardcodeados", () => {
    const concept = mapHourConceptFromApi({
      id: "concept-1",
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      countsAsWorked: true,
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

describe("mapToApi — el payload de create/update solo envía campos reales (Etapa 8L)", () => {
  const concept: HourConcept = {
    id: "concept-1",
    code: "HOR-001",
    name: "Guardia",
    kind: "GUARDIA",
    status: "ACTIVO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("envía exactamente code/name/kind/status/countsAsWorked, nada más", () => {
    expect(mapToApi(concept)).toEqual({
      code: "HOR-001",
      name: "Guardia",
      kind: "GUARDIA",
      status: "ACTIVO",
      countsAsWorked: true,
    });
  });

  it("no envía createdAt/updatedAt ni ningún campo decorativo", () => {
    const payload = mapToApi(concept);
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
    expect(payload).not.toHaveProperty("description");
    expect(payload).not.toHaveProperty("notes");
  });
});
