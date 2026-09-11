import { describe, expect, it } from "vitest";
import { resolveDemoLoginProfiles } from "./runtimeMode";

describe("resolveDemoLoginProfiles", () => {
  it("does not expose demo profiles when demo mode is disabled or undefined", () => {
    expect(resolveDemoLoginProfiles({})).toEqual([]);
    expect(resolveDemoLoginProfiles({ VITE_DEMO_MODE: "false" })).toEqual([]);
  });

  it("returns only complete profiles when demo mode is explicitly enabled", () => {
    expect(resolveDemoLoginProfiles({
      VITE_DEMO_MODE: "true",
      VITE_DEMO_ADMIN_EMAIL: "demo-admin@example.test",
      VITE_DEMO_ADMIN_PASSWORD: "demo-password",
      VITE_DEMO_SUPERVISOR_EMAIL: "incomplete@example.test",
    })).toEqual([{
      role: "Nivel 1 - RRHH",
      email: "demo-admin@example.test",
      password: "demo-password",
    }]);
  });
});
