import { expect, test, type Page, type Route } from "@playwright/test";

// R4.4 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.6) — salida dudosa en
// un navegador real (cámara falsa, detector falso del servidor 5186, API
// mockeado con page.route): el backend responde la pregunta previa SIN haber
// registrado nada; la persona elige ENTRADA (recomendado) o confirma la
// SALIDA. Nada sale a un backend real.
//
// Con FICHADOR_QA_DIR definida (sólo QA visual local, nunca en CI) guarda
// capturas del diálogo en los tamaños de la regla del fichador.
const API = "http://127.0.0.1:59999/api";
const employee = { id: "employee-1", dni: "30123456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };
const OPEN = { id: "shift-0700", startAt: "2026-11-06T10:00:00.000Z" };
const guidance = {
  kind: "EXIT_CONFIRMATION_REQUIRED",
  openShiftId: OPEN.id,
  openShiftStartAt: OPEN.startAt,
  previousBlock: { startAt: "2026-11-06T10:00:00.000Z", endAt: "2026-11-06T14:00:00.000Z" },
  nextBlock: { key: "employee-1|2026-11-06T22:00:00.000Z", startAt: "2026-11-06T22:00:00.000Z" },
  exitAt: "2026-11-06T22:02:00.000Z",
  exitDurationMinutes: 722,
};
const QUESTION = { error: { code: "CLOCK_EXIT_CONFIRMATION_REQUIRED", message: "Tu turno anterior terminó a las 11:00 y ahora tenés otro turno programado a las 19:00. ¿Estás ingresando al nuevo turno o querés registrar la salida anterior?", clockGuidance: guidance } };
type Body = Record<string, unknown>;
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, json: body });

async function openKiosk(page: Page, onPunch: (route: Route, body: Body, count: number) => Promise<void> | void) {
  const punches: Body[] = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === "/clock/device/status") return json(route, 200, { data: { id: "00000000-0000-4000-8000-000000000001", name: "TEST R4.4", status: "ACTIVE" } });
    if (path === "/clock/heartbeat") return json(route, 200, { data: { device: { id: "00000000-0000-4000-8000-000000000001", name: "TEST R4.4", status: "ACTIVE", establishment: null }, serverTime: new Date().toISOString() } });
    if (path === "/clock/employees") return json(route, 200, { data: [employee] });
    if (path === "/clock/status") return json(route, 200, { data: { employee, openShift: { id: OPEN.id, startAt: new Date(Date.now() - 12 * 3600_000).toISOString() } } });
    if (path === "/clock/photo-punch") {
      const body = request.postDataJSON() as Body;
      punches.push(body);
      return onPunch(route, body, punches.length);
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
  await page.getByLabel("Buscar por nombre, apellido o DNI").fill("Gomez");
  await page.getByRole("button", { name: /Gomez, Ana/ }).click();
  await page.getByRole("button", { name: /Marcar salida/ }).click();
  const confirm = page.getByRole("button", { name: "Confirmar salida" });
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await confirm.click();
  return punches;
}

test("salida dudosa → «Registrar ENTRADA» (recomendado, con foco) → un INGRESO nuevo con la misma foto", async ({ page }) => {
  const punches = await openKiosk(page, (route, body, count) => (count === 1
    ? json(route, 409, QUESTION)
    : json(route, 201, { data: { employee, previousOpenShift: { ...OPEN, status: "FALTA_SALIDA" }, workShift: { id: "shift-1900", startAt: "2026-11-06T22:02:00.000Z" } } })));
  const dialog = page.getByRole("dialog", { name: "¿Estás ingresando a tu turno de las 19:00?" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar ENTRADA" })).toBeFocused();
  await expect(dialog).toContainText("Tu jornada quedará de 07:00 a 19:02 (12 h 02 min).");
  await expect(dialog).not.toContainText("CLOCK_");
  await page.getByRole("button", { name: "Registrar ENTRADA" }).click();
  await expect(page.getByText("Entrada registrada")).toBeVisible();
  expect(punches).toHaveLength(2);
  expect(punches[1]).toMatchObject({ punchType: "IN", photo: punches[0]!.photo });
  expect(punches[1]!.requestId).not.toBe(punches[0]!.requestId);
});

test("salida dudosa → «Confirmar SALIDA anterior» → SALIDA ligada a la jornada y al turno siguiente", async ({ page }) => {
  const punches = await openKiosk(page, (route, _body, count) => (count === 1
    ? json(route, 409, QUESTION)
    : json(route, 201, { data: { employee, workShift: { id: OPEN.id, startAt: OPEN.startAt, endAt: "2026-11-06T22:02:00.000Z", totalMinutes: 722, totalHours: 12.03 }, segments: [] } })));
  await page.getByRole("button", { name: "Confirmar SALIDA anterior" }).click();
  await expect(page.getByText("Salida registrada")).toBeVisible();
  expect(punches[1]).toMatchObject({ punchType: "OUT", exitConfirmation: { openShiftId: OPEN.id, nextBlockKey: guidance.nextBlock.key } });
});

const QA_SIZES = [[320, 568], [390, 844], [844, 390], [768, 1024], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]] as const;

test("QA visual del diálogo (sólo con FICHADOR_QA_DIR): sin desbordes horizontales en todos los tamaños", async ({ page }) => {
  const dir = process.env.FICHADOR_QA_DIR;
  test.skip(!dir, "QA visual local");
  await openKiosk(page, (route) => json(route, 409, QUESTION));
  await expect(page.getByRole("dialog")).toBeVisible();
  for (const [width, height] of QA_SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => {
      const dialog = document.querySelector(".modal")!.getBoundingClientRect();
      const buttons = [...document.querySelectorAll(".exit-decision .button")].map((button) => button.getBoundingClientRect());
      return {
        horizontal: document.documentElement.scrollWidth > window.innerWidth,
        dialogOutside: dialog.left < 0 || dialog.right > window.innerWidth,
        smallTarget: buttons.some((rect) => rect.height < 44),
      };
    });
    expect(overflow, `${width}x${height}`).toEqual({ horizontal: false, dialogOutside: false, smallTarget: false });
    await page.screenshot({ path: `${dir}/exit-decision-${width}x${height}.png` });
  }
});
