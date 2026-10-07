import { describe, expect, it, vi } from "vitest";
import { assertExpectedHost, directHostOf, neonEndpointIdOf, requireVerifiedIdentity, verifyNeonIdentity } from "./targetIdentity";

const url = "postgresql://fixture-user:fixture-password@ep-test-endpoint-a1b2c3-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const base = { databaseUrl: url, apiKey: "key", projectId: "proj-1", expectedBranchId: "br-copy", expectedBranchName: "org-location-reorg" };

function neonApi(endpoint: Record<string, unknown>, branch: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = String(input);
    const body = path.includes("/endpoints/") ? { endpoint } : { branch };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("host y endpoint", () => {
  it("extrae el endpoint Neon con o sin pooler", () => {
    expect(neonEndpointIdOf("ep-test-endpoint-a1b2c3-pooler.c-4.us-east-1.aws.neon.tech")).toBe("ep-test-endpoint-a1b2c3");
    expect(neonEndpointIdOf("ep-test-endpoint-a1b2c3.c-4.us-east-1.aws.neon.tech")).toBe("ep-test-endpoint-a1b2c3");
    expect(directHostOf("ep-test-endpoint-a1b2c3-pooler.c-4.us-east-1.aws.neon.tech")).toBe("ep-test-endpoint-a1b2c3.c-4.us-east-1.aws.neon.tech");
  });

  it("exige declarar el host esperado y que coincida (sin exponer credenciales)", () => {
    expect(() => assertExpectedHost(url, undefined)).toThrow("Falta --expected-host");
    expect(() => assertExpectedHost(url, "ep-gentle-resonance-aiftcbel-pooler.c-4.us-east-1.aws.neon.tech")).toThrow(/Destino inesperado/);
    expect(() => assertExpectedHost(url, "ep-gentle-resonance-aiftcbel-pooler.c-4.us-east-1.aws.neon.tech")).not.toThrow(/fixture-password/);
    expect(assertExpectedHost(url, "ep-test-endpoint-a1b2c3-pooler.c-4.us-east-1.aws.neon.tech")).toBe("ep-test-endpoint-a1b2c3-pooler.c-4.us-east-1.aws.neon.tech");
  });
});

describe("verifyNeonIdentity", () => {
  it("sin credencial administrativa queda NO VERIFICADA, explicando la comprobación pendiente, y no llama a la API", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const identity = await verifyNeonIdentity({ ...base, apiKey: undefined, fetchImpl });
    expect(identity).toMatchObject({ status: "NOT_VERIFIED", endpointId: "ep-test-endpoint-a1b2c3", reason: expect.stringContaining("NEON_API_KEY") });
    expect(identity.status === "NOT_VERIFIED" && identity.pendingCheck).toMatch(/default = false/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verifica proyecto, rama, host y que no sea la rama por defecto", async () => {
    const fetchImpl = neonApi(
      { id: "ep-test-endpoint-a1b2c3", host: "ep-test-endpoint-a1b2c3.c-4.us-east-1.aws.neon.tech", branch_id: "br-copy", project_id: "proj-1" },
      { id: "br-copy", name: "org-location-reorg", default: false },
    );
    await expect(verifyNeonIdentity({ ...base, fetchImpl, now: () => new Date("2026-10-07T12:00:00Z") })).resolves.toEqual({
      status: "VERIFIED", projectId: "proj-1", endpointId: "ep-test-endpoint-a1b2c3", branchId: "br-copy", branchName: "org-location-reorg", isDefaultBranch: false, checkedAt: "2026-10-07T12:00:00.000Z",
    });
  });

  it("una discrepancia de rama lanza error (nunca se degrada a no verificado)", async () => {
    const fetchImpl = neonApi({ host: "ep-test-endpoint-a1b2c3.c-4.us-east-1.aws.neon.tech", branch_id: "br-development", project_id: "proj-1" }, {});
    await expect(verifyNeonIdentity({ ...base, fetchImpl })).rejects.toThrow(/rama br-development, no a la esperada br-copy/);
  });

  it("rechaza la rama por defecto del proyecto aunque el nombre coincida", async () => {
    const fetchImpl = neonApi({ host: "ep-test-endpoint-a1b2c3.c-4.us-east-1.aws.neon.tech", branch_id: "br-copy" }, { name: "org-location-reorg", default: true });
    await expect(verifyNeonIdentity({ ...base, fetchImpl })).rejects.toThrow(/rama por defecto/);
  });

  it("rechaza un host que no coincide con el endpoint", async () => {
    const fetchImpl = neonApi({ host: "ep-otro.c-4.us-east-1.aws.neon.tech", branch_id: "br-copy" }, { name: "org-location-reorg", default: false });
    await expect(verifyNeonIdentity({ ...base, fetchImpl })).rejects.toThrow(/no coincide/);
  });

  it("requireVerifiedIdentity bloquea la escritura si no está verificada", () => {
    expect(() => requireVerifiedIdentity({ status: "NOT_VERIFIED", endpointId: null, reason: "Falta: NEON_API_KEY.", pendingCheck: "x" })).toThrow(/no escriben sin esta comprobación/);
  });
});
