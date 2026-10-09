// Respaldo de RAMA Neon del ensayo (mitad "rama Neon" del respaldo doble B0,
// docs/decisions/A8_M2_PREPARATION.md §7.1.3). Funciones con `fetch`
// inyectable para probarlas sin red.
//
// Mecanismo: rama HIJA de la rama de ensayo, con sus datos (`init_source:
// parent-data`) y SIN compute (sin `endpoints`): una copia copy-on-write que
// no cambia con lo que el ensayo escriba después en la rama de origen. Los
// snapshots manuales de Neon sólo se toman de ramas raíz; por eso el respaldo
// de una rama de ensayo (hija) es una rama.
//
// Sólo se llama DESPUÉS de verificar la identidad del origen (D-0,
// targetIdentity.ts): la rama de origen es la verificada, nunca la de por
// defecto. POST no es idempotente: ante un error de red no se reintenta a
// ciegas; se busca por nombre si la rama quedó creada.

import { NEON_API_BASE } from "./targetIdentity";

export interface NeonBranch {
  id: string;
  name: string;
  parent_id?: string | null;
  parent_lsn?: string | null;
  parent_timestamp?: string | null;
  default?: boolean;
  primary?: boolean;
  protected?: boolean;
  current_state?: string;
  created_at?: string;
}

export interface BranchBackupPlan {
  projectId: string;
  source: { id: string; name: string; isRoot: boolean };
  backupName: string;
  /** Cuerpo exacto del POST /projects/{projectId}/branches. */
  request: { branch: { name: string; parent_id: string; init_source: "parent-data" } };
  existingWithSameName: string[];
  branchCount: number;
}

type Fetch = typeof fetch;

async function call(fetchImpl: Fetch, apiKey: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetchImpl(`${NEON_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`API de Neon respondió ${response.status} en ${method} ${path}.`);
  return (await response.json()) as Record<string, unknown>;
}

export const backupBranchName = (sourceName: string, dateKey: string) => `${sourceName}-a8-backup-${dateKey.replace(/-/g, "")}`;

/** Sólo lectura: estado de la rama de origen ya verificada y ramas existentes del proyecto. */
export async function planBranchBackup(input: { apiKey: string; projectId: string; sourceBranchId: string; dateKey: string; fetchImpl?: Fetch }): Promise<BranchBackupPlan> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const project = encodeURIComponent(input.projectId);
  const source = (await call(fetchImpl, input.apiKey, "GET", `/projects/${project}/branches/${encodeURIComponent(input.sourceBranchId)}`)).branch as NeonBranch | undefined;
  if (!source?.id || !source.name) throw new Error("La API de Neon no devolvió la rama de origen.");
  if (source.id !== input.sourceBranchId) throw new Error(`La API devolvió la rama ${source.id}, no ${input.sourceBranchId}.`);
  if (source.default === true || source.primary === true) throw new Error(`La rama "${source.name}" es la rama por defecto: no es una rama de ensayo.`);
  const branches = ((await call(fetchImpl, input.apiKey, "GET", `/projects/${project}/branches`)).branches ?? []) as NeonBranch[];
  const backupName = backupBranchName(source.name, input.dateKey);
  return {
    projectId: input.projectId,
    source: { id: source.id, name: source.name, isRoot: !source.parent_id },
    backupName,
    request: { branch: { name: backupName, parent_id: source.id, init_source: "parent-data" } },
    existingWithSameName: branches.filter((branch) => branch.name === backupName).map((branch) => branch.id),
    branchCount: branches.length,
  };
}

export interface BranchBackupRecord {
  projectId: string;
  source: { id: string; name: string };
  backup: { id: string; name: string; parentId: string; parentLsn: string | null; parentTimestamp: string | null; createdAt: string | null; hasCompute: false };
  operations: Array<{ id: string; action: string; status: string }>;
  createdAt: string;
}

/**
 * Crea la rama de respaldo (sin compute) y verifica su origen: `parent_id`
 * igual a la rama verificada y nombre exacto. Falla si ya existe una rama con
 * ese nombre (no se pisa ni se reutiliza un respaldo previo).
 */
export async function createBranchBackup(plan: BranchBackupPlan, input: { apiKey: string; fetchImpl?: Fetch; now?: () => Date }): Promise<BranchBackupRecord> {
  if (plan.existingWithSameName.length) throw new Error(`Ya existe una rama "${plan.backupName}" (${plan.existingWithSameName.join(", ")}): no se crea otra ni se reutiliza.`);
  const fetchImpl = input.fetchImpl ?? fetch;
  const created = await call(fetchImpl, input.apiKey, "POST", `/projects/${encodeURIComponent(plan.projectId)}/branches`, plan.request);
  const branch = created.branch as NeonBranch | undefined;
  if (!branch?.id) throw new Error("La API de Neon no devolvió la rama creada.");
  if (branch.parent_id !== plan.source.id) throw new Error(`La rama creada ${branch.id} tiene origen ${branch.parent_id}, no ${plan.source.id}.`);
  if (branch.name !== plan.backupName) throw new Error(`La rama creada se llama "${branch.name}", no "${plan.backupName}".`);
  if (Array.isArray(created.endpoints) && created.endpoints.length) throw new Error("La rama de respaldo no debía tener compute.");
  const operations = ((created.operations ?? []) as Array<{ id: string; action: string; status: string }>).map(({ id, action, status }) => ({ id, action, status }));
  return {
    projectId: plan.projectId,
    source: { id: plan.source.id, name: plan.source.name },
    backup: { id: branch.id, name: branch.name, parentId: branch.parent_id, parentLsn: branch.parent_lsn ?? null, parentTimestamp: branch.parent_timestamp ?? null, createdAt: branch.created_at ?? null, hasCompute: false },
    operations,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

/** Relectura de la rama de respaldo (después de que terminen sus operaciones): existe, origen correcto, estado listo. */
export async function verifyBranchBackup(record: BranchBackupRecord, input: { apiKey: string; fetchImpl?: Fetch }) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const branch = (await call(fetchImpl, input.apiKey, "GET", `/projects/${encodeURIComponent(record.projectId)}/branches/${encodeURIComponent(record.backup.id)}`)).branch as NeonBranch | undefined;
  if (!branch?.id) throw new Error(`La rama de respaldo ${record.backup.id} no existe.`);
  if (branch.parent_id !== record.source.id) throw new Error(`La rama de respaldo tiene origen ${branch.parent_id}, no ${record.source.id}.`);
  return { id: branch.id, name: branch.name, parentId: branch.parent_id, parentLsn: branch.parent_lsn ?? null, currentState: branch.current_state ?? null, ready: branch.current_state === "ready" };
}
