import type { ShiftRotation } from "../services/api/shiftRotationApiService";
import type { ShiftGroup } from "../services/api/shiftGroupApiService";

/** Rotaciones de prueba (R4.8) con la forma real de `GET /shifts/rotations[/:id]`. */
export const PLANTA_GROUP: ShiftGroup = { id: "g-pl", code: "PLANTA", name: "Planta", sortOrder: 20, status: "ACTIVO", templateCount: 4, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" };
export const OFICINA_GROUP: ShiftGroup = { id: "g-of", code: "OFICINA", name: "Oficina", sortOrder: 10, status: "ACTIVO", templateCount: 2, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z" };

export function rotationFixture(overrides: Partial<ShiftRotation> = {}): ShiftRotation {
  return {
    id: "rot-1",
    code: "PLANTA-4X4",
    name: "Planta 4x4",
    status: "INACTIVO",
    observation: null,
    shiftGroup: { id: PLANTA_GROUP.id, code: PLANTA_GROUP.code, name: PLANTA_GROUP.name, status: "ACTIVO" },
    hasRuled: false,
    finalized: false,
    health: "OK",
    issues: [],
    crews: [
      { id: "crew-a", code: "A", name: "Equipo A", sortOrder: 0, status: "ACTIVO", openMemberCount: 0, everHadMembers: false },
      { id: "crew-b", code: "B", name: "Equipo B", sortOrder: 1, status: "ACTIVO", openMemberCount: 0, everHadMembers: false },
    ],
    versions: [],
    members: [],
    createdAt: "2026-11-24T12:00:00Z",
    updatedAt: "2026-11-24T12:00:00Z",
    ...overrides,
  };
}
