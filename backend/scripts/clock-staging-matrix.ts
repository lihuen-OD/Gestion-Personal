import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env } from "../src/config/env";
import { prisma } from "../src/shared/prisma/client";
import { storageService } from "../src/shared/storage/storage.service";

const baseUrl = process.env.CLOCK_TEST_BASE_URL || "http://127.0.0.1:4003/api";
const storageDownBaseUrl = process.env.CLOCK_STORAGE_DOWN_BASE_URL;
const prefix = `STG-CLOCK-${Date.now()}`;
const employeeIds: string[] = [];
const noveltyTypeIds: string[] = [];
const results: Array<Record<string, unknown>> = [];
let photo = "";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function succeeded(status: number) {
  return status >= 200 && status < 300;
}

async function request(path: string, init?: RequestInit) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, ms: Number((performance.now() - started).toFixed(1)), body, headers: response.headers };
}

async function createEmployee(label: string) {
  const suffix = `${Date.now()}${employeeIds.length}`.slice(-10);
  const concept = await prisma.hourConcept.findFirst({ where: { status: "ACTIVO", countsAsWorked: true } });
  assert(concept, "No active worked hour concept available");
  const employee = await prisma.employee.create({
    data: {
      legajo: `${prefix}-${label}`.slice(0, 50),
      cuil: `27${suffix}9`.slice(0, 11),
      dni: `8${suffix}`.slice(0, 8),
      firstName: "Clock",
      lastName: `Staging ${label}`,
      status: "ACTIVO",
      hourConcepts: { create: { hourConceptId: concept.id } },
    },
  });
  employeeIds.push(employee.id);
  return { employee, concept };
}

function payload(employeeId: string, punchType: "IN" | "OUT", requestId = randomUUID(), score = 0.99) {
  return { requestId, employeeId, punchType, photo, thumbnail: photo, faceValidationStatus: "VALID", faceDetectionScore: score, device: { platform: "staging-matrix" } };
}

