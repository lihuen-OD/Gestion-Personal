import { describe, expect, it } from "vitest";
import { emptyConcept } from "./HourConceptsPage";

describe("emptyConcept — default de un concepto nuevo, todavía sin guardar (Etapa 8L.2)", () => {
  it("countsAsWorked arranca en true por defecto (editable antes de guardar, nunca forzado después)", () => {
    const draft = emptyConcept("HOR-009");
    expect(draft.countsAsWorked).toBe(true);
  });

  it("status arranca en ACTIVO y el código pasado se respeta", () => {
    const draft = emptyConcept("HOR-009");
    expect(draft.status).toBe("ACTIVO");
    expect(draft.code).toBe("HOR-009");
  });
});
