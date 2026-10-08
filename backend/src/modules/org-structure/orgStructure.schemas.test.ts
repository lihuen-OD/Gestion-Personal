import { describe, expect, it } from "vitest";
import {
  createAreaSchema,
  createBusinessUnitSchema,
  createCompanySchema,
  createCostCenterSchema,
  createEstablishmentSchema,
  createSectorSchema,
  createZoneSchema,
  updateAreaSchema,
  updateBusinessUnitSchema,
  updateCompanySchema,
  updateCostCenterSchema,
  updateEstablishmentSchema,
  updateSectorSchema,
  updateZoneSchema,
} from "./orgStructure.schemas";
import { createPositionSchema as createPosition } from "../positions/positions.schemas";
import { updatePositionSchema as updatePosition } from "../positions/positions.schemas";

// A8-1 (A8_M2_PREPARATION.md §12.1 I1, AT-3): `archivedAt` sólo lo escribe la
// transacción de limpieza. Ninguna entrada de API lo admite: si el payload lo
// trae, el schema lo RECHAZA (400) en vez de ignorarlo.

const archivedPayload = { archivedAt: "2026-10-08T00:00:00.000Z" };
const archivedNullPayload = { archivedAt: null };

const catalogCases: Array<[string, { safeParse: (value: unknown) => { success: boolean } }, Record<string, unknown>]> = [
  ["createCompany", createCompanySchema, { code: "EMP-1", name: "Los OD" }],
  ["updateCompany", updateCompanySchema, { code: "EMP-1" }],
  ["createBusinessUnit", createBusinessUnitSchema, { code: "UN-1", name: "Servicios", companyId: "00000000-0000-4000-8000-000000000001" }],
  ["updateBusinessUnit", updateBusinessUnitSchema, { code: "UN-1" }],
  ["createSector", createSectorSchema, { code: "SEC-1", name: "Cocina", businessUnitId: "00000000-0000-4000-8000-000000000001" }],
  ["updateSector", updateSectorSchema, { code: "SEC-1" }],
  ["createArea", createAreaSchema, { code: "AREA-1", name: "Parrilla", sectorId: "00000000-0000-4000-8000-000000000001" }],
  ["updateArea", updateAreaSchema, { code: "AREA-1" }],
  ["createZone", createZoneSchema, { code: "ZN-1", name: "Centro" }],
  ["updateZone", updateZoneSchema, { code: "ZN-1" }],
  ["createEstablishment", createEstablishmentSchema, { code: "EST-1", name: "Local", zoneId: "00000000-0000-4000-8000-000000000001" }],
  ["updateEstablishment", updateEstablishmentSchema, { code: "EST-1" }],
  ["createCostCenter", createCostCenterSchema, { code: "CC-1", name: "Compras" }],
  ["updateCostCenter", updateCostCenterSchema, { code: "CC-1" }],
  ["positions.createPosition", createPosition, { code: "PUE-1", name: "Director", orgScopes: [{ level: "COMPANY", nodeId: "00000000-0000-4000-8000-000000000001" }] }],
  ["positions.updatePosition", updatePosition, { code: "PUE-1" }],
];

describe("AT-3 — ningún schema de entrada acepta archivedAt", () => {
  for (const [name, schema, base] of catalogCases) {
    it(`${name}: rechaza archivedAt con fecha`, () => {
      expect(schema.safeParse({ ...base, ...archivedPayload }).success).toBe(false);
    });

    it(`${name}: rechaza archivedAt null`, () => {
      expect(schema.safeParse({ ...base, ...archivedNullPayload }).success).toBe(false);
    });

    it(`${name}: acepta el payload sin archivedAt (regresión)`, () => {
      expect(schema.safeParse(base).success).toBe(true);
    });
  }
});
