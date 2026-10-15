import { expect, test } from "@playwright/test";

// F11 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §30) — CSP enforced contra
// el build real: `vite preview` sirve los mismos headers que el hosting
// (scripts/hosting-headers.mjs). El fichador, el service worker y el detector
// de rostros REAL (MediaPipe self-hosted, WASM) tienen que cargar sin una sola
// violación. Cámara falsa de Chromium y API mockeado, como el resto de E2E.
// Safari/iPad no se prueba acá: queda en la checklist del piloto (F12).
const employee = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };

test("CSP enforced: la PWA y el detector de rostros cargan sin violaciones", async ({ page }) => {
  const consoleViolations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (load|execute|connect|apply|compile|create)/i.test(message.text())) consoleViolations.push(message.text());
  });
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = store;
    document.addEventListener("securitypolicyviolation", (event) => store.push(`${event.effectiveDirective} ${event.blockedURI}`));
  });
  await page.route("http://127.0.0.1:59999/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/clock/device/status")) return route.fulfill({ json: { data: { id: "00000000-0000-4000-8000-000000000001", name: "TEST E2E", status: "ACTIVE" } } });
    if (path.endsWith("/clock/employees")) return route.fulfill({ json: { data: [employee] } });
    return route.fulfill({ json: { data: { employee, openShift: null } } });
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

  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self' http://127.0.0.1:59999");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();

  await expect(page.getByRole("heading", { name: "Fichador de personal" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  await page.getByLabel("Buscar por nombre o apellido").fill("Gomez");
  await page.getByRole("button", { name: /Gomez, Ana/ }).click();
  await page.getByRole("button", { name: /Marcar ingreso/ }).click();
  // El detector real cargó (WASM + modelo) y analiza la cámara falsa, que no tiene rostro.
  await expect(page.getByText("No se detectó una cara.")).toBeVisible({ timeout: 45_000 });

  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
  expect(consoleViolations).toEqual([]);
});
