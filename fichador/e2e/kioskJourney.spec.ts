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
    if (path === "/time-entries/clock/employees") return route.fulfill({ json: { data: [employee] } });
    if (path === "/time-entries/clock/status") return route.fulfill({ json: { data: { employee, openShift: null } } });
    return route.fulfill({ status: 404, json: { error: { code: "ROUTE_NOT_FOUND" } } });
  });
  return apiCalls;
}

test("abre, busca, selecciona, abre la cámara, cancela y vuelve al inicio sin fichar", async ({ page }) => {
  const apiCalls = await mockApi(page);
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

  expect(apiCalls).toEqual(["GET /time-entries/clock/employees", "POST /time-entries/clock/status"]);
});

for (const path of ["/legajos", "/configuracion", "/usuarios", "/auditoria"]) {
  test(`${path} no existe en el fichador: 404 propio, sin llamadas al API`, async ({ page }) => {
    const apiCalls = await mockApi(page);
    await page.goto(path);

    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
    await page.getByRole("link", { name: "Ir al fichador" }).click();
    await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible();
    expect(apiCalls).toEqual([]);
  });
}
