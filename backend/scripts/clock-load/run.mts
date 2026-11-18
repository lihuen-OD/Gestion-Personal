/**
 * Pruebas de carga y concurrencia del fichador (§33 de
 * docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md). SÓLO local:
 *
 *   CLOCK_LOAD_DATABASE_URL=postgresql://<user>@localhost:5432/clock_load \
 *   CLOCK_LOAD_WORKDIR=<directorio temporal> \
 *   npx tsx scripts/clock-load/run.mts --scenarios=s30_1dev,special [--port=4021] [--backend-dir=<otro backend>]
 *
 * - La base debe ser local y llamarse clock_load* (con el historial de
 *   migraciones aplicado: scripts/ci/migrate-clean-database.ts). Se siembran
 *   empleados y dispositivos sintéticos (legajo LOAD-*); nada real.
 * - El backend bajo prueba se lanza aislado (isolation.mts): fotos en disco
 *   dentro de CLOCK_LOAD_WORKDIR, sin .env, sin Object Storage ni Neon.
 * - Los escenarios de volumen corren en tiempo real (ventanas de 5 min, como
 *   los cupos): cada uno usa dispositivos e IPs propios.
 * - Resultado: JSON por escenario y un resumen en CLOCK_LOAD_WORKDIR/results.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { generateClockDeviceSecret, hashClockDeviceSecret } from "../../src/shared/security/clockDeviceCredentials.ts";
import { assertLoadDatabaseUrl, assertLocalBaseUrl, listFiles, processUsage, startIsolatedBackend, type IsolatedBackend } from "./isolation.mts";
import { LoadClient, journey, punch, sleep, type ClientMode, type JourneyResult, type RequestRecord, type SyntheticEmployee, type VirtualDevice } from "./kiosk.mts";

const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=") as [string, string]));
const databaseUrl = assertLoadDatabaseUrl(process.env.CLOCK_LOAD_DATABASE_URL);
const workDir = process.env.CLOCK_LOAD_WORKDIR ?? "";
if (!workDir) throw new Error("CLOCK_LOAD_WORKDIR es obligatoria (directorio temporal fuera del repo).");
const port = Number(args.get("port") || 4021);
const resultsDir = join(workDir, "results");
mkdirSync(resultsDir, { recursive: true });

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const SUCCESS_RESET_MS = 3_500;
const WINDOW_MS = 5 * 60_000;

// ---------------------------------------------------------------- seed
const SURNAMES = ["Gonzalez", "Rodriguez", "Gomez", "Fernandez", "Lopez", "Diaz", "Martinez", "Perez", "Garcia", "Sanchez", "Romero", "Sosa", "Alvarez", "Torres", "Ruiz", "Ramirez", "Flores", "Acosta", "Benitez", "Medina", "Suarez", "Herrera", "Aguirre", "Pereyra", "Gutierrez", "Gimenez", "Molina", "Silva", "Castro", "Rojas", "Ortiz", "Nuñez", "Luna", "Juarez", "Cabrera", "Rios", "Ferreyra", "Godoy", "Morales", "Dominguez", "Moreno", "Peralta", "Vega", "Carrizo", "Quiroga", "Castillo", "Ledesma", "Muñoz", "Ojeda", "Ponce", "De la Fuente", "Del Valle", "San Martín", "Peña"];
const FIRST_NAMES = ["Juan", "María", "Carlos", "Ana", "Jorge", "Laura", "Luis", "Silvia", "Miguel", "Patricia", "José", "Claudia", "Daniel", "Andrea", "Pablo", "Gabriela", "Diego", "Mariana", "Sergio", "Lucía", "Martín", "Valeria", "Hernán", "Romina", "Ricardo", "Florencia", "Juan Pablo", "Ana María", "María José", "Luis Alberto"];
const MIDDLE = ["", "Ezequiel", "Beatriz", "Ignacio", "Soledad"];
const POOL_SIZE = 640;

async function seedEmployees(): Promise<SyntheticEmployee[]> {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  if (!/^clock_load[a-z0-9_]*$/.test(db)) throw new Error(`Abortado: conectado a ${db}.`);
  const existing = await prisma.employee.count({ where: { legajo: { startsWith: "LOAD-" } } });
  if (existing < POOL_SIZE) {
    for (let index = existing; index < POOL_SIZE; index += 1) {
      const number = 90_000_000 + index * 37;
      const plain = String(number);
      // DNI guardado como texto libre: con puntos, sin separadores o con espacios.
      const dni = index % 3 === 0 ? `${plain.slice(0, 2)}.${plain.slice(2, 5)}.${plain.slice(5)}` : index % 3 === 1 ? plain : `${plain.slice(0, 2)} ${plain.slice(2, 5)} ${plain.slice(5)}`;
      const middle = MIDDLE[Math.floor(index / 150) % MIDDLE.length];
      await prisma.employee.create({
        data: {
          legajo: `LOAD-${String(index + 1).padStart(4, "0")}`,
          cuil: `20-${plain}-${index % 10}`,
          dni,
          firstName: `${FIRST_NAMES[(index * 7) % FIRST_NAMES.length]}${middle ? ` ${middle}` : ""}`,
          lastName: SURNAMES[index % SURNAMES.length]!,
          status: "ACTIVO",
        },
      });
    }
  }
  const rows = await prisma.employee.findMany({ where: { legajo: { startsWith: "LOAD-" } }, orderBy: { legajo: "asc" }, select: { id: true, firstName: true, lastName: true, dni: true } });
  return rows.map((row) => ({ ...row, dni: row.dni }));
}

let employeeCursor = 0;
let pool: SyntheticEmployee[] = [];
function takeEmployees(count: number) {
  const picked: SyntheticEmployee[] = [];
  for (let index = 0; index < count; index += 1) picked.push(pool[(employeeCursor + index) % pool.length]!);
  employeeCursor = (employeeCursor + count) % pool.length;
  return picked;
}

async function createDevices(label: string, count: number, ips: string[], status: "ACTIVE" | "REVOKED" = "ACTIVE"): Promise<VirtualDevice[]> {
  const devices: VirtualDevice[] = [];
  for (let index = 0; index < count; index += 1) {
    const secret = generateClockDeviceSecret();
    const created = await prisma.clockDevice.create({
      data: { name: `LOAD ${label} ${index + 1}`, status, tokenHash: hashClockDeviceSecret(secret), activatedAt: new Date(), ...(status === "REVOKED" ? { revokedAt: new Date() } : {}) },
    });
    devices.push({ id: created.id, secret, ip: ips[index % ips.length]! });
  }
  return devices;
}

// ---------------------------------------------------------------- muestreo
type Sample = { at: number; connections: number; active: number; cpu?: number; rssMb?: number };
function startSampler(backend: IsolatedBackend) {
  const samples: Sample[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const [row] = await prisma.$queryRaw<Array<{ total: bigint; active: bigint }>>`
        SELECT count(*) AS total, count(*) FILTER (WHERE state = 'active') AS active
        FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`;
      const usage = processUsage(backend.pid);
      // El propio runner usa 1 conexión para estos controles: se descuenta.
      samples.push({ at: Date.now(), connections: Math.max(0, Number(row!.total) - 1), active: Number(row!.active), cpu: usage?.cpu, rssMb: usage?.rssMb });
      await sleep(500);
    }
  })();
  return { samples, stop: async () => { running = false; await loop; } };
}

// ---------------------------------------------------------------- estadística
const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!.toFixed(1));
};
const latency = (values: number[]) => ({ n: values.length, p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), max: values.length ? Number(Math.max(...values).toFixed(1)) : null });

function requestSummary(records: RequestRecord[]) {
  const byOp: Record<string, unknown> = {};
  for (const op of ["search", "status", "punch", "attempt", "heartbeat"] as const) {
    const items = records.filter((record) => record.op === op);
    if (items.length === 0) continue;
    const statuses: Record<string, number> = {};
    for (const item of items) statuses[item.code ? `${item.status} ${item.code}` : String(item.status)] = (statuses[`${item.code ? `${item.status} ${item.code}` : String(item.status)}`] ?? 0) + 1;
    byOp[op] = { ...latency(items.filter((item) => item.status > 0 && item.status < 400).map((item) => item.ms)), statuses };
  }
  return {
    total: records.length,
    status429: records.filter((record) => record.status === 429).length,
    status5xx: records.filter((record) => record.status >= 500).length,
    networkErrors: records.filter((record) => record.status < 0).length,
    byOp,
  };
}

function backendTelemetry(logPath: string, fromOffset: number, requestIds: Set<string>) {
  const content = readFileSync(logPath, "utf8").slice(fromOffset);
  const phases: Record<string, number[]> = {};
  const budgets: number[] = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: { event?: string; requestId?: string; phase?: string; durationMs?: number; total?: number };
    try { event = JSON.parse(line); } catch { continue; }
    if (!event.requestId || !requestIds.has(event.requestId)) continue;
    if (event.event === "clock_punch_query_budget" && typeof event.total === "number") budgets.push(event.total);
    if (event.event === "clock_punch_timing" && event.phase && typeof event.durationMs === "number") (phases[event.phase] ??= []).push(event.durationMs);
  }
  const pick = ["employee_context", "attempt_creation", "primary_upload", "transaction_acquire", "transaction_core", "http_response_write"];
  return {
    queriesPerPunch: budgets.length ? { n: budgets.length, avg: Number((budgets.reduce((a, b) => a + b, 0) / budgets.length).toFixed(1)), max: Math.max(...budgets) } : null,
    phasesMs: Object.fromEntries(pick.filter((phase) => phases[phase]).map((phase) => [phase, latency(phases[phase]!)])),
  };
}

// ---------------------------------------------------------------- consistencia
async function consistency(backend: IsolatedBackend, scenarioStart: Date, journeys: Array<{ employeeId: string; outcome: { kind: string; requestId?: string; sha256?: string } }>, sentRequestIds: string[]) {
  const successes = journeys.filter((item) => item.outcome.kind === "success") as Array<{ employeeId: string; outcome: { kind: "success"; requestId: string; sha256: string } }>;
  const employeeIds = [...new Set(journeys.map((item) => item.employeeId))];
  // Post-proceso durable: esperar a que se drene (máx. 120 s).
  const drainStart = Date.now();
  let pendingJobs = 0;
  for (;;) {
    pendingJobs = await prisma.clockPunchPostProcessJob.count({ where: { employeeId: { in: employeeIds }, createdAt: { gte: scenarioStart }, status: { notIn: ["COMPLETED"] } } });
    if (pendingJobs === 0 || Date.now() - drainStart > 120_000) break;
    await sleep(1_000);
  }
  const failedJobs = await prisma.clockPunchPostProcessJob.count({ where: { employeeId: { in: employeeIds }, createdAt: { gte: scenarioStart }, status: "FAILED" } });
  const punches = await prisma.attendancePunch.findMany({ where: { employeeId: { in: employeeIds }, createdAt: { gte: scenarioStart } }, select: { id: true, employeeId: true, photoStoragePath: true } });
  const expectedPerEmployee = new Map<string, number>();
  for (const item of successes) expectedPerEmployee.set(item.employeeId, (expectedPerEmployee.get(item.employeeId) ?? 0) + 1);
  const actualPerEmployee = new Map<string, number>();
  for (const item of punches) actualPerEmployee.set(item.employeeId, (actualPerEmployee.get(item.employeeId) ?? 0) + 1);
  let duplicates = 0;
  let missing = 0;
  for (const employeeId of employeeIds) {
    const diff = (actualPerEmployee.get(employeeId) ?? 0) - (expectedPerEmployee.get(employeeId) ?? 0);
    if (diff > 0) duplicates += diff;
    if (diff < 0) missing -= diff;
  }
  const openShifts = await prisma.workShift.groupBy({ by: ["employeeId"], where: { employeeId: { in: employeeIds }, status: "ABIERTO" }, _count: { _all: true } });
  const attempts = await prisma.clockPunchAttempt.groupBy({ by: ["status"], where: { requestId: { in: sentRequestIds } }, _count: { _all: true } });

  // Fotos: cada fichada confirmada tiene su archivo, con el hash enviado y del empleado correcto.
  let photoOk = 0;
  const photoProblems: string[] = [];
  for (const item of successes) {
    const files = await prisma.storageFile.findMany({ where: { metadata: { path: ["requestId"], equals: item.outcome.requestId } }, select: { storageKey: true, employeeId: true } });
    if (files.length !== 1) { photoProblems.push(`${item.outcome.requestId}: ${files.length} StorageFile`); continue; }
    const file = files[0]!;
    if (file.employeeId !== item.employeeId) { photoProblems.push(`${item.outcome.requestId}: StorageFile de otro empleado`); continue; }
    const path = join(backend.uploadsDir, file.storageKey);
    if (!existsSync(path)) { photoProblems.push(`${item.outcome.requestId}: archivo inexistente`); continue; }
    const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (sha !== item.outcome.sha256) { photoProblems.push(`${item.outcome.requestId}: hash distinto`); continue; }
    const owner = punches.find((punchRow) => punchRow.photoStoragePath === file.storageKey);
    if (!owner || owner.employeeId !== item.employeeId) { photoProblems.push(`${item.outcome.requestId}: fichada con la foto de otro empleado o sin fichada`); continue; }
    photoOk += 1;
  }
  // Huérfanas: archivos de fichada en disco sin fichada que los referencie.
  const referenced = new Set((await prisma.attendancePunch.findMany({ where: { photoStoragePath: { not: null } }, select: { photoStoragePath: true } })).map((row) => join(backend.uploadsDir, row.photoStoragePath!)));
  const since = scenarioStart.getTime();
  const orphanFiles = listFiles(join(backend.uploadsDir, "attendance")).filter((path) => statSync(path).mtimeMs >= since && !referenced.has(path)).length;
  const orphanRows = await prisma.storageFile.count({ where: { createdAt: { gte: scenarioStart }, entityType: "ATTENDANCE_PUNCH", employeeId: { in: employeeIds }, storageKey: { notIn: [...referenced].map((path) => path.slice(backend.uploadsDir.length + 1)) } } });
  return {
    confirmedJourneys: successes.length,
    punchesInDb: punches.length,
    duplicates,
    missing,
    employeesWithMoreThanOneOpenShift: openShifts.filter((row) => row._count._all > 1).length,
    attempts: Object.fromEntries(attempts.map((row) => [row.status, row._count._all])),
    photos: { ok: photoOk, problems: photoProblems.slice(0, 10), problemCount: photoProblems.length, orphanFiles, orphanStorageRows: orphanRows },
    postProcess: { pendingAfterDrain: pendingJobs, failed: failedJobs, drainMs: Date.now() - drainStart },
  };
}

// ---------------------------------------------------------------- escenarios de volumen
type VolumeScenario = { name: string; punches: number; devices: number; ips: number; arrival: "queued" | "uniform"; mode: ClientMode; dniShare: number; description: string };
const VOLUME: Record<string, VolumeScenario> = {
  s30_1dev: { name: "s30_1dev", punches: 30, devices: 1, ips: 1, arrival: "queued", mode: "cache", dniShare: 0.3, description: "30 personas en fila frente a 1 equipo" },
  s30_3dev: { name: "s30_3dev", punches: 30, devices: 3, ips: 1, arrival: "queued", mode: "cache", dniShare: 0.3, description: "30 personas, 3 equipos detrás de 1 IP" },
  s30_legacy: { name: "s30_legacy", punches: 30, devices: 1, ips: 1, arrival: "queued", mode: "legacy", dniShare: 0.3, description: "30 personas en 1 equipo con el buscador previo (sin caché)" },
  // Línea de base contra el código ANTERIOR a §33 (--backend-dir=<worktree de HEAD>): buscador sin caché y sólo por nombre.
  base30: { name: "base30", punches: 30, devices: 1, ips: 1, arrival: "queued", mode: "legacy", dniShare: 0, description: "línea de base: 30 personas en 1 equipo, código y cliente previos a §33" },
  s30_keystroke: { name: "s30_keystroke", punches: 30, devices: 1, ips: 1, arrival: "queued", mode: "keystroke", dniShare: 0.3, description: "búsqueda intensiva: 1 consulta por tecla, 1 equipo" },
  s100_dist: { name: "s100_dist", punches: 100, devices: 10, ips: 10, arrival: "uniform", mode: "cache", dniShare: 0.3, description: "100 en 5 min, 10 equipos con IP propia" },
  s100_1ip: { name: "s100_1ip", punches: 100, devices: 10, ips: 1, arrival: "uniform", mode: "cache", dniShare: 0.3, description: "100 en 5 min, 10 equipos detrás de 1 IP" },
  s100_2ip: { name: "s100_2ip", punches: 100, devices: 10, ips: 2, arrival: "uniform", mode: "cache", dniShare: 0.3, description: "100 en 5 min, 10 equipos detrás de 2 IP" },
  s150: { name: "s150", punches: 150, devices: 15, ips: 3, arrival: "uniform", mode: "cache", dniShare: 0.3, description: "estrés: 150 en 5 min, 15 equipos, 3 IP" },
  s200_1ip: { name: "s200_1ip", punches: 200, devices: 20, ips: 1, arrival: "uniform", mode: "cache", dniShare: 0.3, description: "estrés: 200 en 5 min, 20 equipos detrás de 1 IP" },
  s200_dist: { name: "s200_dist", punches: 200, devices: 20, ips: 20, arrival: "uniform", mode: "cache", dniShare: 0.3, description: "estrés: 200 en 5 min, 20 equipos con IP propia" },
};

let scenarioIndex = 0;
const ipsFor = (count: number) => { scenarioIndex += 1; return Array.from({ length: count }, (_, index) => `100.64.${scenarioIndex}.${index + 1}`); };

async function runVolume(backend: IsolatedBackend, def: VolumeScenario) {
  const devices = await createDevices(def.name, def.devices, ipsFor(def.ips));
  const employees = takeEmployees(def.punches);
  const client = new LoadClient(backend.baseUrl, def.name);
  const logOffset = statSync(backend.logPath).size;
  const scenarioStart = new Date();
  const t0 = Date.now();
  const sampler = startSampler(backend);
  // Heartbeat: 1 por minuto por equipo, como la PWA.
  let heartbeats = true;
  const heartbeatLoops = devices.map(async (device, index) => {
    await sleep((index * 997) % 60_000);
    while (heartbeats) {
      await client.call(device, "heartbeat", "POST", "/clock/heartbeat");
      for (let waited = 0; waited < 60_000 && heartbeats; waited += 1_000) await sleep(1_000);
    }
  });
  const queues = devices.map(() => [] as Array<{ employee: SyntheticEmployee; arrivesAt: number; byDni: boolean }>);
  employees.forEach((employee, index) => {
    const arrivesAt = def.arrival === "queued" ? t0 : t0 + Math.random() * WINDOW_MS * 0.8;
    queues[index % devices.length]!.push({ employee, arrivesAt, byDni: Math.random() < def.dniShare });
  });
  for (const queue of queues) queue.sort((a, b) => a.arrivesAt - b.arrivesAt);
  const results: JourneyResult[] = [];
  await Promise.all(devices.map(async (device, deviceIndex) => {
    for (const item of queues[deviceIndex]!) {
      await sleep(item.arrivesAt - Date.now());
      const result = await journey(client, device, item.employee, { mode: def.mode, byDni: item.byDni, arrivedAt: item.arrivesAt, cameraMs: [2_000, 3_500] });
      results.push(result);
      await sleep(result.outcome.kind === "success" ? SUCCESS_RESET_MS : 1_500);
    }
  }));
  heartbeats = false;
  await Promise.all(heartbeatLoops);
  await sampler.stop();
  const elapsedMs = Date.now() - t0;
  const requestIds = results.flatMap((item) => ("requestId" in item.outcome ? [item.outcome.requestId] : []));
  const checks = await consistency(backend, scenarioStart, results as never, requestIds);
  const finishedWithinWindow = results.filter((item) => item.outcome.kind === "success" && item.finishedAt - t0 <= WINDOW_MS).length;
  const searchesPerPerson = results.map((item) => item.search.requests);
  const report = {
    scenario: def,
    elapsedMs,
    confirmed: results.filter((item) => item.outcome.kind === "success").length,
    confirmedWithinFiveMinutes: finishedWithinWindow,
    outcomes: results.reduce<Record<string, number>>((acc, item) => {
      const key = item.outcome.kind === "failed" ? `failed ${item.outcome.status} ${item.outcome.code ?? ""}`.trim() : item.outcome.kind === "status-failed" ? `status-failed ${item.outcome.status} ${item.outcome.code ?? ""}`.trim() : item.outcome.kind;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    recoveredWithSameRequestId: results.filter((item) => item.outcome.kind === "success" && item.outcome.recovered).length,
    journeyMs: latency(results.filter((item) => item.outcome.kind === "success").map((item) => item.finishedAt - item.startedAt)),
    waitInQueueMs: latency(results.map((item) => item.startedAt - item.arrivedAt)),
    searchRequestsPerPerson: { avg: Number((searchesPerPerson.reduce((a, b) => a + b, 0) / Math.max(1, searchesPerPerson.length)).toFixed(2)), max: Math.max(0, ...searchesPerPerson), localHitsAvg: Number((results.reduce((a, item) => a + item.search.localHits, 0) / Math.max(1, results.length)).toFixed(2)) },
    requests: requestSummary(client.records),
    requestsPerIpMax: Math.max(...Object.values(client.records.reduce<Record<string, number>>((acc, record) => { acc[record.ip] = (acc[record.ip] ?? 0) + 1; return acc; }, {}))),
    database: { connectionsMax: Math.max(0, ...sampler.samples.map((sample) => sample.connections)), activeMax: Math.max(0, ...sampler.samples.map((sample) => sample.active)) },
    backendProcess: { cpuMaxPct: Math.max(0, ...sampler.samples.map((sample) => sample.cpu ?? 0)), cpuAvgPct: Number((sampler.samples.reduce((a, sample) => a + (sample.cpu ?? 0), 0) / Math.max(1, sampler.samples.length)).toFixed(1)), rssMaxMb: Number(Math.max(0, ...sampler.samples.map((sample) => sample.rssMb ?? 0)).toFixed(1)) },
    telemetry: backendTelemetry(backend.logPath, logOffset, new Set(requestIds)),
    consistency: checks,
  };
  writeFileSync(join(resultsDir, `${def.name}.json`), JSON.stringify(report, null, 2));
  return report;
}

// ---------------------------------------------------------------- escenarios funcionales y de abuso
/** Como el fichador: el tipo de fichada sale de la jornada confirmada. */
async function nextPunchType(client: LoadClient, device: VirtualDevice, employeeId: string): Promise<"IN" | "OUT"> {
  const status = await client.call(device, "status", "POST", "/clock/status", { body: { employeeId } });
  return (status.data as { openShift: unknown } | undefined)?.openShift ? "OUT" : "IN";
}

