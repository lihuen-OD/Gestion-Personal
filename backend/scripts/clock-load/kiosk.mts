/**
 * Kiosco virtual: reproduce el recorrido de una persona en el fichador contra
 * el backend aislado, con las mismas reglas del cliente real:
 * - búsqueda progresiva con debounce de 250 ms y el caché REAL del fichador
 *   (fichador/src/features/clock/employeeSearchCache.ts), o sin caché
 *   ("legacy", el cliente previo a §33), o una consulta por tecla
 *   ("keystroke", peor caso);
 * - consulta de jornada, cámara, fichada con foto y recuperación del
 *   resultado incierto con el MISMO requestId (mismos plazos que
 *   fichador/src/features/punch/punchSubmission.ts);
 * - nunca reintenta un 429 ni genera otro requestId.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createEmployeeSearchCache } from "../../../fichador/src/features/clock/employeeSearchCache.ts";

export type Op = "search" | "status" | "punch" | "attempt" | "heartbeat";
export type ClientMode = "cache" | "legacy" | "keystroke";
export type RequestRecord = { scenario: string; op: Op; status: number; code?: string; ms: number; at: number; ip: string; deviceId: string };
export type VirtualDevice = { id: string; secret: string; ip: string };
export type SyntheticEmployee = { id: string; firstName: string; lastName: string; dni: string };
type SearchItem = { id: string; dni: string | null; firstName: string; lastName: string; name: string };

export const DEBOUNCE_MS = 250;
const PHOTO_PUNCH_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RECOVERY_POLL_DELAYS_MS = [500, 1_000, 1_500, 2_000, 3_000, 3_000, 3_000, 4_000, 4_000, 4_000, 4_000, 4_500, 5_000, 5_000];
const RESEND_AFTER_CONSECUTIVE_404 = 2;
const MAX_RESENDS = 3;

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, Math.max(0, ms)));
const between = (min: number, max: number) => min + Math.random() * (max - min);

export class LoadClient {
  readonly records: RequestRecord[] = [];
  constructor(readonly baseUrl: string, readonly scenario: string) {}

  async call(device: VirtualDevice, op: Op, method: string, path: string, options: { body?: unknown; timeoutMs?: number; authorization?: string } = {}) {
    const startedAt = performance.now();
    const headers: Record<string, string> = {
      authorization: options.authorization ?? `ClockDevice ${device.id}.${device.secret}`,
      "x-forwarded-for": device.ip,
      "x-clock-app-version": "load-test",
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    let status = 0;
    let payload: { data?: unknown; error?: { code?: string; retryAfterSeconds?: number } } | null = null;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      const text = await response.text();
      payload = response.headers.get("content-type")?.includes("application/json") && text ? JSON.parse(text) : null;
    } catch (error) {
      status = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError") ? -1 : -2;
    }
    const ms = performance.now() - startedAt;
    this.records.push({ scenario: this.scenario, op, status, code: payload?.error?.code, ms, at: Date.now(), ip: device.ip, deviceId: device.id });
    return { status, data: payload?.data, code: payload?.error?.code, retryAfterSeconds: payload?.error?.retryAfterSeconds, ms };
  }
}

/** Foto sintética única (≈ la de 800 px, calidad 0,82): su hash prueba a quién quedó asociada. */
export function syntheticPhoto(photoBytes = 100_000, thumbnailBytes = 9_000) {
  const jpeg = (size: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size - 4)]);
  const photo = jpeg(photoBytes);
  return {
    photo: `data:image/jpeg;base64,${photo.toString("base64")}`,
    thumbnail: `data:image/jpeg;base64,${jpeg(thumbnailBytes).toString("base64")}`,
    sha256: createHash("sha256").update(photo).digest("hex"),
  };
}

export type SearchOutcome = { found: boolean; requests: number; localHits: number; ms: number; rateLimited: boolean };

