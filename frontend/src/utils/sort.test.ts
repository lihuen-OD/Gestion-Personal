import { describe, expect, it } from "vitest";
import { sortItems } from "./sort";

const byValue = <T,>(item: { v: T }) => item.v as never;

describe("sortItems", () => {
  it("ordena códigos de forma natural (EMP-2 antes que EMP-10)", () => {
    const items = [{ v: "EMP-10" }, { v: "EMP-2" }, { v: "EMP-1" }];
    expect(sortItems(items, byValue, "asc").map((item) => item.v)).toEqual(["EMP-1", "EMP-2", "EMP-10"]);
    expect(sortItems(items, byValue, "desc").map((item) => item.v)).toEqual(["EMP-10", "EMP-2", "EMP-1"]);
  });

  it("ignora mayúsculas y tildes", () => {
    const items = [{ v: "zeta" }, { v: "Ávila" }, { v: "alba" }, { v: "Bravo" }];
    expect(sortItems(items, byValue, "asc").map((item) => item.v)).toEqual(["alba", "Ávila", "Bravo", "zeta"]);
  });

  it("deja null/undefined/vacíos al final en ASC y en DESC", () => {
    const items = [{ v: "" }, { v: "B" }, { v: null }, { v: "A" }, { v: undefined }];
    expect(sortItems(items, byValue, "asc").map((item) => item.v).slice(0, 2)).toEqual(["A", "B"]);
    expect(sortItems(items, byValue, "desc").map((item) => item.v).slice(0, 2)).toEqual(["B", "A"]);
  });

  it("ordena números y fechas por valor", () => {
    expect(sortItems([{ v: 10 }, { v: 2 }, { v: 33 }], byValue, "asc").map((item) => item.v)).toEqual([2, 10, 33]);
    const dates = [{ v: new Date("2026-03-01") }, { v: new Date("2025-01-01") }];
    expect(sortItems(dates, byValue, "desc").map((item) => item.v.toISOString().slice(0, 10))).toEqual(["2026-03-01", "2025-01-01"]);
  });

  it("no muta el array original", () => {
    const items = [{ v: "b" }, { v: "a" }];
    sortItems(items, byValue, "asc");
    expect(items.map((item) => item.v)).toEqual(["b", "a"]);
  });
});