async function runSpecial(backend: IsolatedBackend) {
  const out: Record<string, unknown> = {};
  const client = new LoadClient(backend.baseUrl, "special");
  const logOffset = statSync(backend.logPath).size;
  const start = new Date();

  // 7. Dispositivo revocado: 403 en todo, ninguna fichada.
  {
    const [revoked] = await createDevices("revocado", 1, ipsFor(1), "REVOKED");
    const [employee] = takeEmployees(1);
    const results = [
      await client.call(revoked!, "search", "GET", "/clock/employees?search=go"),
      await client.call(revoked!, "status", "POST", "/clock/status", { body: { employeeId: employee!.id } }),
      await punch(client, revoked!, employee!.id, "IN"),
      await client.call(revoked!, "heartbeat", "POST", "/clock/heartbeat"),
    ];
    const punches = await prisma.attendancePunch.count({ where: { employeeId: employee!.id, createdAt: { gte: start } } });
    out.revokedDevice = { responses: results.map((result) => ("status" in result ? `${result.status} ${result.code ?? ""}`.trim() : result.kind)), punches };
  }

  // 8. Recuperación con el mismo requestId: reenvío idéntico → el mismo resultado, una sola fichada.
  {
    const [device] = await createDevices("recuperacion", 1, ipsFor(1));
    const employees = takeEmployees(10);
    const rows = [];
    for (const employee of employees) {
      const requestId = randomUUID();
      const type = await nextPunchType(client, device!, employee.id);
      const first = await punch(client, device!, employee.id, type, { requestId });
      // Mismo requestId con OTRO payload: debe rechazarse sin crear nada.
      const again = await client.call(device!, "punch", "POST", "/clock/photo-punch", { body: { requestId, employeeId: employee.id, punchType: type, photo: (await import("./kiosk.mts")).syntheticPhoto().photo, faceValidationStatus: "VALID" } });
      const attempt = await client.call(device!, "attempt", "GET", `/clock/attempts/${requestId}?employeeId=${employee.id}`);
      rows.push({ first: first.kind, resendDifferentPayload: `${again.status} ${again.code ?? ""}`.trim(), attempt: (attempt.data as { status?: string } | undefined)?.status });
    }
    // Reenvío del MISMO payload (lo que hace la PWA) sobre otra fichada.
    const [employee] = takeEmployees(1);
    const photo = (await import("./kiosk.mts")).syntheticPhoto();
    const requestId = randomUUID();
    const type = await nextPunchType(client, device!, employee!.id);
    const one = await punch(client, device!, employee!.id, type, { requestId, photo });
    const two = await punch(client, device!, employee!.id, type, { requestId, photo });
    const punches = await prisma.attendancePunch.count({ where: { employeeId: { in: [...employees, employee!].map((item) => item.id) }, createdAt: { gte: start } } });
    out.requestIdRecovery = { rows, samePayloadTwice: [one.kind, two.kind], punchesInDb: punches, expected: employees.length + 1 };
  }

  // 9. Reintento después de timeout: el cliente corta a los 40 ms (el backend sigue), recupera por requestId.
  {
    const [device] = await createDevices("timeout", 1, ipsFor(1));
    const employees = takeEmployees(10);
    const outcomes = [];
    // Cortes entre 2 y 120 ms: unos antes de que llegue el body (el backend
    // no lo tiene → 404 → reenvío), otros con la fichada ya procesada (la
    // consulta del intento la encuentra COMPLETED).
    for (const [index, employee] of employees.entries()) outcomes.push(await punch(client, device!, employee.id, await nextPunchType(client, device!, employee.id), { timeoutMs: [2, 10, 25, 40, 60, 80, 100, 120][index % 8] }));
    const punches = await prisma.attendancePunch.count({ where: { employeeId: { in: employees.map((item) => item.id) }, createdAt: { gte: start } } });
    out.timeoutRetry = {
      outcomes: outcomes.map((item) => (item.kind === "success" ? `success recovered=${item.recovered} resends=${item.resends}` : item.kind)),
      punchesInDb: punches,
      expected: outcomes.filter((item) => item.kind === "success").length,
    };
  }

  // 10. Mismo empleado desde dos equipos a la vez: exactamente una fichada.
  {
    const [a, b] = await createDevices("doble", 2, ipsFor(2));
    const employees = takeEmployees(20);
    const pairs = await Promise.all(employees.map(async (employee) => {
      // Cada equipo vio la misma jornada y eligió la misma acción.
      const type = await nextPunchType(client, a!, employee.id);
      const [x, y] = await Promise.all([punch(client, a!, employee.id, type), punch(client, b!, employee.id, type)]);
      return [x, y].map((item) => (item.kind === "failed" ? `failed ${item.status} ${item.code}` : item.kind));
    }));
    const punches = await prisma.attendancePunch.groupBy({ by: ["employeeId"], where: { employeeId: { in: employees.map((item) => item.id) }, createdAt: { gte: start } }, _count: { _all: true } });
    const flat = pairs.flat();
    out.sameEmployeeTwoDevices = {
      employees: employees.length,
      successes: flat.filter((item) => item === "success").length,
      rejections: flat.filter((item) => item !== "success").reduce<Record<string, number>>((acc, item) => { acc[item] = (acc[item] ?? 0) + 1; return acc; }, {}),
      employeesWithMoreThanOnePunch: punches.filter((row) => row._count._all > 1).length,
    };
  }

  // 4. Ráfaga: 60 equipos detrás de 1 IP envían su fichada en el mismo instante.
  {
    const devices = await createDevices("rafaga", 60, ipsFor(1));
    const employees = takeEmployees(60);
    const statuses = await Promise.all(employees.map((employee, index) => client.call(devices[index]!, "status", "POST", "/clock/status", { body: { employeeId: employee.id } })));
    const burstStart = performance.now();
    const outcomes = await Promise.all(employees.map((employee, index) => punch(client, devices[index]!, employee.id, (statuses[index]!.data as { openShift: unknown } | undefined)?.openShift ? "OUT" : "IN")));
    const wallMs = performance.now() - burstStart;
    const checks = await consistency(backend, start, employees.map((employee, index) => ({ employeeId: employee.id, outcome: outcomes[index]! })), outcomes.map((item) => item.requestId));
    out.burst60 = {
      wallMs: Number(wallMs.toFixed(0)),
      confirmed: outcomes.filter((item) => item.kind === "success").length,
      failures: outcomes.filter((item) => item.kind !== "success").map((item) => (item.kind === "failed" ? `${item.status} ${item.code}` : item.kind)),
      punchMs: latency(outcomes.map((item) => item.ms)),
      duplicates: checks.duplicates,
      photos: checks.photos,
    };
  }

  // 6b. Abuso de búsqueda: un equipo agota su cupo de búsquedas; jornada y fichada siguen.
  {
    const [device] = await createDevices("abuso-busqueda", 1, ipsFor(1));
    const [employee] = takeEmployees(1);
    const codes: Record<string, number> = {};
    const terms = Array.from({ length: 480 }, (_, index) => ["go", "ma", "an", "pe", "lu", "ro", "fe", "di"][index % 8]!);
    for (let index = 0; index < terms.length; index += 10) {
      const batch = await Promise.all(terms.slice(index, index + 10).map((term) => client.call(device!, "search", "GET", `/clock/employees?search=${term}`)));
      for (const result of batch) codes[`${result.status} ${result.code ?? ""}`.trim()] = (codes[`${result.status} ${result.code ?? ""}`.trim()] ?? 0) + 1;
    }
    const status = await client.call(device!, "status", "POST", "/clock/status", { body: { employeeId: employee!.id } });
    const punched = await punch(client, device!, employee!.id, (status.data as { openShift: unknown } | undefined)?.openShift ? "OUT" : "IN");
    if (punched.kind !== "success") out.searchAbusePunchDetail = punched;
    out.searchAbuse = { searches: codes, statusAfter: status.status, punchAfter: punched.kind };
  }

  // Enumeración por DNI: un equipo con credencial válida recorre prefijos lo más rápido posible.
  {
    const [device] = await createDevices("enumeracion", 1, ipsFor(1));
    const harvested = new Set<string>();
    let allowed = 0;
    let firstBlockAt = 0;
    const started = Date.now();
    outer: for (let length = 2; length <= 4; length += 1) {
      for (let prefix = 10 ** (length - 1); prefix < 10 ** length; prefix += 1) {
        const result = await client.call(device!, "search", "GET", `/clock/employees?search=${prefix}`);
        if (result.status === 429) { firstBlockAt = Date.now() - started; break outer; }
        allowed += 1;
        for (const item of (result.data as Array<{ id: string }> | undefined) ?? []) harvested.add(item.id);
      }
    }
    out.enumeration = { allowedSearchesBeforeBlock: allowed, msUntilBlocked: firstBlockAt, distinctEmployeesSeen: harvested.size, poolSize: pool.length };
  }

  // Credenciales rechazadas: un equipo mal configurado no bloquea al vecino de la misma IP.
  {
    const [ip] = ipsFor(1);
    const [legit, misconfigured] = await createDevices("credenciales", 2, [ip!]);
    const wrong = `ClockDevice ${misconfigured!.id}.${generateClockDeviceSecret()}`;
    const codes: string[] = [];
    for (let index = 0; index < 15; index += 1) {
      const result = await client.call(misconfigured!, "heartbeat", "POST", "/clock/heartbeat", { authorization: wrong });
      codes.push(`${result.status}${result.code ? ` ${result.code}` : ""}`);
    }
    const neighbour = await client.call(legit!, "search", "GET", "/clock/employees?search=go");
    const otherWrong = await client.call(legit!, "search", "GET", "/clock/employees?search=go", { authorization: `ClockDevice ${legit!.id}.${generateClockDeviceSecret()}` });
    out.credentialFailures = { misconfigured: codes.reduce<Record<string, number>>((acc, code) => { acc[code] = (acc[code] ?? 0) + 1; return acc; }, {}), neighbourSameIp: neighbour.status, otherBadCredentialSameIp: otherWrong.status };
  }

  // Tope por IP: inundación sin credencial válida desde una red.
  {
    const [floodIp, otherIp] = ipsFor(2);
    const [onFlooded, onOther, unverified] = await createDevices("tope-ip", 3, [floodIp!, otherIp!, floodIp!]);
    // El equipo de esa red ya operaba antes de la inundación (credencial verificada).
    const before = await client.call(onFlooded!, "search", "GET", "/clock/employees?search=go");
    const codes: Record<string, number> = {};
    const fake: VirtualDevice = { id: "x", secret: "x", ip: floodIp! };
    for (let index = 0; index < 1_600; index += 20) {
      const batch = await Promise.all(Array.from({ length: 20 }, () => client.call(fake, "search", "GET", "/clock/employees?search=go", { authorization: "ClockDevice invalida" })));
      for (const result of batch) codes[`${result.status}${result.code ? ` ${result.code}` : ""}`] = (codes[`${result.status}${result.code ? ` ${result.code}` : ""}`] ?? 0) + 1;
    }
    const legitOnFlooded = await client.call(onFlooded!, "search", "GET", "/clock/employees?search=go");
    const legitElsewhere = await client.call(onOther!, "search", "GET", "/clock/employees?search=go");
    const neverVerified = await client.call(unverified!, "search", "GET", "/clock/employees?search=go");
    out.networkCap = {
      flood: codes,
      verifiedDeviceOnFloodedIp: { before: before.status, after: `${legitOnFlooded.status} ${legitOnFlooded.code ?? ""}`.trim() },
      neverVerifiedDeviceOnFloodedIp: `${neverVerified.status} ${neverVerified.code ?? ""}`.trim(),
      deviceOnOtherIp: legitElsewhere.status,
    };
  }

  void logOffset;
  out.requests = requestSummary(client.records.filter((record) => record.op !== "search" || record.status !== 401));
  writeFileSync(join(resultsDir, "special.json"), JSON.stringify(out, null, 2));
  return out;
}