/**
 * Teclea `text` (150-350 ms entre teclas) hasta ver a la persona en la lista,
 * como el fichador: debounce de 250 ms, una respuesta vieja nunca pisa a la
 * vigente, y con caché las consultas ya resueltas no salen.
 */
export async function typeAndFind(client: LoadClient, device: VirtualDevice, text: string, targetId: string, mode: ClientMode): Promise<SearchOutcome> {
  const startedAt = performance.now();
  const cache = createEmployeeSearchCache();
  let displayed: { query: string; items: SearchItem[] } = { query: "", items: [] };
  let current = "";
  let requests = 0;
  let localHits = 0;
  let rateLimited = false;
  const inflight = new Set<Promise<void>>();

  const request = (query: string) => {
    requests += 1;
    const generation = cache.generation();
    const pending = client.call(device, "search", "GET", `/clock/employees?search=${encodeURIComponent(query)}`).then((result) => {
      if (result.status === 429) rateLimited = true;
      if (result.status !== 200 || !Array.isArray(result.data)) return;
      const items = result.data as SearchItem[];
      if (mode === "cache") cache.store(query, items, generation);
      if (query === current) displayed = { query, items };
    });
    inflight.add(pending);
    void pending.finally(() => inflight.delete(pending));
  };
  const visible = () => displayed.query === current && displayed.items.some((item) => item.id === targetId);

  for (let index = 1; index <= text.length; index += 1) {
    const query = text.slice(0, index).trim();
    const last = index === text.length;
    const nextKeystroke = last ? Number.POSITIVE_INFINITY : between(150, 350);
    let slept = 0;
    if (query !== current && query.length >= 2) {
      current = query;
      const known = mode === "cache" ? cache.lookup(query) : undefined;
      if (known) {
        localHits += 1;
        displayed = { query, items: known };
      } else if (mode === "keystroke") {
        request(query);
      } else if (nextKeystroke > DEBOUNCE_MS) {
        await sleep(DEBOUNCE_MS);
        slept = DEBOUNCE_MS;
        const arrived = mode === "cache" ? cache.lookup(query) : undefined;
        if (arrived) {
          localHits += 1;
          displayed = { query, items: arrived };
        } else {
          request(query);
        }
      }
    }
    if (last) break;
    await sleep(nextKeystroke - slept);
    if (visible()) break;
  }
  const waitUntil = performance.now() + REQUEST_TIMEOUT_MS;
  while (!visible() && inflight.size > 0 && performance.now() < waitUntil) await Promise.race([...inflight, sleep(100)]);
  return { found: visible(), requests, localHits, ms: performance.now() - startedAt, rateLimited };
}

export type PunchOutcome =
  | { kind: "success"; punchType: "IN" | "OUT"; requestId: string; sha256: string; recovered: boolean; resends: number; ms: number }
  | { kind: "failed"; status: number; code?: string; requestId: string; ms: number }
  | { kind: "unconfirmed"; requestId: string; ms: number };

function uncertain(result: { status: number; code?: string }) {
  if (result.status < 0) return true;
  if (result.status >= 500 && !(result.code || "").startsWith("CLOCK_")) return true;
  return result.code === "CLOCK_ATTEMPT_PROCESSING";
}

