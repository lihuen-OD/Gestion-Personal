import { expect, test, type Page } from "@playwright/test";

// F3 — PWA del fichador contra el build real. El API siempre está mockeado;
// "offline" corta toda la red del navegador (también el API mockeado), así
// que lo único que puede responder es el precache del service worker.
const employee = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };

async function mockApi(page: Page) {
  await page.route("http://127.0.0.1:59999/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/clock/employees")) return route.fulfill({ json: { data: [employee] } });
    return route.fulfill({ json: { data: { employee, openShift: null } } });
  });
}

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test("instalable: manifest enlazado y service worker activo con el shell y MediaPipe precacheados", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", short_name: "Fichador" });

  await waitForServiceWorkerControl(page);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
    return urls;
  });
  expect(cached).toEqual(expect.arrayContaining(["/index.html", "/mediapipe/wasm/vision_wasm_internal.wasm", "/mediapipe/models/blaze_face_short_range.tflite"]));
  expect(cached.some((path) => path.includes("nosimd"))).toBe(false);
});

test("sin red: la app abre, bloquea la fichada con un estado claro, el 404 sigue local y la cámara+detector funcionan", async ({ page, context }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const { hostname } = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(hostname)) external.push(request.url());
  });
  await mockApi(page);
  await page.goto("/");
  await waitForServiceWorkerControl(page);

  // Empleado elegido con red; después se corta todo (incluido el API mockeado).
  await page.getByLabel("Buscar por nombre o apellido").fill("Gomez");
  await page.getByRole("button", { name: /Gomez, Ana/ }).click();
  await expect(page.getByRole("button", { name: /Marcar ingreso/ })).toBeEnabled();
  await page.unrouteAll();
  await context.setOffline(true);

  // Detector offline: el WASM y el modelo salen del precache.
  await page.getByRole("button", { name: /Marcar ingreso/ }).click();
  await expect(page.getByText("No se detectó una cara.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Cancelar" }).click();

  // La app abre sin red y bloquea la operación con un estado claro.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible();
  await page.getByLabel("Buscar por nombre o apellido").fill("Gomez");
  await expect(page.getByRole("alert")).toHaveText(/No hay conexión con el servidor/);
  await expect(page.getByRole("button", { name: /Marcar ingreso/ })).toBeDisabled();

  // Una ruta inválida sigue resolviéndose dentro del fichador.
  await page.goto("/legajos");
  await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();

  expect(external).toEqual([]);
});