// ---------------------------------------------------------------- paridad del buscador
/**
 * El filtrado local del fichador (employeeSearchCache) contra el backend REAL:
 * para cada texto tecleado, cada par (prefijo anterior → prefijo posterior) y
 * pares de subcadenas de DNI, si el caché responde, su respuesta debe ser
 * idéntica (mismos ids, mismo orden) a la del backend para esa consulta.
 */
const PARITY_PEOPLE: Array<[string, string, string]> = [
  ["Pérez", "José", "28.301.555"], ["Pérez-Gil", "Ana María", "28 301 556"], ["PEREZ", "JUAN", "28301557"],
  ["Peña", "Ñandú", "30-123-456"], ["Muñoz", "Agustín", "31.000.111"], ["D'Angelo", "Luca", "32123123"],
  ["De la Fuente", "María José", "33.333.333"], ["del Valle", "juan pablo", "34 444 444"], ["San Martín", "Ü Müller", "35.555.555"],
  ["Gonzalez", "Ana", "30.100.200"], ["González", "Ana", "30100201"], ["Gomez", "Ana Laura", "301.002.02"],
  ["Lopez Lopez", "Juan", "36.666.666"], ["O'Neill", "Sean", "37 777 777"], ["Ibáñez", "Íñigo", "38.888.888"],
  ["Kaplan", "Kelvin", "39.999.999"], ["\u212Aaplan", "Raro", "39.999.998"], ["Jose\u0301", "Nfd", "39.999.997"],
];

