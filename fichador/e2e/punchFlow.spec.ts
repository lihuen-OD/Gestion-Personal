import { expect, test, type Page, type Route } from "@playwright/test";

// F8 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §27) — fichada completa
// en un navegador real: cámara falsa de Chromium, captura y compresión reales,
// detector de rostros falso (servidor 5186, ver playwright.config.ts) y API
// mockeado con page.route. Nada sale a un backend real.
const API = "http://127.0.0.1:59999/api";
const employee = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };
const SERVER_START = "2026-10-13T11:01:00.000Z"; // 08:01 en Argentina
const inResult = { employee, workShift: { id: "shift-1", startAt: SERVER_START } };

type ApiCall = { method: string; path: string; body: Record<string, unknown> | null };
type Handler = (route: Route, call: ApiCall, count: number) => Promise<void> | void;

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, json: body });

async function openKiosk(page: Page, handlers: { punch?: Handler; attempt?: Handler; revokedOperational?: boolean; openShift?: { id: string; startAt: string } } = {}) {
  const calls: ApiCall[] = [];
  let punches = 0;
  let attempts = 0;
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const call = { method: request.method(), path, body: request.method() === "POST" ? (request.postDataJSON() as Record<string, unknown>) : null };
    calls.push(call);
    if (path === "/clock/device/status") return json(route, 200, { data: { id: "00000000-0000-4000-8000-000000000001", name: "TEST F8", status: "ACTIVE" } });
    // F9: presencia del equipo, independiente de la fichada.
    if (path === "/clock/heartbeat") return json(route, 200, { data: { device: { id: "00000000-0000-4000-8000-000000000001", name: "TEST F8", status: "ACTIVE", establishment: null }, serverTime: new Date().toISOString() } });
    if (path === "/clock/employees") return json(route, 200, { data: [employee] });
    if (path === "/clock/status") return json(route, 200, { data: { employee, openShift: handlers.openShift ?? null } });
    if (path === "/clock/photo-punch") {
      punches += 1;
      if (handlers.punch) return handlers.punch(route, call, punches);
      return json(route, 201, { data: inResult });
    }
    if (path.startsWith("/clock/attempts/")) {
      attempts += 1;
      if (handlers.attempt) return handlers.attempt(route, call, attempts);
      return json(route, 404, { error: { code: "CLOCK_ATTEMPT_NOT_FOUND", message: "No se encontró el intento de fichada." } });
    }
    return json(route, 404, { error: { code: "ROUTE_NOT_FOUND" } });
  });
  await page.addInitScript(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("fichador-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("identity");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("identity", "readwrite");
      tx.objectStore("identity").put({ id: "00000000-0000-4000-8000-000000000001", secret: "e2e-individual-device-secret" }, "current");
      tx.oncomplete = () => resolve();
    };
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible();
  return calls;
}

async function selectEmployee(page: Page) {
  await page.getByLabel("Buscar por nombre o apellido").fill("Gomez");
  await page.getByRole("button", { name: /Gomez, Ana/ }).click();
  await expect(page.getByText("Legajo 100 · DNI terminado en 456")).toBeVisible();
}

async function captureAndConfirm(page: Page) {
  await page.getByRole("button", { name: /Marcar ingreso/ }).click();
  const confirm = page.getByRole("button", { name: "Confirmar ingreso" });
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.click();
}

// Requests de la fichada: sin el estado del equipo ni el heartbeat (F9), que
// corren aparte.
const operational = (calls: ApiCall[]) => calls.filter(({ path }) => !path.startsWith("/clock/device/") && path !== "/clock/heartbeat");
const punchBodies = (calls: ApiCall[]) => calls.filter(({ path }) => path === "/clock/photo-punch").map(({ body }) => body!);

