import { describe, expect, it, vi } from "vitest";
import { backupBranchName, createBranchBackup, planBranchBackup, verifyBranchBackup } from "./neonBranchBackup";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const source = { id: "br-reorg", name: "org-location-reorg", parent_id: "br-main", default: false };

function api(routes: Record<string, (init?: RequestInit) => Promise<Response>>) {
  return vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace("https://console.neon.tech/api/v2", "")}`;
    const route = routes[key];
    if (!route) throw new Error(`ruta no esperada: ${key}`);
    return route(init);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("respaldo de rama Neon (B0)", () => {
  it("el plan es de sólo lectura: rama hija con datos y SIN compute de la rama verificada", async () => {
    const fetchImpl = api({
      "GET /projects/proj-1/branches/br-reorg": () => json({ branch: source }),
      "GET /projects/proj-1/branches": () => json({ branches: [source, { id: "br-main", name: "main", default: true }] }),
    });
    const plan = await planBranchBackup({ apiKey: "k", projectId: "proj-1", sourceBranchId: "br-reorg", dateKey: "2026-10-09", fetchImpl });
    expect(plan).toEqual({
      projectId: "proj-1",
      source: { id: "br-reorg", name: "org-location-reorg", isRoot: false },
      backupName: "org-location-reorg-a8-backup-20261009",
      request: { branch: { name: "org-location-reorg-a8-backup-20261009", parent_id: "br-reorg", init_source: "parent-data" } },
      existingWithSameName: [],
      branchCount: 2,
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method === "GET")).toBe(true);
    expect("endpoints" in plan.request).toBe(false);
  });

  it("nunca respalda (ni planifica sobre) la rama por defecto", async () => {
    const fetchImpl = api({ "GET /projects/proj-1/branches/br-main": () => json({ branch: { id: "br-main", name: "main", default: true } }) });
    await expect(planBranchBackup({ apiKey: "k", projectId: "proj-1", sourceBranchId: "br-main", dateKey: "2026-10-09", fetchImpl })).rejects.toThrow("rama por defecto");
  });

  it("crea y verifica el origen; un nombre ya existente aborta sin POST", async () => {
    const created = { id: "br-backup", name: "org-location-reorg-a8-backup-20261009", parent_id: "br-reorg", parent_lsn: "0/1A2B", created_at: "2026-10-09T12:00:00Z" };
    const fetchImpl = api({ "POST /projects/proj-1/branches": (init) => { expect(JSON.parse(String(init?.body))).toEqual({ branch: { name: created.name, parent_id: "br-reorg", init_source: "parent-data" } }); return json({ branch: created, operations: [{ id: "op-1", action: "create_branch", status: "running", extra: 1 }] }, 201); } });
    const plan = { projectId: "proj-1", source: { id: "br-reorg", name: "org-location-reorg", isRoot: false }, backupName: created.name, request: { branch: { name: created.name, parent_id: "br-reorg", init_source: "parent-data" as const } }, existingWithSameName: [], branchCount: 2 };
    const record = await createBranchBackup(plan, { apiKey: "k", fetchImpl, now: () => new Date("2026-10-09T12:00:01Z") });
    expect(record.backup).toEqual({ id: "br-backup", name: created.name, parentId: "br-reorg", parentLsn: "0/1A2B", parentTimestamp: null, createdAt: "2026-10-09T12:00:00Z", hasCompute: false });
    expect(record.operations).toEqual([{ id: "op-1", action: "create_branch", status: "running" }]);

    const noCall = api({});
    await expect(createBranchBackup({ ...plan, existingWithSameName: ["br-old"] }, { apiKey: "k", fetchImpl: noCall })).rejects.toThrow("Ya existe");
    expect(noCall).not.toHaveBeenCalled();
  });

  it("rechaza una rama creada con otro origen o con compute", async () => {
    const plan = { projectId: "proj-1", source: { id: "br-reorg", name: "org-location-reorg", isRoot: false }, backupName: "b", request: { branch: { name: "b", parent_id: "br-reorg", init_source: "parent-data" as const } }, existingWithSameName: [], branchCount: 1 };
    await expect(createBranchBackup(plan, { apiKey: "k", fetchImpl: api({ "POST /projects/proj-1/branches": () => json({ branch: { id: "x", name: "b", parent_id: "br-main" } }) }) })).rejects.toThrow("origen br-main");
    await expect(createBranchBackup(plan, { apiKey: "k", fetchImpl: api({ "POST /projects/proj-1/branches": () => json({ branch: { id: "x", name: "b", parent_id: "br-reorg" }, endpoints: [{ id: "ep" }] }) }) })).rejects.toThrow("compute");
  });

  it("verificación posterior: existe, origen correcto, estado listo; un error de la API no se degrada", async () => {
    const record = { projectId: "proj-1", source: { id: "br-reorg", name: "org-location-reorg" }, backup: { id: "br-backup", name: "b", parentId: "br-reorg", parentLsn: null, parentTimestamp: null, createdAt: null, hasCompute: false as const }, operations: [], createdAt: "t" };
    expect(await verifyBranchBackup(record, { apiKey: "k", fetchImpl: api({ "GET /projects/proj-1/branches/br-backup": () => json({ branch: { id: "br-backup", name: "b", parent_id: "br-reorg", parent_lsn: "0/1", current_state: "ready" } }) }) }))
      .toEqual({ id: "br-backup", name: "b", parentId: "br-reorg", parentLsn: "0/1", currentState: "ready", ready: true });
    await expect(verifyBranchBackup(record, { apiKey: "k", fetchImpl: api({ "GET /projects/proj-1/branches/br-backup": () => json({}, 403) }) })).rejects.toThrow("403");
  });

  it("nombre del respaldo", () => {
    expect(backupBranchName("org-location-reorg", "2026-10-09")).toBe("org-location-reorg-a8-backup-20261009");
  });
});
