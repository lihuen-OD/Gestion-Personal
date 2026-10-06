import { expect, test, type Page } from "@playwright/test";

// F1 — journey del fichador standalone con el API mockeado: nada sale a un
// backend real ni escribe datos. Desde F3 MediaPipe es self-hosted: el
// detector real carga del mismo origin y, con la cámara falsa de Chromium
// (sin rostro), informa "No se detectó una cara". La captura+envío de la
// foto necesita un rostro real, así que el envío/resultado se cubren en
// src/pages/TimeClockPage.test.tsx con la cámara mockeada.
const employee = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };

async function mockApi(page: Page) {
  const apiCalls: string[] = [];
  await page.route("http://127.0.0.1:59999/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    apiCalls.push(`${request.method()} ${path}`);
    if (path === "/clock/device/status") return route.fulfill({ json: { data: { id: "00000000-0000-4000-8000-000000000001", name: "TEST E2E", status: "ACTIVE" } } });
    if (path === "/time-entries/clock/employees") return route.fulfill({ json: { data: [employee] } });
    if (path === "/time-entries/clock/status") return route.fulfill({ json: { data: { employee, openShift: null } } });
    return route.fulfill({ status: 404, json: { error: { code: "ROUTE_NOT_FOUND" } } });
  });
  return apiCalls;
}

async function seedActiveIdentity(page: Page) {
  await page.addInitScript(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("fichador-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("identity");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("identity", "readwrite");
      tx.objectStore("identity").put({ id: "00000000-0000-4000-8000-000000000001", secret: "e2e-secret" }, "current");
      tx.oncomplete = () => resolve();
    };
  }));
}

test("abre, busca, selecciona, abre la cámara, cancela y vuelve al inicio sin fichar", async ({ page }) => {
  const apiCalls = await mockApi(page);
  await seedActiveIdentity(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Marcar ingreso/ })).toBeDisabled();

  await page.getByLabel("Buscar por nombre o apellido").fill("Gomez");
  await page.getByRole("button", { name: /Gomez, Ana/ }).click();
  await expect(page.getByText("Legajo 100 · DNI terminado en 456")).toBeVisible();

  await page.getByRole("button", { name: /Marcar ingreso/ }).click();
  await expect(page.getByRole("heading", { name: "Confirmar fichada con foto" })).toBeVisible();
  await expect.poll(() => page.locator("video.face-video").evaluate((video: HTMLVideoElement) => Boolean(video.srcObject))).toBe(true);
  await expect(page.getByText("No se detectó una cara.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Confirmar ingreso" })).toBeDisabled();

  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("heading", { name: "Confirmar fichada con foto" })).toBeHidden();
  await page.getByRole("button", { name: "Cambiar empleado" }).click();
  await expect(page.getByLabel("Buscar por nombre o apellido")).toHaveValue("");

  expect(apiCalls).toEqual(["GET /clock/device/status", "GET /clock/device/status", "GET /time-entries/clock/employees", "POST /time-entries/clock/status"]);
});

test("enrolamiento explícito: registra, muestra código y libera al ser aprobado", async ({ page }) => {
  await page.route("http://127.0.0.1:59999/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/clock/device/register") return route.fulfill({ status: 201, json: { data: { device: { id: "00000000-0000-4000-8000-000000000002", status: "PENDING", pairingCode: "ABCD-2345", pairingExpiresAt: new Date(Date.now() + 600_000).toISOString() }, secret: "individual-secret" } } });
    if (path === "/clock/device/status") {
      return route.fulfill({ json: { data: { id: "00000000-0000-4000-8000-000000000002", name: "TEST E2E", status: "ACTIVE" } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "ROUTE_NOT_FOUND" } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Configurar dispositivo" }).click();
  await expect(page.getByText("ABCD-2345")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Esperando aprobación" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible({ timeout: 12_000 });
});

for (const path of ["/legajos", "/configuracion", "/usuarios", "/auditoria"]) {
  test(`${path} no existe en el fichador: 404 propio, sin endpoints administrativos`, async ({ page }) => {
    const apiCalls = await mockApi(page);
    await seedActiveIdentity(page);
    await page.goto(path);

    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
    await page.getByRole("link", { name: "Ir al fichador" }).click();
    await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible();
    expect(apiCalls).toEqual(["GET /clock/device/status", "GET /clock/device/status"]);
  });
}
