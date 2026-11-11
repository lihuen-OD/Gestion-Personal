import { expect, test, type Page } from "@playwright/test";

// Modo mantenimiento (docs/decisions/FICHADOR_MAINTENANCE_MODE.md) en Chromium
// real: presión larga con pointer events del navegador, código, panel y
// salida. El API es inexistente y se responde con page.route; nada sale a un
// backend real.
const DEVICE_ID = "00000000-0000-4000-8000-000000000001";
const DEVICE_SECRET = "e2e-individual-device-secret";
const TOKEN = "t".repeat(43);
const DIAGNOSTICS = {
  name: "TEST E2E",
  status: "ACTIVE",
  activatedAt: "2026-10-20T12:00:00.000Z",
  lastSeenAt: new Date().toISOString(),
  lastAppVersion: "0.1.0",
  connectivity: "ONLINE",
  establishment: { name: "Planta Norte", zone: { name: "Zona Centro" } },
};

type ApiCall = { call: string; authorization: string | undefined; maintenance: string | undefined; body: string | null };

async function mockApi(page: Page) {
  const calls: ApiCall[] = [];
  await page.route("http://127.0.0.1:59999/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const call = `${request.method()} ${path}`;
    const headers = request.headers();
    calls.push({ call, authorization: headers.authorization, maintenance: headers["x-clock-maintenance-session"], body: request.postData() });
    if (path === "/clock/device/status") return route.fulfill({ json: { data: { id: DEVICE_ID, name: "TEST E2E", status: "ACTIVE" } } });
    if (path === "/clock/heartbeat") return route.fulfill({ json: { data: { device: { id: DEVICE_ID, name: "TEST E2E", status: "ACTIVE", establishment: null }, serverTime: new Date().toISOString() } } });
    if (call === "POST /clock/maintenance/session") {
      return JSON.parse(request.postData() || "{}").code === "482731"
        ? route.fulfill({ status: 201, json: { data: { token: TOKEN, expiresAt: "x", expiresInSeconds: 600, device: DIAGNOSTICS } } })
        : route.fulfill({ status: 401, json: { error: { code: "CLOCK_MAINTENANCE_CODE_INVALID", message: "El código no es válido o ya venció." } } });
    }
    if (call === "GET /clock/maintenance/session") return route.fulfill({ json: { data: { expiresAt: "x", expiresInSeconds: 590, device: DIAGNOSTICS, serverTime: "x" } } });
    if (call === "DELETE /clock/maintenance/session") return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { error: { code: "ROUTE_NOT_FOUND" } } });
  });
  return calls;
}

async function seedActiveIdentity(page: Page) {
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
}

async function pressHeading(page: Page, ms: number) {
  const box = (await page.getByRole("heading", { name: "Fichador de personal" }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("mantener presionado el encabezado 5 s abre el acceso; con el código de RRHH entra al modo mantenimiento y vuelve al fichador", async ({ page }) => {
  const calls = await mockApi(page);
  await seedActiveIdentity(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible();
  // Quien ficha no ve ningún control administrativo.
  await expect(page.getByText(/mantenimiento/i)).toHaveCount(0);

  // Un toque corto no hace nada.
  await pressHeading(page, 1_000);
  await expect(page.getByRole("dialog", { name: "Acceso de mantenimiento" })).toHaveCount(0);

  await pressHeading(page, 5_300);
  const dialog = page.getByRole("dialog", { name: "Acceso de mantenimiento" });
  await expect(dialog).toBeVisible();
  // Mantener presionado no selecciona el título (no aparece el menú de copiar).
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await dialog.getByLabel("Código").fill("111111");
  await dialog.getByRole("button", { name: "Ingresar" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("El código no es válido o ya venció.");

  await dialog.getByLabel("Código").fill("482731");
  await dialog.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Modo mantenimiento" })).toBeVisible();
  await expect(page.getByText("Zona Centro · Planta Norte")).toBeVisible();
  // El panel reemplaza al fichador: ni la búsqueda ni las acciones de fichada.
  await expect(page.getByLabel("Buscar por nombre o apellido")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Marcar (ingreso|salida)/ })).toHaveCount(0);
  const open = calls.find((entry) => entry.call === "POST /clock/maintenance/session" && entry.body?.includes("482731"))!;
  expect(open.authorization).toBe(`ClockDevice ${DEVICE_ID}.${DEVICE_SECRET}`);
  expect(open.maintenance).toBeUndefined();

  await page.getByRole("button", { name: "Volver al fichador" }).click();
  await expect(page.getByLabel("Buscar por nombre o apellido")).toBeVisible();
  await expect.poll(() => calls.filter((entry) => entry.call === "DELETE /clock/maintenance/session").map((entry) => entry.maintenance)).toEqual([TOKEN]);
  // El token de mantenimiento nunca queda guardado en el navegador.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain("t".repeat(43));
});