async function runParity(backend: IsolatedBackend) {
  const { createEmployeeSearchCache } = await import("../../../fichador/src/features/clock/employeeSearchCache.ts");
  for (const [index, [lastName, firstName, dni]] of PARITY_PEOPLE.entries()) {
    const legajo = `PAR-${String(index + 1).padStart(3, "0")}`;
    if (!(await prisma.employee.findUnique({ where: { legajo } }))) {
      await prisma.employee.create({ data: { legajo, cuil: `27-${80_000_000 + index}-1`, dni, firstName: JSON.parse(`"${firstName}"`), lastName: JSON.parse(`"${lastName}"`), status: "ACTIVO" } });
    }
  }
  const people = await prisma.employee.findMany({ where: { OR: [{ legajo: { startsWith: "PAR-" } }, { legajo: { in: Array.from({ length: 40 }, (_, index) => `LOAD-${String(index * 16 + 1).padStart(4, "0")}`) } }] }, select: { firstName: true, lastName: true, dni: true } });
  const strip = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const typed = new Set<string>();
  for (const person of people) {
    for (const text of [`${person.lastName} ${person.firstName}`, `${person.firstName} ${person.lastName}`, person.lastName, person.firstName, person.dni, person.dni.replace(/\D/g, "")]) {
      typed.add(text);
      typed.add(text.toLowerCase());
      typed.add(text.toUpperCase());
      typed.add(strip(text));
    }
  }
  const sequences = [...typed].map((text) => Array.from({ length: text.length }, (_, index) => text.slice(0, index + 1).trim()).filter((query, index, all) => query.length >= 2 && all.indexOf(query) === index));
  // Subcadenas de DNI (no prefijos): "1234" ⊃ "23".
  for (const person of people) {
    const digits = person.dni.replace(/\D/g, "");
    for (let start = 1; start + 2 <= digits.length; start += 2) sequences.push([digits.slice(start, start + 2), digits.slice(start - 1, start + 3), digits.slice(start - 1)]);
  }
  const queries = [...new Set(sequences.flat())];
  const devices = await createDevices("paridad", 60, ipsFor(20));
  const client = new LoadClient(backend.baseUrl, "parity");
  const server = new Map<string, Array<{ id: string; dni: string | null; firstName: string; lastName: string; name: string }>>();
  for (let index = 0; index < queries.length; index += 10) {
    await Promise.all(queries.slice(index, index + 10).map(async (query, offset) => {
      const result = await client.call(devices[(index + offset) % devices.length]!, "search", "GET", `/clock/employees?search=${encodeURIComponent(query)}`);
      if (result.status !== 200) throw new Error(`Paridad: ${result.status} ${result.code} para una consulta`);
      server.set(query, result.data as never);
    }));
  }
  let pairs = 0;
  let answeredLocally = 0;
  const mismatches: Array<{ base: string; query: string; local: string[]; server: string[] }> = [];
  for (const sequence of sequences) {
    for (let i = 0; i < sequence.length; i += 1) {
      for (let j = i + 1; j < sequence.length; j += 1) {
        pairs += 1;
        const cache = createEmployeeSearchCache();
        cache.store(sequence[i]!, server.get(sequence[i]!)!, cache.generation());
        const local = cache.lookup(sequence[j]!);
        if (!local) continue;
        answeredLocally += 1;
        const expected = server.get(sequence[j]!)!.map((item) => item.id);
        const got = local.map((item) => item.id);
        if (JSON.stringify(expected) !== JSON.stringify(got)) mismatches.push({ base: sequence[i]!, query: sequence[j]!, local: got, server: expected });
      }
    }
  }
  const report = { people: people.length, distinctQueries: queries.length, pairs, answeredLocally, declined: pairs - answeredLocally, mismatches: mismatches.length, sample: mismatches.slice(0, 10) };
  writeFileSync(join(resultsDir, "parity.json"), JSON.stringify(report, null, 2));
  return report;
}