function postPunch(body: ReturnType<typeof payload>, signal?: AbortSignal) {
  return request("/time-entries/clock/photo-punch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

async function pollAttempt(requestId: string, employeeId: string) {
  for (let i = 0; i < 30; i += 1) {
    const response = await request(`/time-entries/clock/attempts/${requestId}?employeeId=${employeeId}`);
    const data = (response.body as { data?: { status?: string } })?.data;
    if (data?.status === "COMPLETED" || data?.status === "FAILED") return response;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Attempt ${requestId} did not settle`);
}

async function cleanup() {
  const files = await prisma.storageFile.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
  for (const file of files) await storageService.deleteManaged(file.id).catch((error) => console.error("TEST_STORAGE_CLEANUP_FAILED", file.id, error));
  const shifts = await prisma.workShift.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: employeeIds } }, { entityId: { in: shifts.map((item) => item.id) } }] } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.noveltyType.deleteMany({ where: { id: { in: noveltyTypeIds } } });
  await prisma.storageFile.deleteMany({ where: { id: { in: files.map((file) => file.id) }, status: "DELETED" } });
  const leftovers = await prisma.employee.count({ where: { id: { in: employeeIds } } });
  assert(leftovers === 0, `Cleanup left ${leftovers} test employees`);
}

async function main() {
  assert(env.APP_ENV === "staging", `Refusing destructive matrix in APP_ENV=${env.APP_ENV}`);
  const health = await request("/health");
  const healthBody = health.body as { appEnv?: string };
  assert(health.status === 200 && healthBody.appEnv === "staging", "Target API is not explicitly staging");
  const image = await readFile(new URL("../../docs/reference-ui/form-reference.png", import.meta.url));
  photo = `data:image/png;base64,${image.toString("base64")}`;

  const invalid = await createEmployee("VALIDATION");
  const invalidResponse = await postPunch({ ...payload(invalid.employee.id, "IN"), faceValidationStatus: "NO_FACE" });
  assert(invalidResponse.status === 422, `Expected face validation 422, got ${invalidResponse.status}`);
  assert(await prisma.workShift.count({ where: { employeeId: invalid.employee.id } }) === 0, "Invalid face mutated work shifts");
  results.push({ scenario: "functional-validation", status: invalidResponse.status, ms: invalidResponse.ms });

  const inactive = await createEmployee("INACTIVE");
  await prisma.employee.update({ where: { id: inactive.employee.id }, data: { status: "INACTIVO" } });
  const inactiveResponse = await postPunch(payload(inactive.employee.id, "IN"));
  assert(inactiveResponse.status === 403, `Inactive employee expected 403, got ${inactiveResponse.status}`);
  assert(await prisma.workShift.count({ where: { employeeId: inactive.employee.id } }) === 0, "Inactive employee created shift");
  results.push({ scenario: "inactive-employee", status: inactiveResponse.status, ms: inactiveResponse.ms });

  const noOpen = await createEmployee("NO-OPEN");
  const noOpenResponse = await postPunch(payload(noOpen.employee.id, "OUT"));
  assert(noOpenResponse.status === 409, `OUT without open shift expected 409, got ${noOpenResponse.status}`);
  assert(await prisma.storageFile.count({ where: { employeeId: noOpen.employee.id, status: "ACTIVE" } }) === 0, "No-open rejection uploaded evidence");
  results.push({ scenario: "out-without-open-shift", status: noOpenResponse.status, activeEvidence: 0, ms: noOpenResponse.ms });

  const blocked = await createEmployee("BLOCKED-DAY");
  const blockedNow = new Date();
  const blockedArgentina = new Date(blockedNow.getTime() - 3 * 60 * 60 * 1000);
  const blockedDate = new Date(Date.UTC(blockedArgentina.getUTCFullYear(), blockedArgentina.getUTCMonth(), blockedArgentina.getUTCDate()));
  const blockedType = await prisma.noveltyType.create({
    data: {
      code: `${prefix}-BLOCK`.slice(0, 60),
      name: "Staging clock blocked day",
      uiColor: "#000000",
      kind: "AUSENCIA",
      origin: "INTERNA",
      blocksTimeEntry: true,
    },
  });
  noveltyTypeIds.push(blockedType.id);
  await prisma.novelty.create({ data: { employeeId: blocked.employee.id, noveltyTypeId: blockedType.id, status: "APROBADO", fromDate: blockedDate, toDate: blockedDate } });
  const blockedStart = new Date(Date.now() - 60 * 60 * 1000);
  const blockedStartPunch = await prisma.attendancePunch.create({ data: { employeeId: blocked.employee.id, type: "INGRESO", timestamp: blockedStart, source: "PUBLIC_CLOCK_PHOTO" } });
  await prisma.workShift.create({ data: { employeeId: blocked.employee.id, startPunchId: blockedStartPunch.id, source: "PUBLIC_CLOCK_PHOTO", status: "ABIERTO", startAt: blockedStart } });
  const blockedResponse = await postPunch(payload(blocked.employee.id, "OUT"));
  assert(blockedResponse.status === 409, `Blocked day expected 409, got ${blockedResponse.status}`);
  assert(await prisma.storageFile.count({ where: { employeeId: blocked.employee.id, status: "ACTIVE" } }) === 0, "Blocked-day rejection uploaded evidence");
  results.push({ scenario: "novelty-blocked-day", status: blockedResponse.status, activeEvidence: 0, ms: blockedResponse.ms });

  assert(storageDownBaseUrl, "CLOCK_STORAGE_DOWN_BASE_URL is required for the storage failure scenario");
  const storageDown = await createEmployee("STORAGE-DOWN");
  const storageStarted = performance.now();
  const storageResponse = await fetch(`${storageDownBaseUrl}/time-entries/clock/photo-punch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload(storageDown.employee.id, "IN")),
  });
  const storageMs = Number((performance.now() - storageStarted).toFixed(1));
  assert(storageResponse.status === 503, `Storage-down expected 503, got ${storageResponse.status}`);
  assert(await prisma.workShift.count({ where: { employeeId: storageDown.employee.id } }) === 0, "Storage failure created work shift");
  assert(await prisma.attendancePunch.count({ where: { employeeId: storageDown.employee.id } }) === 0, "Storage failure created punch");
  assert(await prisma.storageFile.count({ where: { employeeId: storageDown.employee.id, status: "ACTIVE" } }) === 0, "Storage failure left active evidence");
  results.push({ scenario: "storage-down", status: storageResponse.status, shifts: 0, punches: 0, activeEvidence: 0, ms: storageMs });

  const double = await createEmployee("DOUBLE");
  const doubleBody = payload(double.employee.id, "IN");
  const doubleResponses = await Promise.all([postPunch(doubleBody), postPunch(doubleBody)]);
  const doubleFinal = await pollAttempt(doubleBody.requestId, double.employee.id);
  assert(doubleResponses.some((item) => succeeded(item.status)), "Double click produced no success");
  assert(await prisma.workShift.count({ where: { employeeId: double.employee.id } }) === 1, "Double click duplicated work shift");
  assert(await prisma.attendancePunch.count({ where: { employeeId: double.employee.id } }) === 1, "Double click duplicated punch");
  const mismatch = await postPunch({ ...doubleBody, faceDetectionScore: 0.75 });
  assert(mismatch.status === 409, `Mismatched idempotency payload expected 409, got ${mismatch.status}`);
  results.push({ scenario: "double-click-and-payload-conflict", statuses: doubleResponses.map((item) => item.status), final: doubleFinal.status, conflict: mismatch.status, ms: doubleResponses.map((item) => item.ms) });

  const concurrentIn = await createEmployee("CONCURRENT-IN");
  const concurrentInResponses = await Promise.all([
    postPunch(payload(concurrentIn.employee.id, "IN")),
    postPunch(payload(concurrentIn.employee.id, "IN")),
  ]);
  assert(concurrentInResponses.filter((item) => succeeded(item.status)).length === 1, "Concurrent IN must have exactly one success");
  assert(await prisma.workShift.count({ where: { employeeId: concurrentIn.employee.id, status: "ABIERTO" } }) === 1, "Concurrent IN open shift invariant failed");
  results.push({ scenario: "concurrent-in", statuses: concurrentInResponses.map((item) => item.status), ms: concurrentInResponses.map((item) => item.ms) });

  const concurrentOut = await createEmployee("CONCURRENT-OUT");
  assert(succeeded((await postPunch(payload(concurrentOut.employee.id, "IN"))).status), "OUT setup IN failed");
  const concurrentOutResponses = await Promise.all([
    postPunch(payload(concurrentOut.employee.id, "OUT")),
    postPunch(payload(concurrentOut.employee.id, "OUT")),
  ]);
  assert(concurrentOutResponses.filter((item) => succeeded(item.status)).length === 1, "Concurrent OUT must have exactly one success");
  assert(await prisma.attendancePunch.count({ where: { employeeId: concurrentOut.employee.id, type: "SALIDA" } }) === 1, "Concurrent OUT duplicated punch");
  results.push({ scenario: "concurrent-out", statuses: concurrentOutResponses.map((item) => item.status), ms: concurrentOutResponses.map((item) => item.ms) });

  const timeout = await createEmployee("TIMEOUT");
  const timeoutBody = payload(timeout.employee.id, "IN");
  let clientTimedOut = false;
  try { await postPunch(timeoutBody, AbortSignal.timeout(50)); } catch { clientTimedOut = true; }
  const timeoutState = clientTimedOut ? await pollAttempt(timeoutBody.requestId, timeout.employee.id) : null;
  const timeoutRetry = await postPunch(timeoutBody);
  assert(succeeded(timeoutRetry.status), `Idempotent timeout retry failed with ${timeoutRetry.status}`);
  assert(await prisma.workShift.count({ where: { employeeId: timeout.employee.id } }) === 1, "Timeout retry duplicated shift");
  results.push({ scenario: "timeout-recovery", clientTimedOut, polledStatus: timeoutState?.status, retryStatus: timeoutRetry.status, retryMs: timeoutRetry.ms });

  const midnight = await createEmployee("MIDNIGHT");
  const now = new Date();
  const startAt = new Date(now);
  startAt.setDate(startAt.getDate() - 1);
  startAt.setHours(23, 30, 0, 0);
  const startPunch = await prisma.attendancePunch.create({ data: { employeeId: midnight.employee.id, type: "INGRESO", timestamp: startAt, source: "PUBLIC_CLOCK_PHOTO" } });
  const shift = await prisma.workShift.create({ data: { employeeId: midnight.employee.id, startPunchId: startPunch.id, source: "PUBLIC_CLOCK_PHOTO", status: "ABIERTO", startAt } });
  const midnightResponse = await postPunch(payload(midnight.employee.id, "OUT"));
  assert(succeeded(midnightResponse.status), `Midnight OUT failed with ${midnightResponse.status}`);
  const midnightShift = await prisma.workShift.findUnique({ where: { id: shift.id }, include: { timeSegments: true } });
  assert(midnightShift?.crossesMidnight && midnightShift.timeSegments.length === 2, "Midnight segmentation invariant failed");
  results.push({ scenario: "cross-midnight", status: midnightResponse.status, segments: midnightShift.timeSegments.length, ms: midnightResponse.ms });

  const approved = await createEmployee("APPROVED");
  const approvedStart = new Date(Date.now() - 60 * 60 * 1000);
  const approvedStartPunch = await prisma.attendancePunch.create({ data: { employeeId: approved.employee.id, type: "INGRESO", timestamp: approvedStart, source: "PUBLIC_CLOCK_PHOTO" } });
  await prisma.workShift.create({ data: { employeeId: approved.employee.id, startPunchId: approvedStartPunch.id, source: "PUBLIC_CLOCK_PHOTO", status: "ABIERTO", startAt: approvedStart } });
  const argentinaNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const approvedDate = new Date(Date.UTC(argentinaNow.getUTCFullYear(), argentinaNow.getUTCMonth(), argentinaNow.getUTCDate()));
  await prisma.timeEntry.create({
    data: {
      employeeId: approved.employee.id,
      hourConceptId: approved.concept.id,
      date: approvedDate,
      period: approvedDate.toISOString().slice(0, 7),
      day: approvedDate.getUTCDate(),
      hours: 8,
      totalMinutes: 480,
      status: "APROBADO",
      observation: "STAGING MATRIX - approved hours lock",
    },
  });
  const filesBeforeApproved = await prisma.storageFile.count({ where: { employeeId: approved.employee.id, status: "ACTIVE" } });
  const approvedResponse = await postPunch(payload(approved.employee.id, "OUT"));
  const filesAfterApproved = await prisma.storageFile.count({ where: { employeeId: approved.employee.id, status: "ACTIVE" } });
  assert(approvedResponse.status === 409, `Approved hours expected 409, got ${approvedResponse.status}`);
  assert(filesAfterApproved === filesBeforeApproved, "Approved-hours rejection left active evidence");
  assert(await prisma.attendancePunch.count({ where: { employeeId: approved.employee.id, type: "SALIDA" } }) === 0, "Approved-hours rejection created OUT punch");
  results.push({ scenario: "approved-hours-block", status: approvedResponse.status, activeEvidenceDelta: filesAfterApproved - filesBeforeApproved, ms: approvedResponse.ms });

  const evidencePunch = await prisma.attendancePunch.findFirst({ where: { employeeId: concurrentOut.employee.id, photoFileId: { not: null } }, orderBy: { timestamp: "desc" } });
  assert(evidencePunch, "No evidence punch available for admin visibility test");
  const email = process.env.PERF_EMAIL;
  const password = process.env.PERF_PASSWORD;
  assert(email && password, "PERF_EMAIL and PERF_PASSWORD are required for evidence visibility");
  const login = await request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const token = (login.body as { accessToken?: string }).accessToken;
  assert(login.status === 200 && token, "Admin login failed");
  const evidence = await request(`/time-entries/attendance/punches/${evidencePunch.id}/photo`, { headers: { authorization: `Bearer ${token}` } });
  const evidenceSize = Number(evidence.headers.get("content-length") || 0);
  assert(evidence.status === 200, `Evidence admin view failed with ${evidence.status}`);
  results.push({ scenario: "admin-evidence", status: evidence.status, contentType: evidence.headers.get("content-type"), bytes: evidenceSize, ms: evidence.ms });

  const timings = results.flatMap((item) => Array.isArray(item.ms) ? item.ms as number[] : typeof item.ms === "number" ? [item.ms] : []);
  timings.sort((a, b) => a - b);
  results.push({ scenario: "photo-punch-latency", samples: timings.length, medianMs: timings[Math.floor(timings.length / 2)], worstMs: timings.at(-1) });
  console.log(JSON.stringify({ appEnv: env.APP_ENV, prefix, results }, null, 2));
}

main().catch((error) => {
  console.error("CLOCK_STAGING_MATRIX_FAILED", error);
  process.exitCode = 1;
}).finally(async () => {
  await cleanup().catch((error) => {
    console.error("CLOCK_STAGING_CLEANUP_FAILED", error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
});
