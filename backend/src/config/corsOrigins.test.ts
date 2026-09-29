import { describe, expect, it } from "vitest";
import { parseCorsOrigins } from "./corsOrigins";

describe("parseCorsOrigins", () => {
  it("splits a comma-separated list and trims whitespace", () => {
    expect(parseCorsOrigins("http://localhost:5174, https://abc-5174.brs.devtunnels.ms")).toEqual([
      "http://localhost:5174",
      "https://abc-5174.brs.devtunnels.ms",
    ]);
  });

  it("strips trailing slashes so they match the browser Origin header", () => {
    expect(parseCorsOrigins("https://abc-5174.brs.devtunnels.ms/,http://localhost:5174//")).toEqual([
      "https://abc-5174.brs.devtunnels.ms",
      "http://localhost:5174",
    ]);
  });

  it("keeps entries literal so '*' never becomes a wildcard", () => {
    // `cors` compara cada entrada del array por igualdad con el Origin; un
    // "*" dentro del array no matchea ningún origin real.
    expect(parseCorsOrigins("*")).toEqual(["*"]);
  });

  it("drops empty entries instead of allowing an empty origin", () => {
    expect(parseCorsOrigins("http://localhost:5174,, ,")).toEqual(["http://localhost:5174"]);
  });
});