// ---------------------------------------------------------------- main
async function main() {
  pool = await seedEmployees();
  const backend = await startIsolatedBackend({ databaseUrl, port, workDir: join(workDir, "backend"), backendDir: args.get("backend-dir") });
  assertLocalBaseUrl(backend.baseUrl);
  console.info(`backend aislado en ${backend.baseUrl} (pid ${backend.pid}), log ${backend.logPath}`);
  const requested = (args.get("scenarios") || "special").split(",");
  const summary: Record<string, unknown> = {};
  try {
    for (const name of requested) {
      if (name === "parity") {
        console.info("→ parity");
        summary.parity = await runParity(backend);
        console.info(JSON.stringify(summary.parity));
        continue;
      }
      if (name === "special") {
        console.info("→ special");
        summary.special = await runSpecial(backend);
        continue;
      }
      const def = VOLUME[name];
      if (!def) throw new Error(`Escenario desconocido: ${name}`);
      console.info(`→ ${name}: ${def.description}`);
      const report = await runVolume(backend, def);
      summary[name] = report;
      console.info(JSON.stringify({ scenario: name, confirmed: report.confirmed, within5min: report.confirmedWithinFiveMinutes, elapsedS: Math.round(report.elapsedMs / 1000), r429: report.requests.status429, r5xx: report.requests.status5xx, dup: report.consistency.duplicates, photosOk: report.consistency.photos.ok, photoProblems: report.consistency.photos.problemCount }));
      employeeCursor = (employeeCursor + 7) % pool.length;
    }
  } finally {
    await backend.stop();
    await prisma.$disconnect();
    writeFileSync(join(resultsDir, `summary-${Date.now()}.json`), JSON.stringify(summary, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