function expectOnlyClockNamespace(calls: ApiCall[]) {
  for (const { path } of calls) expect(path, path).toMatch(/^\/clock\//);
  expect(calls.some(({ path }) => path.includes("time-entries"))).toBe(false);
}

test("ACTIVE → busca → estado → ficha → confirmación con hora del servidor → vuelve solo al inicio (todo por /api/clock)", async ({ page }) => {
  const calls = await openKiosk(page);
  await selectEmployee(page);
  await captureAndConfirm(page);

  await expect(page.getByText("Entrada registrada")).toBeVisible();
  await expect(page.getByText("Ana Gomez")).toBeVisible();
  await expect(page.getByText("08:01", { exact: true })).toBeVisible();
  await expect(page.getByText("Podés continuar.")).toBeVisible();

  // Retorno automático: el kiosco queda listo para la próxima persona.
  await expect(page.getByLabel("Buscar por nombre o apellido")).toHaveValue("", { timeout: 6_000 });
  await expect(page.getByText("Entrada registrada")).toBeHidden();
  await expect(page.getByRole("button", { name: /Marcar ingreso/ })).toBeDisabled();

  expect(operational(calls).map(({ method, path }) => `${method} ${path}`)).toEqual(["GET /clock/employees", "POST /clock/status", "POST /clock/photo-punch"]);
  expectOnlyClockNamespace(operational(calls));
  // F9: el heartbeat salió al abrir el fichador, sin body (la versión va en el header).
  expect(calls.filter(({ method, path }) => method === "POST" && path === "/clock/heartbeat").map(({ body }) => body)).toEqual([null]);
  const [body] = punchBodies(calls);
  expect(body).toMatchObject({ employeeId: "employee-1", punchType: "IN", faceValidationStatus: "VALID" });
  expect(body).not.toHaveProperty("source");
  expect(body).not.toHaveProperty("deviceId");
  expect(String(body!.photo)).toMatch(/^data:image\/jpeg;base64,/);
});

test("cooldown: muestra la cuenta regresiva del retryAfterSeconds y habilita al llegar a 0, sin fichar sola", async ({ page }) => {
  const calls = await openKiosk(page, {
    punch: (route) => json(route, 409, { error: { code: "CLOCK_PUNCH_COOLDOWN", message: "Ya registraste una fichada hace instantes. Esperá unos segundos antes de volver a fichar.", retryAfterSeconds: 3 } }),
  });
  await selectEmployee(page);
  await captureAndConfirm(page);

  await expect(page.getByText("Ya registraste una fichada hace unos segundos.")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/Podés volver a intentar en [23] s\./);
  await expect(page.getByRole("button", { name: /Marcar ingreso/ })).toBeDisabled();

  await expect(page.getByRole("button", { name: /Marcar ingreso/ })).toBeEnabled({ timeout: 5_000 });
  await expect(page.getByText("Ya registraste una fichada hace unos segundos.")).toBeHidden();
  expect(punchBodies(calls)).toHaveLength(1);
  expect(calls.some(({ path }) => path.startsWith("/clock/attempts/"))).toBe(false);
});

// F8.1: sin retryAfterSeconds (backend viejo, respuesta incompleta) la PWA no
// habilita de inmediato: espera local de FALLBACK_COOLDOWN_SECONDS (5 s,
// TimeClockPage.tsx) con la misma cuenta regresiva.
test("cooldown sin retryAfterSeconds: espera local corta, no habilita de inmediato y no ficha sola", async ({ page }) => {
  const calls = await openKiosk(page, {
    punch: (route) => json(route, 409, { error: { code: "CLOCK_PUNCH_COOLDOWN", message: "Ya registraste una fichada hace instantes. Esperá unos segundos antes de volver a fichar." } }),
  });
  await selectEmployee(page);
  await captureAndConfirm(page);
  const clockIn = page.getByRole("button", { name: /Marcar ingreso/ });

  await expect(page.getByText("Ya registraste una fichada hace unos segundos.")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/Podés volver a intentar en [45] s\./);
  await expect(clockIn).toBeDisabled();
  await expect(page.getByText(/CLOCK_|retryAfterSeconds/)).toHaveCount(0);
  // Segundos después sigue bloqueado: no fue una habilitación inmediata.
  await expect(page.getByRole("timer")).toHaveText(/Podés volver a intentar en [12] s\./, { timeout: 5_000 });
  await expect(clockIn).toBeDisabled();

  await expect(clockIn).toBeEnabled({ timeout: 4_000 });
  await expect(page.getByText("Ya registraste una fichada hace unos segundos.")).toBeHidden();
  expect(punchBodies(calls)).toHaveLength(1);
  expect(calls.some(({ path }) => path.startsWith("/clock/attempts/"))).toBe(false);
});

test("respuesta perdida: verifica el MISMO requestId y confirma sin una segunda fichada", async ({ page }) => {
  let requestId = "";
  const calls = await openKiosk(page, {
    punch: (route, call) => {
      requestId = String(call.body!.requestId);
      return route.abort("failed"); // el backend la registró, pero la respuesta no llegó
    },
    attempt: (route) => json(route, 200, { data: { requestId, status: "COMPLETED", response: inResult, error: null } }),
  });
  await selectEmployee(page);
  await captureAndConfirm(page);

  await expect(page.getByText("Entrada registrada")).toBeVisible({ timeout: 10_000 });
  expect(punchBodies(calls)).toHaveLength(1);
  const polled = calls.filter(({ path }) => path.startsWith("/clock/attempts/"));
  expect(polled.length).toBeGreaterThanOrEqual(1);
  for (const { path } of polled) expect(path).toBe(`/clock/attempts/${requestId}`);
  expectOnlyClockNamespace(operational(calls));
});

test("el POST nunca llegó: el intento da 404 dos veces y reenvía el MISMO POST (mismo requestId) hasta confirmar", async ({ page }) => {
  const calls = await openKiosk(page, {
    punch: (route, _call, count) => (count === 1 ? route.abort("failed") : json(route, 201, { data: inResult })),
  });
  await selectEmployee(page);
  await captureAndConfirm(page);

  await expect(page.getByText("Entrada registrada")).toBeVisible({ timeout: 10_000 });
  const bodies = punchBodies(calls);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test("RRHH revoca el equipo durante la fichada: el fichador se bloquea sin reintentos", async ({ page }) => {
  const calls = await openKiosk(page, {
    punch: (route) => json(route, 403, { error: { code: "CLOCK_DEVICE_REVOKED", message: "Este dispositivo fue deshabilitado por RRHH." } }),
  });
  await selectEmployee(page);
  await captureAndConfirm(page);

  await expect(page.getByRole("heading", { name: "Dispositivo deshabilitado" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeHidden();
  await page.waitForTimeout(1_500);
  expect(punchBodies(calls)).toHaveLength(1);
  expect(calls.some(({ path }) => path.startsWith("/clock/attempts/"))).toBe(false);
});

test("backend lento (guardando la foto): la UI queda ocupada, avisa la demora y no duplica la fichada", async ({ page }) => {
  const calls = await openKiosk(page, {
    punch: async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      await json(route, 201, { data: inResult });
    },
  });
  await selectEmployee(page);
  await captureAndConfirm(page);

  await expect(page.getByText("Registrando fichada…")).toBeVisible();
  const busyButton = page.getByRole("button", { name: "Procesando…" });
  await expect(busyButton).toBeDisabled();
  await expect(page.getByText(/Esto puede demorar unos segundos/)).toBeVisible({ timeout: 6_000 });
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  // F10: mientras se registra queda a la vista la foto tomada (no un video
  // negro), con la cámara ya apagada.
  const frozen = page.getByRole("img", { name: "Foto tomada para esta fichada" });
  await expect(frozen).toBeVisible();
  expect(await frozen.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
  expect(await page.locator("video.face-video").evaluate((video: HTMLVideoElement) => video.srcObject === null && video.classList.contains("is-frozen"))).toBe(true);

  await expect(page.getByText("Entrada registrada")).toBeVisible({ timeout: 10_000 });
  expect(punchBodies(calls)).toHaveLength(1);
});

test("doble tap en 'Marcar ingreso': una sola intención y un solo POST", async ({ page }) => {
  const calls = await openKiosk(page);
  await selectEmployee(page);
  await page.getByRole("button", { name: /Marcar ingreso/ }).dblclick();
  await expect(page.getByRole("dialog", { name: "Confirmar fichada con foto" })).toHaveCount(1);
  const confirm = page.getByRole("button", { name: "Confirmar ingreso" });
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.dblclick();

  await expect(page.getByText("Entrada registrada")).toBeVisible();
  expect(punchBodies(calls)).toHaveLength(1);
});

test("sin conexión: no abre la cámara ni intenta fichar", async ({ page, context }) => {
  const calls = await openKiosk(page);
  await selectEmployee(page);
  await context.setOffline(true);

  await page.getByRole("button", { name: /Marcar ingreso/ }).click();

  await expect(page.getByText("Sin conexión. No se puede registrar la fichada.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Confirmar fichada con foto" })).toHaveCount(0);
  expect(punchBodies(calls)).toHaveLength(0);
  await context.setOffline(false);
});

// F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29)
test("segundo plano con la cámara abierta: se apaga, avisa y no se reabre sola; la próxima captura es nueva", async ({ page }) => {
  const calls = await openKiosk(page);
  await selectEmployee(page);
  await page.getByRole("button", { name: /Marcar ingreso/ }).click();
  await expect(page.getByRole("button", { name: "Confirmar ingreso" })).toBeEnabled({ timeout: 30_000 });
  await page.evaluate(() => {
    const video = document.querySelector("video.face-video") as HTMLVideoElement;
    (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = (video.srcObject as MediaStream).getTracks();
  });

  const setHidden = (hidden: boolean) => page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (value ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await setHidden(true);

  await expect(page.getByRole("dialog", { name: "Confirmar fichada con foto" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((track) => track.readyState === "ended"))).toBe(true);

  await setHidden(false);
  await expect(page.getByText("La cámara se pausó. Volvé a iniciar la captura.")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole("dialog", { name: "Confirmar fichada con foto" })).toHaveCount(0);
  expect(punchBodies(calls)).toHaveLength(0);

  await captureAndConfirm(page);
  await expect(page.getByText("Entrada registrada")).toBeVisible();
  expect(punchBodies(calls)).toHaveLength(1);
});

test("con un ingreso abierto, 'Marcar salida' es la acción principal", async ({ page }) => {
  await openKiosk(page, { openShift: { id: "shift-open", startAt: new Date(Date.now() - 3 * 3_600_000).toISOString() } });
  await selectEmployee(page);
  const salida = page.getByRole("button", { name: /Marcar salida/ });
  const ingreso = page.getByRole("button", { name: /Marcar ingreso/ });
  await expect(salida).toBeEnabled();
  await expect(salida).toHaveClass(/\bprimary\b/);
  await expect(ingreso).toBeDisabled();
  await expect(ingreso).not.toHaveClass(/\bprimary\b/);
});
