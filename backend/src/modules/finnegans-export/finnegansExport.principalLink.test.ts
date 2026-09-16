import { describe, expect, it } from "vitest";
import { resolvePrincipalFinnegansLink } from "./finnegansExport.principalLink";

describe("resolvePrincipalFinnegansLink — Etapa 15L.3A", () => {
  it("devuelve null si no hay vínculos", () => {
    expect(resolvePrincipalFinnegansLink([])).toBeNull();
  });

  it("devuelve el único vínculo cuando hay uno solo", () => {
    const link = { code: "VAC", priority: 1 };
    expect(resolvePrincipalFinnegansLink([link])).toBe(link);
  });

  it("elige el de menor priority entre varios", () => {
    const low = { code: "B", priority: 2 };
    const high = { code: "A", priority: 1 };
    expect(resolvePrincipalFinnegansLink([low, high])).toBe(high);
  });

  it("desempata de forma estable por code cuando priority es igual", () => {
    const b = { code: "B", priority: 1 };
    const a = { code: "A", priority: 1 };
    expect(resolvePrincipalFinnegansLink([b, a])).toBe(a);
    expect(resolvePrincipalFinnegansLink([a, b])).toBe(a);
  });

  it("nunca elige más de un vínculo por fila (siempre un único resultado)", () => {
    const links = [
      { code: "C", priority: 3 },
      { code: "A", priority: 1 },
      { code: "B", priority: 1 },
    ];
    const result = resolvePrincipalFinnegansLink(links);
    expect(result).toEqual({ code: "A", priority: 1 });
  });
});