/** Envía la fichada y, si el resultado es incierto, lo recupera con el mismo requestId. */
export async function punch(client: LoadClient, device: VirtualDevice, employeeId: string, punchType: "IN" | "OUT", options: { requestId?: string; timeoutMs?: number; photo?: ReturnType<typeof syntheticPhoto> } = {}): Promise<PunchOutcome> {
  const startedAt = performance.now();
  const requestId = options.requestId ?? randomUUID();
  const photo = options.photo ?? syntheticPhoto();
  const body = { requestId, employeeId, punchType, photo: photo.photo, thumbnail: photo.thumbnail, faceValidationStatus: "VALID", faceDetectionScore: 0.93, device: { userAgent: "clock-load", platform: "load" } };
  const post = () => client.call(device, "punch", "POST", "/clock/photo-punch", { body, timeoutMs: options.timeoutMs ?? PHOTO_PUNCH_TIMEOUT_MS });
  const done = (result: { status: number; code?: string }, recovered: boolean, resends: number): PunchOutcome => result.status === 201 || result.status === 200
    ? { kind: "success", punchType, requestId, sha256: photo.sha256, recovered, resends, ms: performance.now() - startedAt }
    : { kind: "failed", status: result.status, code: result.code, requestId, ms: performance.now() - startedAt };

  const first = await post();
  if (!uncertain(first)) return done(first, false, 0);
  let resends = 0;
  let consecutiveNotFound = 0;
  for (const delay of RECOVERY_POLL_DELAYS_MS) {
    await sleep(delay);
    const state = await client.call(device, "attempt", "GET", `/clock/attempts/${requestId}?employeeId=${employeeId}`);
    if (state.status === 404) {
      consecutiveNotFound += 1;
      if (consecutiveNotFound >= RESEND_AFTER_CONSECUTIVE_404 && resends < MAX_RESENDS) {
        resends += 1;
        consecutiveNotFound = 0;
        const resent = await post();
        if (!uncertain(resent)) return done(resent, true, resends);
      }
      continue;
    }
    if (state.status !== 200) continue;
    consecutiveNotFound = 0;
    const attempt = state.data as { status: string; error?: { code: string; httpStatus: number } | null };
    if (attempt.status === "COMPLETED") return done({ status: 201 }, true, resends);
    if (attempt.status === "FAILED") return { kind: "failed", status: attempt.error?.httpStatus ?? 0, code: attempt.error?.code, requestId, ms: performance.now() - startedAt };
  }
  return { kind: "unconfirmed", requestId, ms: performance.now() - startedAt };
}

export type JourneyResult = {
  scenario: string;
  employeeId: string;
  deviceId: string;
  ip: string;
  by: "name" | "dni";
  arrivedAt: number;
  startedAt: number;
  finishedAt: number;
  search: SearchOutcome;
  statusCode?: number;
  outcome: PunchOutcome | { kind: "not-found" } | { kind: "status-failed"; status: number; code?: string };
};

/** Una persona en el kiosco: buscar, elegir, consultar la jornada, cámara y fichar. */
export async function journey(client: LoadClient, device: VirtualDevice, employee: SyntheticEmployee, options: { mode: ClientMode; byDni: boolean; arrivedAt: number; cameraMs: [number, number] }): Promise<JourneyResult> {
  const startedAt = Date.now();
  const text = options.byDni ? employee.dni : `${employee.lastName} ${employee.firstName}`;
  const base = { scenario: client.scenario, employeeId: employee.id, deviceId: device.id, ip: device.ip, by: options.byDni ? "dni" as const : "name" as const, arrivedAt: options.arrivedAt, startedAt };
  const search = await typeAndFind(client, device, text, employee.id, options.mode);
  if (!search.found) return { ...base, finishedAt: Date.now(), search, outcome: { kind: "not-found" } };
  await sleep(between(400, 900)); // leer la lista y tocar el nombre
  const status = await client.call(device, "status", "POST", "/clock/status", { body: { employeeId: employee.id } });
  if (status.status !== 200) return { ...base, finishedAt: Date.now(), search, statusCode: status.status, outcome: { kind: "status-failed", status: status.status, code: status.code } };
  const openShift = (status.data as { openShift: unknown } | undefined)?.openShift;
  await sleep(between(600, 1_200)); // leer el estado y tocar "Marcar…"
  await sleep(between(...options.cameraMs)); // cámara: encuadre, detector y "Confirmar"
  const outcome = await punch(client, device, employee.id, openShift ? "OUT" : "IN");
  return { ...base, finishedAt: Date.now(), search, statusCode: 200, outcome };
}
