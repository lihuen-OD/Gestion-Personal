import { describe, expect, it } from "vitest";
import { diffBatchItems, type DiffableBatchItem } from "./finnegansExport.diff";

function item(overrides: Partial<DiffableBatchItem> = {}): DiffableBatchItem {
  return {
    noveltyId: "novelty-1",
    legajo: "100",
    noveltyCode: "VAC",
    applicationDate: "01/07/2026",
    costCenter: "",
    value1: "5",
    validFrom: "01/07/2026",
    validTo: "05/07/2026",
    ...overrides,
  };
}

describe("diffBatchItems — Etapa 15L.4 §15", () => {
  it("sin batch anterior (v1): devuelve null", () => {
    expect(diffBatchItems(null, [item()])).toBeNull();
  });

  it("mismo contenido: sin agregadas/eliminadas/modificadas", () => {
    const previous = [item()];
    const current = [item()];
    expect(diffBatchItems(previous, current)).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it("una fila nueva (noveltyId distinto, sin match por snapshot): added=1", () => {
    const previous = [item({ noveltyId: "novelty-1" })];
    const current = [item({ noveltyId: "novelty-1" }), item({ noveltyId: "novelty-2", legajo: "200", applicationDate: "02/07/2026" })];
    expect(diffBatchItems(previous, current)).toEqual({ added: 1, removed: 0, modified: 0 });
  });

  it("una fila que ya no está: removed=1", () => {
    const previous = [item({ noveltyId: "novelty-1" }), item({ noveltyId: "novelty-2", legajo: "200", applicationDate: "02/07/2026" })];
    const current = [item({ noveltyId: "novelty-1" })];
    expect(diffBatchItems(previous, current)).toEqual({ added: 0, removed: 1, modified: 0 });
  });

  it("mismo noveltyId con un valor distinto: modified=1", () => {
    const previous = [item({ value1: "5" })];
    const current = [item({ value1: "8" })];
    expect(diffBatchItems(previous, current)).toEqual({ added: 0, removed: 0, modified: 1 });
  });

  it("novedad borrada y recreada (Etapa 15L.4 §16): noveltyId nulo en el anterior (por el ON DELETE SET NULL), pero mismo legajo+código+fecha en el nuevo — se empareja por snapshot y muestra 'modificada', no se pierde la fila vieja", () => {
    const previous = [item({ noveltyId: null, value1: "5" })];
    const current = [item({ noveltyId: "novelty-2", value1: "8" })];
    expect(diffBatchItems(previous, current)).toEqual({ added: 0, removed: 0, modified: 1 });
  });

  it("novedad borrada y recreada sin ningún cambio real: no se cuenta como modificada", () => {
    const previous = [item({ noveltyId: null })];
    const current = [item({ noveltyId: "novelty-2" })];
    expect(diffBatchItems(previous, current)).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it("combinación de agregadas, eliminadas y modificadas a la vez", () => {
    const previous = [
      item({ noveltyId: "n1", legajo: "100" }),
      item({ noveltyId: "n2", legajo: "200", applicationDate: "02/07/2026" }),
      item({ noveltyId: "n3", legajo: "300", applicationDate: "03/07/2026", value1: "1" }),
    ];
    const current = [
      item({ noveltyId: "n1", legajo: "100" }), // sin cambios
      item({ noveltyId: "n3", legajo: "300", applicationDate: "03/07/2026", value1: "2" }), // modificada
      item({ noveltyId: "n4", legajo: "400", applicationDate: "04/07/2026" }), // agregada
      // n2 ya no está: eliminada
    ];
    expect(diffBatchItems(previous, current)).toEqual({ added: 1, removed: 1, modified: 1 });
  });
});
