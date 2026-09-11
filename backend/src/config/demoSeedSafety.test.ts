import { describe, expect, it } from "vitest";
import { demoSeedPassword } from "./demoSeedSafety";

describe("demoSeedPassword", () => {
  it.each([
    { APP_ENV: "production", NODE_ENV: "development", DEMO_SEED_PASSWORD: "demo-password" },
    { APP_ENV: "staging", NODE_ENV: "production", DEMO_SEED_PASSWORD: "demo-password" },
  ])("rejects production before a seed can access the database", (env) => {
    expect(() => demoSeedPassword(env)).toThrow("Refusing to run demo seed in production");
  });

  it("requires an explicit non-trivial password outside production", () => {
    expect(() => demoSeedPassword({ APP_ENV: "local", NODE_ENV: "development" })).toThrow("DEMO_SEED_PASSWORD");
    expect(() => demoSeedPassword({ APP_ENV: "local", NODE_ENV: "development", DEMO_SEED_PASSWORD: "short" })).toThrow("DEMO_SEED_PASSWORD");
  });

  it("returns the explicitly configured password in a non-production environment", () => {
    expect(demoSeedPassword({
      APP_ENV: "staging",
      NODE_ENV: "demo",
      DEMO_SEED_PASSWORD: "demo-password",
    })).toBe("demo-password");
  });
});
