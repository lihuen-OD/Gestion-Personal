import { describe, expect, it } from "vitest";
import { emptyConcept } from "./HourConceptsPage";

// Etapa 8N: countsAsWorked se sacó de la UI (decisión de producto: todo
// concepto horario cuenta como trabajado) — el test anterior (8L.2) que
// esperaba countsAsWorked=true en un draft nuevo quedó obsoleto y se
// reemplaza por esta confirmación de que ya no aparece en absoluto.
describe("emptyConcept — default de un concepto nuevo, todavía sin guardar (Etapa 8N)", () => {
  it("no incluye countsAsWorked (se sacó de la UI, sigue existiendo solo en backend)", () => {
    const draft = emptyConcept("HOR-009");
    expect(draft).not.toHaveProperty("countsAsWorked");
  });

  it("status arranca en ACTIVO y el código pasado se respeta", () => {
    const draft = emptyConcept("HOR-009");
    expect(draft.status).toBe("ACTIVO");
    expect(draft.code).toBe("HOR-009");
  });
});
