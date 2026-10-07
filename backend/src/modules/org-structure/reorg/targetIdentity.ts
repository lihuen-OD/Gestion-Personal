// Compuerta de destino de los scripts de reorganización
// (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5.3). Distingue dos
// comprobaciones con credenciales distintas:
//
// 1. Conexión PostgreSQL (DATABASE_URL de un --env-file explícito): permite
//    consultar datos. Su host se compara con --expected-host. Necesaria
//    siempre, pero NO prueba qué rama de Neon es.
// 2. Credencial administrativa de Neon (NEON_API_KEY): permite comprobar con
//    la API de Neon que el endpoint del host pertenece al proyecto y a la rama
//    esperados, y que esa rama no es la rama por defecto (producción).
//
// Los modos de sólo lectura (inventario, manifiesto) pueden correr con la
// identidad NO VERIFICADA, dejándolo explícito en su reporte. La limpieza y
// la restauración exigen identidad VERIFICADA: sin credencial administrativa
// no escriben (requireVerifiedIdentity), y no hay flag para saltearlo.

export const NEON_API_BASE = "https://console.neon.tech/api/v2";

export function hostOf(databaseUrl: string): string {
  return new URL(databaseUrl).hostname;
}

/** `ep-rough-river-aioy7xp9-pooler.c-4.us-east-1.aws.neon.tech` → `ep-rough-river-aioy7xp9`. */
export function neonEndpointIdOf(host: string): string | null {
  const match = /^(ep-[a-z0-9-]+?)(-pooler)?\./.exec(host);
  return match?.[1] ?? null;
}

/** El host del endpoint en la API de Neon no lleva el sufijo `-pooler`. */
export function directHostOf(host: string): string {
  return host.replace(/^(ep-[a-z0-9-]+?)-pooler\./, "$1.");
}

export function assertExpectedHost(databaseUrl: string, expectedHost: string | undefined) {
  if (!expectedHost) throw new Error("Falta --expected-host: el destino debe declararse explícitamente.");
  const host = hostOf(databaseUrl);
  if (host !== expectedHost) throw new Error(`Destino inesperado: la conexión apunta a ${host} y se esperaba ${expectedHost}. No se ejecutó nada.`);
  return host;
}

export type NeonIdentity =
  | { status: "VERIFIED"; projectId: string; endpointId: string; branchId: string; branchName: string; isDefaultBranch: false; checkedAt: string }
  | { status: "NOT_VERIFIED"; endpointId: string | null; reason: string; pendingCheck: string };

export interface NeonIdentityInput {
  databaseUrl: string;
  apiKey?: string;
  projectId?: string;
  expectedBranchId?: string;
  expectedBranchName?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const PENDING_CHECK =
  "Con NEON_API_KEY: GET /projects/{projectId}/endpoints/{endpointId} debe devolver branch_id = --expected-branch-id y host = host directo de la conexión; " +
  "GET /projects/{projectId}/branches/{branchId} debe devolver name = --expected-branch-name y default = false.";

async function getJson(fetchImpl: typeof fetch, apiKey: string, path: string) {
  const response = await fetchImpl(`${NEON_API_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`API de Neon respondió ${response.status} en ${path}. No se pudo comprobar la identidad.`);
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Comprueba la identidad de proyecto y rama. Devuelve NOT_VERIFIED si falta
 * la credencial administrativa o algún dato esperado (los modos de lectura
 * pueden seguir y lo informan). Lanza si la API responde algo que NO coincide
 * con lo esperado: una discrepancia nunca se degrada a "no verificado".
 */
export async function verifyNeonIdentity(input: NeonIdentityInput): Promise<NeonIdentity> {
  const host = hostOf(input.databaseUrl);
  const endpointId = neonEndpointIdOf(host);
  const missing = [
    !input.apiKey && "NEON_API_KEY (credencial administrativa de Neon)",
    !input.projectId && "--neon-project-id",
    !input.expectedBranchId && "--expected-branch-id",
    !input.expectedBranchName && "--expected-branch-name",
    !endpointId && "un host de endpoint Neon reconocible",
  ].filter(Boolean) as string[];
  if (missing.length) {
    return { status: "NOT_VERIFIED", endpointId, reason: `Falta: ${missing.join(", ")}.`, pendingCheck: PENDING_CHECK };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const apiKey = input.apiKey!;
  const projectId = input.projectId!;
  const endpointBody = await getJson(fetchImpl, apiKey, `/projects/${encodeURIComponent(projectId)}/endpoints/${encodeURIComponent(endpointId!)}`);
  const endpoint = endpointBody.endpoint as { id?: string; host?: string; branch_id?: string; project_id?: string } | undefined;
  if (!endpoint?.branch_id) throw new Error("La API de Neon no devolvió el endpoint esperado.");
  if (endpoint.project_id && endpoint.project_id !== projectId) throw new Error(`El endpoint ${endpointId} pertenece al proyecto ${endpoint.project_id}, no a ${projectId}.`);
  if (endpoint.host && endpoint.host !== directHostOf(host)) throw new Error(`El host del endpoint (${endpoint.host}) no coincide con el de la conexión (${host}).`);
  if (endpoint.branch_id !== input.expectedBranchId) throw new Error(`El endpoint ${endpointId} pertenece a la rama ${endpoint.branch_id}, no a la esperada ${input.expectedBranchId}.`);

  const branchBody = await getJson(fetchImpl, apiKey, `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(endpoint.branch_id)}`);
  const branch = branchBody.branch as { id?: string; name?: string; default?: boolean; primary?: boolean } | undefined;
  if (!branch?.name) throw new Error("La API de Neon no devolvió la rama esperada.");
  if (branch.name !== input.expectedBranchName) throw new Error(`La rama ${endpoint.branch_id} se llama "${branch.name}", no "${input.expectedBranchName}".`);
  if (branch.default === true || branch.primary === true) throw new Error(`La rama "${branch.name}" es la rama por defecto del proyecto: estos scripts nunca la usan.`);

  return {
    status: "VERIFIED",
    projectId,
    endpointId: endpointId!,
    branchId: endpoint.branch_id,
    branchName: branch.name,
    isDefaultBranch: false,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

/** Modos de escritura: sin identidad verificada no se escribe nada. */
export function requireVerifiedIdentity(identity: NeonIdentity): asserts identity is Extract<NeonIdentity, { status: "VERIFIED" }> {
  if (identity.status !== "VERIFIED") {
    throw new Error(`Identidad de rama Neon NO verificada (${identity.reason}) La limpieza y la restauración no escriben sin esta comprobación. Pendiente: ${identity.pendingCheck}`);
  }
}
