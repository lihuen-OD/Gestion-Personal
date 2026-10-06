import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";
import { NOTIFICATIONS_POLL_INTERVAL_MS, NOTIFICATIONS_REFRESH_WINDOW_MAX, workforceApiService, type SystemNotification } from "../services/api/workforceApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import { TOAST_SUCCESS_MS } from "../utils/toast";

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md,
// punto 25): NoveltyModal (montado acá vía "Crear novedad") ahora usa
// useAuth para filtrar el catálogo por rol -- se mockea RRHH (autoridad
// global, ve todo) para no cambiar el comportamiento de estos tests.
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "RRHH", email: "", password: "", role: "Nivel 1 - RRHH", status: "Activo" }, login: vi.fn(), loginAs: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, notifications: vi.fn(), readNotification: vi.fn() } };
});

// Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): mocks para el
// flujo "Crear novedad" desde Notificaciones. employeeApiService se
// mockea sólo para poder afirmar que NUNCA se llama -- la notificación ya
// trae el empleado resuelto (cuando lo trae), no hace falta ningún fetch
// adicional.
vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getById: vi.fn() } };
});
vi.mock("../services/api/noveltyApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyApiService")>();
  return { ...actual, noveltyApiService: { ...actual.noveltyApiService, create: vi.fn() } };
});
vi.mock("../services/api/noveltyTypeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyTypeApiService")>();
  return { ...actual, noveltyTypeApiService: { ...actual.noveltyTypeApiService, getAll: vi.fn() } };
});
vi.mock("../services/api/hourConceptApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/hourConceptApiService")>();
  return { ...actual, hourConceptApiService: { ...actual.hourConceptApiService, getAll: vi.fn().mockResolvedValue([]) } };
});

type ListResult = Awaited<ReturnType<typeof workforceApiService.notifications>>;

function buildNotification(overrides: Partial<SystemNotification> = {}): SystemNotification {
  return {
    id: "notif-1",
    type: "CIERRE_MENSUAL",
    priority: "ALTA",
    title: "Cierres mensuales recibidos",
    message: "3 legajos de 2026-08 esperan aprobación.",
    status: "NO_LEIDA",
    eventAt: "2026-08-20T10:00:00.000Z",
    createdAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

function buildGenericActiveType(): NoveltyType {
  return {
    id: "type-vacaciones",
    code: "NOV-VACACIONES",
    name: "Vacaciones",
    uiColor: "blue",
    kind: "VACACIONES",
    description: "",
    status: "ACTIVO",
    rules: {
      exportsToFinnegans: false,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsHours: false,
      timeEntryBehavior: "NO_BLOQUEA",
      allowsDateRange: true,
      finnegansValueUnit: null,
      finnegansRequiresValidity: false,
    },
    allowedLoadRoles: [],
    approvalRoles: [],
    finnegansCode: null,
    finnegansName: null,
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationsPage — Etapa 9I (paginación real, antes fetch-all take:200)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay notificaciones en pantalla", async () => {
    let resolveList!: (value: ListResult) => void;
    vi.mocked(workforceApiService.notifications).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveList({ items: [buildNotification()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null } });
    await screen.findByText("Cierres mensuales recibidos");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("pide sólo las últimas 20 (page=1, take=20), no todas — y una sola vez al montar (sin llamadas duplicadas)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [buildNotification()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null } });

    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    expect(workforceApiService.notifications).toHaveBeenCalledTimes(1);
    expect(workforceApiService.notifications).toHaveBeenCalledWith({ page: 1, take: 20, status: undefined, dateFrom: undefined, dateTo: undefined });
  });

  it("'Cargar más' agrega la página siguiente sin blanquear ni reemplazar las notificaciones ya visibles", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "notif-1", title: "Cierres mensuales recibidos" })],
      meta: { total: 25, page: 1, pageSize: 20, hasMore: true, nextCursor: "cursor-notif-1" },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    let resolveNextPage!: (value: ListResult) => void;
    vi.mocked(workforceApiService.notifications).mockReturnValue(new Promise((resolve) => { resolveNextPage = resolve; }));

    await user.click(screen.getByRole("button", { name: /Cargar/ }));

    // Mientras la página 2 está en vuelo, la notificación de la página 1
    // sigue visible y no aparece el skeleton de carga completo.
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();
    // Cursor de la última fila, no un número de página.
    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ after: "cursor-notif-1", take: 20, status: undefined, dateFrom: undefined, dateTo: undefined });

    resolveNextPage({
      items: [buildNotification({ id: "notif-2", title: "Corrección posterior al cierre" })],
      meta: { total: 25, page: 2, pageSize: 20, hasMore: false, nextCursor: null },
    });

    await waitFor(() => expect(screen.getByText("Corrección posterior al cierre")).toBeInTheDocument());
    // Se agregó, no se reemplazó — la de la página 1 sigue en pantalla.
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
  });

  it("cambiar el filtro de Estado pide status server-side y no blanquea la lista mientras llega la respuesta nueva", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ title: "Cierres mensuales recibidos" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    let resolveFiltered!: (value: ListResult) => void;
    vi.mocked(workforceApiService.notifications).mockReturnValue(new Promise((resolve) => { resolveFiltered = resolve; }));

    await user.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");

    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: "NO_LEIDA", dateFrom: undefined, dateTo: undefined });
    // Todavía no blanquea mientras la respuesta filtrada está en vuelo.
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();

    resolveFiltered({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false, nextCursor: null } });
    await screen.findByText("No hay notificaciones para los filtros seleccionados.");
  });

  it("marcar una notificación como leída actualiza el ítem de inmediato (sin esperar ningún refetch)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(workforceApiService.readNotification).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    await user.click(screen.getByRole("button", { name: /Marcar leída/ }));

    // La fila pasa a "Leída" apenas resuelve el POST — antes de que exista
    // cualquier refetch. La notificación sigue visible (no se blanqueó ni
    // recargó toda la lista para lograrlo).
    await screen.findByText("Leída");
    expect(workforceApiService.readNotification).toHaveBeenCalledWith("notif-1");
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
  });

  // Etapa 15M.19C (docs/decisions/NOTIFICATIONS_PAGE_LIVE_REFRESH_15M19C.md
  // §11/§12): markRead ya disparaba "app:notifications-changed" (para que la
  // campana del topbar se actualice) — ahora NotificationsPage también
  // escucha ese mismo evento y dispara un refresco silencioso propio, sin
  // esperar al próximo tick del polling.
  it("marcar como leída dispara además un refresco silencioso propio (reacciona a su propio evento app:notifications-changed)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(workforceApiService.readNotification).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");
    expect(workforceApiService.notifications).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Marcar leída/ }));
    await screen.findByText("Leída");

    await waitFor(() => expect(workforceApiService.notifications).toHaveBeenCalledTimes(2));
    // El refresco silencioso no reemplaza la lista ni muestra loading: sigue
    // exactamente la misma fila en pantalla, ahora "Leída".
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("si marcar como leída falla, muestra un error local sin romper la lista visible", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(workforceApiService.readNotification).mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    await user.click(screen.getByRole("button", { name: /Marcar leída/ }));

    await screen.findByText("No se pudo marcar la notificación como leída.");
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
  });

  it("sin filtros y sin notificaciones: 'Todavía no hay notificaciones.' (distinto del vacío por filtros)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false, nextCursor: null } });

    renderPage();

    await screen.findByText("Todavía no hay notificaciones.");
    expect(screen.queryByText("No hay notificaciones para los filtros seleccionados.")).not.toBeInTheDocument();
  });

  it("muestra un error local (sin texto técnico) si falla la carga inicial, y permite reintentar", async () => {
    vi.mocked(workforceApiService.notifications).mockRejectedValueOnce(new Error("Request failed with status 500"));

    renderPage();

    await screen.findByText("No se pudieron cargar las notificaciones.");
    expect(screen.queryByText(/500|schema|payload/i)).not.toBeInTheDocument();

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({ items: [buildNotification()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    await screen.findByText("Cierres mensuales recibidos");
  });
});

// Etapa 14G.6 (docs/decisions/WORKFORCE_MANAGEMENT_NOTIFICATIONS_PERFORMANCE_14G6.md):
// "Ver detalle" marcaba como leída como efecto colateral de la navegación,
// además del botón explícito "Marcar leída" que hacía exactamente lo mismo
// -- sin ninguna distinción visual entre ambas acciones. Se separó
// navegación de escritura: "Ver detalle" sólo navega, "Marcar leída" sigue
// siendo la única forma de marcar como leída.
describe("NotificationsPage — Etapa 14G.6 (Ver detalle no marca como leída)", () => {
  it("hacer click en 'Ver detalle' NO ejecuta markRead (no dispara ninguna escritura)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA", link: "/novedades" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    await user.click(screen.getByRole("link", { name: "Ver detalle" }));

    expect(workforceApiService.readNotification).not.toHaveBeenCalled();
  });

  it("'Ver detalle' sigue navegando (link con el href correcto) aunque ya no marque como leída", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA", link: "/novedades" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    expect(screen.getByRole("link", { name: "Ver detalle" })).toHaveAttribute("href", "/novedades");
  });

  it("el botón explícito 'Marcar leída' sigue ejecutando la escritura, sin cambios", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA", link: "/novedades" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(workforceApiService.readNotification).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    await user.click(screen.getByRole("button", { name: /Marcar leída/ }));

    expect(workforceApiService.readNotification).toHaveBeenCalledWith("notif-1");
  });

  it("una notificación sin link no muestra 'Ver detalle', sólo el botón de marcar leída", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA", link: null })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    expect(screen.queryByRole("link", { name: "Ver detalle" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar leída/ })).toBeInTheDocument();
  });
});

// Ajuste visual: "Ver detalle" y "Crear novedad" pasan de texto/icono+texto a
// icono solo (mismo patrón `table-icon-action` que ya usa el resto de la
// app), conservando accesibilidad vía title/aria-label y el mismo
// comportamiento funcional (navegación / apertura del modal de novedad).
describe("NotificationsPage — 'Ver detalle' y 'Crear novedad' como icono solo (ajuste visual)", () => {
  it("'Ver detalle' se renderiza como icono (Eye) con title y aria-label 'Ver detalle', mismo estilo que 'Crear novedad'", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        type: "ALERTA_FICHADA",
        link: "/novedades",
        employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    const detailLink = screen.getByRole("link", { name: "Ver detalle" });
    const noveltyButton = screen.getByRole("button", { name: "Crear novedad" });

    expect(detailLink).toHaveAttribute("title", "Ver detalle");
    expect(detailLink.className).toBe("table-icon-action");
    expect(detailLink.querySelector("svg.lucide-eye")).not.toBeNull();

    expect(noveltyButton).toHaveAttribute("title", "Crear novedad");
    expect(noveltyButton.className).toBe("table-icon-action");
    expect(noveltyButton.querySelector("svg.lucide-file-plus2")).not.toBeNull();

    // Consistencia visual: ambas acciones comparten exactamente la misma
    // clase (mismo tamaño/alineación/hover/focus definidos en styles.css).
    expect(detailLink.className).toBe(noveltyButton.className);
  });
});

async function findModalScope() {
  const heading = await screen.findByText("Nueva novedad");
  return within(heading.closest(".modal") as HTMLElement);
}

// Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md, ajuste
// final): "Crear novedad" es el punto PRINCIPAL de este flujo --
// Notificaciones agrupa TODAS las alertas del fichador (turnos, fichada,
// ausencia), no sólo las de turno. Sólo se ofrece cuando la notificación
// ya trae `employee` resuelto por el backend (`workforce.service.ts::notifications`
// enriquece ShiftAlert/WorkShift/Employee/AttendanceInactivityIncident --
// los 4 entityType con `employee`, incluido "no asistió" desde este
// ajuste). Para cualquier otro entityType (cierres, correcciones,
// novedades pendientes) sigue sin haber empleado resuelto -- ahí no se
// ofrece el atajo.
describe("NotificationsPage — Etapa 15G.2 (crear novedad desde notificación — FLUJO PRINCIPAL)", () => {
  it("una notificación con empleado resuelto (ej. ALERTA_FICHADA — llegada tarde) muestra 'Crear novedad'", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ type: "ALERTA_FICHADA", title: "Llegada tarde", message: "Ana Gomez llegó 1h 30m tarde.", employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" } })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /Crear novedad/ })).toBeInTheDocument();
  });

  // Ajuste final: "no asistió" ahora SÍ puede crear novedad desde
  // Notificaciones, gracias al enriquecimiento agregado en
  // workforce.service.ts::notifications para AttendanceInactivityIncident.
  it("una notificación de 'no asistió' (SIN_ACTIVIDAD_REGISTRADA) con empleado resuelto también muestra 'Crear novedad'", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        id: "notif-ausencia",
        type: "SIN_ACTIVIDAD_REGISTRADA",
        title: "Sin actividad registrada",
        message: "El legajo no registró fichadas, jornadas ni horas cargadas el 20/08/2026.",
        employee: { id: "employee-5", legajo: "500", firstName: "Elena", lastName: "Soto" },
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /Crear novedad/ })).toBeInTheDocument();
  });

  it("una notificación SIN empleado resuelto (ej. cierres/correcciones/novedades pendientes) no muestra 'Crear novedad'", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ type: "CIERRE_MENSUAL", title: "Cierres mensuales recibidos" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });

    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    expect(screen.queryByRole("button", { name: /Crear novedad/ })).not.toBeInTheDocument();
  });

  it("click en 'Crear novedad' de una ausencia (no asistió) precarga empleado/fecha/observación humana sin sugerir tipo, sin id técnico y sin llamar a employeeApiService.getById", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        id: "notif-ausencia",
        type: "SIN_ACTIVIDAD_REGISTRADA",
        title: "Sin actividad registrada",
        message: "El legajo no registró fichadas, jornadas ni horas cargadas el 20/08/2026.",
        createdAt: "2026-08-20T09:00:00.000Z",
        employee: { id: "employee-5", legajo: "500", firstName: "Elena", lastName: "Soto" },
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildGenericActiveType()]);

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Crear novedad/ }));

    const modal = await findModalScope();
    expect(modal.getByLabelText("Desde")).toHaveValue("2026-08-20");
    expect(modal.getByText(/Origen: alerta del fichador/)).toBeInTheDocument();
    expect(modal.getByText(/El legajo no registró fichadas/)).toBeInTheDocument();
    expect(modal.getByText("500 · Soto, Elena")).toBeInTheDocument();
    expect(modal.queryByText(/notif-ausencia/)).not.toBeInTheDocument();
    // Sin tipo garantizado de "Ausencia" -- cae al primer tipo activo, el
    // usuario elige manualmente (no se crea un tipo nuevo para esto).
    expect(modal.getByLabelText("Tipo de novedad")).toHaveValue("type-vacaciones");
    expect(employeeApiService.getById).not.toHaveBeenCalled();
  });

  it("click en 'Crear novedad' abre NoveltyModal precargado (empleado/fecha/observación humana, sin id técnico) SIN llamar a employeeApiService.getById", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        id: "204bd1dc-ea7c-4b7b-a029-264faf5796ac",
        type: "ALERTA_FICHADA",
        title: "Llegada tarde",
        message: "Ana Gomez llegó 1h 30m tarde.",
        createdAt: "2026-08-20T12:00:00.000Z",
        employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildGenericActiveType()]);

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Crear novedad/ }));

    const modal = await findModalScope();
    expect(modal.getByLabelText("Desde")).toHaveValue("2026-08-20");
    expect(modal.getByText(/Origen: alerta del fichador/)).toBeInTheDocument();
    expect(modal.getByText(/Ana Gomez llegó 1h 30m tarde/)).toBeInTheDocument();
    expect(modal.getByText(/Las horas reales se mantienen según fichador\/carga horaria/)).toBeInTheDocument();
    expect(modal.getByText("100 · Gomez, Ana")).toBeInTheDocument();
    expect(modal.queryByText(/204bd1dc-ea7c-4b7b-a029-264faf5796ac/)).not.toBeInTheDocument();
    expect(employeeApiService.getById).not.toHaveBeenCalled();
  });

  it("guardar la novedad precargada usa el flujo normal de creación (POST /novelties) y no marca la notificación como leída", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        id: "notif-alerta",
        type: "ALERTA_FICHADA",
        title: "Llegada tarde",
        employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
        status: "NO_LEIDA",
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildGenericActiveType()]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-1" } as never]);

    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Crear novedad/ }));
    const modal = await findModalScope();
    await userEvent.click(modal.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ["employee-1"], noveltyTypeId: "type-vacaciones" }),
    ));
    await screen.findByText("Novedad creada. RRHH la revisa como cualquier otra novedad.");
    expect(workforceApiService.readNotification).not.toHaveBeenCalled();
  });
});

// Etapa 15M.16 (docs/PROJECT_UI_CONTEXT.md "Feedback temporal vs banners
// persistentes"): el mensaje de éxito quedaba anclado en pantalla para
// siempre -- al `.toast` de "Novedad creada..." le faltaba el
// `setTimeout(() => setNoveltyNotice(""), ...)` que el resto de los avisos
// transitorios de la app (WorkRegimesPage, HourConceptsPage,
// AssociatedEmployeesPanel, etc.) siempre tienen. Mismo bug duplicado en
// AttendancePage.tsx (mismo flujo de origen, Etapa 15G.2).
describe("NotificationsPage — Etapa 15M.16 (el toast de 'Novedad creada' es temporal)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function mockNotificationWithNovelty() {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        id: "notif-alerta",
        type: "ALERTA_FICHADA",
        title: "Llegada tarde",
        employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
        status: "NO_LEIDA",
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildGenericActiveType()]);
  }

  async function createNoveltyFromFirstNotification() {
    await userEvent.click(await screen.findByRole("button", { name: /Crear novedad/ }));
    const modal = await findModalScope();
    await userEvent.click(modal.getByRole("button", { name: "Guardar novedad" }));
  }

  // Caso A
  it("Caso A: al crear la novedad, el mensaje aparece como región de estado (role=status), no como banner mudo", async () => {
    mockNotificationWithNovelty();
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-1" } as never]);

    renderPage();
    await createNoveltyFromFirstNotification();

    const message = await screen.findByText("Novedad creada. RRHH la revisa como cualquier otra novedad.");
    expect(message.closest('[role="status"]')).not.toBeNull();
  });

  // Caso B
  it("Caso B: el mensaje desaparece solo después de TOAST_SUCCESS_MS, sin acción del usuario", async () => {
    mockNotificationWithNovelty();
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-1" } as never]);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderPage();
    await createNoveltyFromFirstNotification();
    await vi.waitFor(() => expect(screen.getByText("Novedad creada. RRHH la revisa como cualquier otra novedad.")).toBeInTheDocument());

    vi.advanceTimersByTime(TOAST_SUCCESS_MS);

    await vi.waitFor(() =>
      expect(screen.queryByText("Novedad creada. RRHH la revisa como cualquier otra novedad.")).not.toBeInTheDocument(),
    );
  });

  // Caso D
  it("Caso D: si falla la creación, el mensaje de éxito nunca aparece (el error queda dentro del modal)", async () => {
    mockNotificationWithNovelty();
    vi.mocked(noveltyApiService.create).mockRejectedValue(new Error("network"));

    renderPage();
    await createNoveltyFromFirstNotification();

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalled());
    expect(screen.queryByText("Novedad creada. RRHH la revisa como cualquier otra novedad.")).not.toBeInTheDocument();
  });

  // Caso E: nada de esto vive en localStorage/sessionStorage/route state --
  // es puro useState del componente, así que un montaje nuevo (equivalente
  // a navegar y volver, o a un refresh) nunca puede heredarlo.
  it("Caso E: no queda ningún mensaje persistido — un montaje nuevo de la pantalla no lo hereda", async () => {
    mockNotificationWithNovelty();
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-1" } as never]);

    const { unmount } = renderPage();
    await createNoveltyFromFirstNotification();
    await screen.findByText("Novedad creada. RRHH la revisa como cualquier otra novedad.");
    unmount();

    renderPage();
    await screen.findByText("Llegada tarde");
    expect(screen.queryByText("Novedad creada. RRHH la revisa como cualquier otra novedad.")).not.toBeInTheDocument();
  });
});

// Etapa 15M.19C (docs/decisions/NOTIFICATIONS_PAGE_LIVE_REFRESH_15M19C.md):
// refresco automático sin F5 — mismo endpoint/capa de acceso, mismo
// intervalo que la campana del topbar, sin SSE/WebSocket.
describe("NotificationsPage — Etapa 15M.19C (refresco automático sin F5)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Caso A (fetch inicial) ya cubierto por la suite de la Etapa 9I de arriba.

  it("Caso B: al cumplirse el intervalo de polling, vuelve a pedir la ventana visible (through = última fila cargada, acotada)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-notif-1" },
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument());
    expect(workforceApiService.notifications).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(workforceApiService.notifications).toHaveBeenCalledTimes(2);
    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ through: "cursor-notif-1", take: NOTIFICATIONS_REFRESH_WINDOW_MAX, status: undefined, dateFrom: undefined, dateTo: undefined });
  });

  it("Caso C: una notificación nueva que aparece en el siguiente poll se muestra sin remontar la página", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Notificación A")).toBeInTheDocument());

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" }), buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    await vi.waitFor(() => expect(screen.getByText("Notificación B")).toBeInTheDocument());
    expect(screen.getByText("Notificación A")).toBeInTheDocument();
  });

  it("Caso D: el polling conserva el filtro activo (No leídas)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false, nextCursor: null } });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Todavía no hay notificaciones.")).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    await vi.waitFor(() => expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: "NO_LEIDA" }));

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: "NO_LEIDA" });
  });

  it("Caso E: un fallo temporal de polling no vacía ni tapa la lista ya visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument());

    vi.mocked(workforceApiService.notifications).mockRejectedValueOnce(new Error("network error"));
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
    expect(screen.queryByText("No se pudieron cargar las notificaciones.")).not.toBeInTheDocument();

    // El siguiente tick reintenta solo, sin acción del usuario.
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" }), buildNotification()],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);
    await vi.waitFor(() => expect(screen.getByText("Notificación B")).toBeInTheDocument());
  });

  it("Caso F: el evento app:notifications-changed dispara un refetch inmediato, sin esperar al polling", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await screen.findByText("Notificación A");

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" }), buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    window.dispatchEvent(new Event("app:notifications-changed"));

    await screen.findByText("Notificación B");
  });

  it("recuperar el foco de la ventana también dispara un refetch inmediato (§21)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await screen.findByText("Notificación A");

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" }), buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    window.dispatchEvent(new Event("focus"));

    await screen.findByText("Notificación B");
  });

  it("Caso G: al desmontar la página, se limpia el timer — no sigue pidiendo en segundo plano", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    const { unmount } = renderPage();
    await vi.waitFor(() => expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument());
    const callsBeforeUnmount = vi.mocked(workforceApiService.notifications).mock.calls.length;

    unmount();
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS * 3);

    expect(workforceApiService.notifications).toHaveBeenCalledTimes(callsBeforeUnmount);
  });

  it("Caso H: el refresco silencioso nunca muestra el skeleton de carga completa", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument());
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(document.querySelector(".skeleton-bar")).toBeNull();
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
  });

  // docs/decisions/NOTIFICATIONS_EVENT_ORDER.md: "Cargar más" pide por cursor
  // (after) y el refresco vuelve a pedir la ventana visible completa
  // (through) y la reemplaza. La pantalla nunca reordena: muestra el orden
  // del backend (eventAt, createdAt, id DESC).
  describe("cursor estable + refresco de la ventana visible", () => {
    const visibleTitles = () => Array.from(document.querySelectorAll(".notification-row b")).map((node) => node.textContent);

    async function renderWithTwoPages() {
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 2, page: 1, pageSize: 20, hasMore: true, nextCursor: "cursor-p1" },
      });
      renderPage();
      await screen.findByText("Página uno");
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p2", title: "Página dos" })],
        meta: { total: 2, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-p2" },
      });
      await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
      await screen.findByText("Página dos");
    }

    it("con 2 páginas cargadas, el refresco pide hasta la última fila (through) y una atrasada aparece EN SU POSICIÓN, no arriba", async () => {
      await renderWithTwoPages();

      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p1", title: "Página uno" }), buildNotification({ id: "late", title: "Atrasada por catch-up" }), buildNotification({ id: "p2", title: "Página dos" })],
        meta: { total: 3, page: 1, pageSize: 100, hasMore: false, nextCursor: "cursor-p2" },
      });
      window.dispatchEvent(new Event("app:notifications-changed"));

      await screen.findByText("Atrasada por catch-up");
      expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ through: "cursor-p2", take: NOTIFICATIONS_REFRESH_WINDOW_MAX, status: undefined, dateFrom: undefined, dateTo: undefined });
      expect(visibleTitles()).toEqual(["Página uno", "Atrasada por catch-up", "Página dos"]);
    });

    it("'Cargar más' después de un refresco sigue desde el cursor que devolvió ese refresco, sin duplicar", async () => {
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 3, page: 1, pageSize: 20, hasMore: true, nextCursor: "cursor-p1" },
      });
      renderPage();
      await screen.findByText("Página uno");
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "new", title: "Nueva" }), buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 3, page: 1, pageSize: 100, hasMore: true, nextCursor: "cursor-p1" },
      });
      window.dispatchEvent(new Event("app:notifications-changed"));
      await screen.findByText("Nueva");

      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p1", title: "Página uno" }), buildNotification({ id: "p2", title: "Página dos" })],
        meta: { total: 3, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-p2" },
      });
      await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
      await screen.findByText("Página dos");

      expect(workforceApiService.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ after: "cursor-p1" }));
      expect(visibleTitles()).toEqual(["Nueva", "Página uno", "Página dos"]);
    });

    it("si el refresco devuelve una ventana recortada (tope alcanzado), la lista queda en ese prefijo y 'Cargar más' sigue desde su última fila", async () => {
      await renderWithTwoPages();

      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "n1", title: "Nueva uno" }), buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 4, page: 1, pageSize: 2, hasMore: true, nextCursor: "cursor-p1" },
      });
      window.dispatchEvent(new Event("app:notifications-changed"));
      await screen.findByText("Nueva uno");

      expect(visibleTitles()).toEqual(["Nueva uno", "Página uno"]);
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p2", title: "Página dos" })],
        meta: { total: 4, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-p2" },
      });
      await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
      await screen.findByText("Página dos");
      expect(workforceApiService.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ after: "cursor-p1" }));
    });

    it("un refresco que vuelve DESPUÉS de un 'Cargar más' (ventana ya cambiada) se descarta — no pisa la página recién agregada", async () => {
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 2, page: 1, pageSize: 20, hasMore: true, nextCursor: "cursor-p1" },
      });
      renderPage();
      await screen.findByText("Página uno");

      let resolveRefresh!: (value: ListResult) => void;
      vi.mocked(workforceApiService.notifications).mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
      window.dispatchEvent(new Event("app:notifications-changed"));
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p2", title: "Página dos" })],
        meta: { total: 2, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-p2" },
      });
      await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
      await screen.findByText("Página dos");

      resolveRefresh({ items: [buildNotification({ id: "p1", title: "Página uno" })], meta: { total: 2, page: 1, pageSize: 100, hasMore: true, nextCursor: "cursor-p1" } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(visibleTitles()).toEqual(["Página uno", "Página dos"]);
    });

    it("una lectura local nunca se revierte por un refresco que todavía no la vio", async () => {
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "A", title: "Notificación A" })],
        meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-A" },
      });
      vi.mocked(workforceApiService.readNotification).mockResolvedValue(undefined);
      renderPage();
      await screen.findByText("Notificación A");

      vi.mocked(workforceApiService.notifications).mockResolvedValue({
        items: [buildNotification({ id: "A", title: "Notificación A", status: "NO_LEIDA" })],
        meta: { total: 1, page: 1, pageSize: 100, hasMore: false, nextCursor: "cursor-A" },
      });
      await userEvent.click(screen.getByRole("button", { name: /Marcar leída/ }));
      await screen.findByText("Leída");
      window.dispatchEvent(new Event("focus"));
      await waitFor(() => expect(vi.mocked(workforceApiService.notifications).mock.calls.length).toBeGreaterThanOrEqual(3));

      expect(screen.getByText("Leída")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Marcar leída/ })).not.toBeInTheDocument();
    });
  });
});

// Etapa 15M.19D (docs/decisions/NOTIFICATIONS_END_TO_END_ACCEPTANCE_15M19D.md
// §26): regresión encontrada durante la aceptación end-to-end de la serie.
describe("NotificationsPage — Etapa 15M.19D (bug real: filtro 'No leídas' + cambio desde otro cliente)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("una notificación marcada como leída desde OTRO cliente desaparece del filtro 'No leídas' en el próximo refresco silencioso", async () => {
    // Bajo el filtro "No leídas", el backend ya filtra server-side por
    // status=NO_LEIDA -- si otro cliente la marca leída, el próximo fetch de
    // página 1 con ese filtro simplemente deja de incluirla. mockResolvedValue
    // (no "Once"): cubre tanto el fetch inicial (filtro "") como el que
    // dispara el cambio de filtro a NO_LEIDA -- ambos con la misma A.
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ id: "A", title: "Notificación A", status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    await screen.findByText("Notificación A");

    // El próximo refresco silencioso (otro cliente ya marcó A como leída):
    // el backend, filtrando por NO_LEIDA, ya no la devuelve en absoluto.
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [],
      meta: { total: 0, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    window.dispatchEvent(new Event("app:notifications-changed"));

    await waitFor(() => expect(screen.queryByText("Notificación A")).not.toBeInTheDocument());
    await screen.findByText("No hay notificaciones para los filtros seleccionados.");
  });

  it("el mismo caso, pero vía polling (avanzando el intervalo) en vez del evento", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ id: "A", title: "Notificación A", status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    await vi.waitFor(() => expect(screen.getByText("Notificación A")).toBeInTheDocument());

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [],
      meta: { total: 0, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    await vi.waitFor(() => expect(screen.queryByText("Notificación A")).not.toBeInTheDocument());
  });

});

// Etapa 15M.19D §44: React.StrictMode monta el componente dos veces en
// desarrollo (mount → cleanup → mount) para exponer efectos con cleanup
// incorrecto. Mismo patrón ya usado en EmployeeHoursPage.test.tsx (Etapa
// 14I.11) -- acá se prueba específicamente que, tras ese doble-montaje, el
// timer de polling que sobrevive es uno solo (no dos), sin importar cuántas
// llamadas duplicó el propio doble-montaje inicial.
describe("NotificationsPage — Etapa 15M.19D §44 (React.StrictMode, un solo timer efectivo)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bajo StrictMode, tras asentarse el doble-montaje, un intervalo de polling produce exactamente UN refetch adicional (no dos)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });

    render(
      <StrictMode>
        <MemoryRouter>
          <NotificationsPage />
        </MemoryRouter>
      </StrictMode>,
    );
    await vi.waitFor(() => expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument());
    const callsAfterMount = vi.mocked(workforceApiService.notifications).mock.calls.length;

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(vi.mocked(workforceApiService.notifications).mock.calls.length).toBe(callsAfterMount + 1);
  });
});

// docs/decisions/NOTIFICATIONS_EVENT_ORDER.md: `eventAt` (persistido e
// inmutable) es la única fuente de la fecha visible — la misma con la que el
// backend ordena y filtra. `createdAt` (creación técnica) nunca se muestra.
describe("NotificationsPage — fecha visible = eventAt (la misma que ordena y filtra)", () => {
  it("AttendanceInactivityIncident: muestra el día calendario de eventAt (00:00 AR), sin hora ni corrimiento, aunque se haya creado días después", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        title: "No se registraron fichadas",
        entityType: "AttendanceInactivityIncident",
        eventAt: "2026-09-19T03:00:00.000Z",
        createdAt: "2026-09-21T10:00:00.000Z",
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });

    renderPage();

    await screen.findByText("No se registraron fichadas");
    expect(screen.getByText("19/09/2026")).toBeInTheDocument();
    expect(screen.queryByText(/18\/09\/2026|21\/09\/2026/)).not.toBeInTheDocument();
  });

  it("ShiftAlert: fecha y hora Argentina del instante eventAt, nunca createdAt", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        title: "Alerta de turno",
        entityType: "ShiftAlert",
        eventAt: "2026-09-19T08:11:00.000Z",
        createdAt: "2026-09-21T10:00:00.000Z",
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });

    renderPage();

    await screen.findByText("Alerta de turno");
    // 2026-09-19T08:11:00.000Z = 05:11 hora Argentina (UTC-3), mismo día.
    expect(screen.getByText("19/09/2026 · 05:11")).toBeInTheDocument();
    expect(screen.queryByText(/21\/09\/2026/)).not.toBeInTheDocument();
  });

  it("sin hecho propio (cierre mensual): eventAt = createdAt, se muestra igual que siempre", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ title: "Cierres mensuales recibidos", eventAt: "2026-08-20T10:00:00.000Z", createdAt: "2026-08-20T10:00:00.000Z" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: null },
    });

    renderPage();

    await screen.findByText("Cierres mensuales recibidos");
    expect(screen.getByText("20/08/2026 · 07:00")).toBeInTheDocument();
  });
});

describe("NotificationsPage — filtros Desde/Hasta + Estado", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const emptyPage: ListResult = { items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false, nextCursor: null } };
  const setDate = (label: "Desde" | "Hasta", value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("renderiza Desde, Hasta y Estado; 'Limpiar' sólo aparece con algún filtro activo", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue(emptyPage);
    renderPage();
    await screen.findByText("Todavía no hay notificaciones.");

    expect(screen.getByLabelText("Desde")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Estado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpiar" })).not.toBeInTheDocument();

    setDate("Desde", "2026-10-03");

    expect(screen.getByRole("button", { name: "Limpiar" })).toBeInTheDocument();
  });

  it("envía dateFrom/dateTo combinados con status, desde la primera página", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue(emptyPage);
    renderPage();
    await screen.findByText("Todavía no hay notificaciones.");

    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    setDate("Desde", "2026-10-01");
    setDate("Hasta", "2026-10-05");

    await waitFor(() => expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: "NO_LEIDA", dateFrom: "2026-10-01", dateTo: "2026-10-05" }));
    await screen.findByText("No hay notificaciones para los filtros seleccionados.");
    // Cada input acota al otro: no se puede elegir un rango invertido desde el selector.
    expect(screen.getByLabelText("Desde")).toHaveAttribute("max", "2026-10-05");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("min", "2026-10-01");
  });

  it("'Limpiar' vuelve a Todas sin fechas, desde la primera página", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue(emptyPage);
    renderPage();
    await screen.findByText("Todavía no hay notificaciones.");
    setDate("Desde", "2026-10-01");
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "LEIDA");

    await userEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    await waitFor(() => expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: undefined, dateFrom: undefined, dateTo: undefined }));
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Estado")).toHaveValue("");
    await screen.findByText("Todavía no hay notificaciones.");
  });

  it("rango invertido (Desde > Hasta): mensaje claro, no consulta al backend y no muestra resultados viejos", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [buildNotification()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-notif-1" } });
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");
    setDate("Hasta", "2026-10-03");
    await waitFor(() => expect(workforceApiService.notifications).toHaveBeenCalledTimes(2));

    setDate("Desde", "2026-10-05");

    expect(await screen.findByRole("alert")).toHaveTextContent("La fecha «Desde» no puede ser posterior a «Hasta».");
    expect(workforceApiService.notifications).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Cierres mensuales recibidos")).not.toBeInTheDocument();
  });

  it("cambiar un filtro descarta el cursor y lo acumulado: vuelve a la página 1 y oculta 'Cargar más' hasta la respuesta nueva", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "p1", title: "Página uno" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: true, nextCursor: "cursor-p1" },
    });
    renderPage();
    await screen.findByText("Página uno");
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "p2", title: "Página dos" })],
      meta: { total: 3, page: 1, pageSize: 20, hasMore: true, nextCursor: "cursor-p2" },
    });
    await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
    await screen.findByText("Página dos");

    let resolveFiltered!: (value: ListResult) => void;
    vi.mocked(workforceApiService.notifications).mockReturnValueOnce(new Promise((resolve) => { resolveFiltered = resolve; }));
    setDate("Desde", "2026-10-03");

    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: undefined, dateFrom: "2026-10-03", dateTo: undefined });
    expect(screen.queryByRole("button", { name: /Cargar/ })).not.toBeInTheDocument();

    resolveFiltered({ items: [buildNotification({ id: "f1", title: "Filtrada" })], meta: { total: 1, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-f1" } });
    await screen.findByText("Filtrada");
    expect(screen.queryByText("Página uno")).not.toBeInTheDocument();
    expect(screen.queryByText("Página dos")).not.toBeInTheDocument();
  });

  it("'Cargar más' y el polling conservan exactamente los filtros activos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue(emptyPage);
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Todavía no hay notificaciones.")).toBeInTheDocument());

    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ id: "p1", title: "Página uno" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: true, nextCursor: "cursor-p1" },
    });
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    setDate("Desde", "2026-10-01");
    setDate("Hasta", "2026-10-05");
    // Cada cambio de filtro relanza la consulta: esperar a que la ÚLTIMA haya respondido.
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /Cargar/ })).toBeInTheDocument());
    const filters = { status: "NO_LEIDA", dateFrom: "2026-10-01", dateTo: "2026-10-05" };

    await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ ...filters, after: "cursor-p1", take: 20 });

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);
    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ ...filters, through: "cursor-p1", take: NOTIFICATIONS_REFRESH_WINDOW_MAX });
  });
});

// Caso fundamental de la etapa: A (evento 05/10, creada 05/10 08:00) y las
// recuperadas por catch-up B (02/10, creada 10:00), C (04/10, 10:01) y
// D (03/10, 10:02). El backend las entrega en orden de eventAt; la pantalla
// las muestra así y no las mueve al paginar, refrescar ni marcar leída.
describe("NotificationsPage — caso catch-up 05/10, 04/10, 03/10, 02/10", () => {
  const A = buildNotification({ id: "A", title: "Evento A", eventAt: "2026-10-05T03:00:00.000Z", createdAt: "2026-10-05T11:00:00.000Z", entityType: "AttendanceInactivityIncident" });
  const B = buildNotification({ id: "B", title: "Evento B", eventAt: "2026-10-02T03:00:00.000Z", createdAt: "2026-10-05T13:00:00.000Z", entityType: "AttendanceInactivityIncident" });
  const C = buildNotification({ id: "C", title: "Evento C", eventAt: "2026-10-04T03:00:00.000Z", createdAt: "2026-10-05T13:01:00.000Z", entityType: "AttendanceInactivityIncident" });
  const D = buildNotification({ id: "D", title: "Evento D", eventAt: "2026-10-03T03:00:00.000Z", createdAt: "2026-10-05T13:02:00.000Z", entityType: "AttendanceInactivityIncident" });
  const rowDates = () => Array.from(document.querySelectorAll(".notification-row small")).map((node) => node.textContent);
  const page = (items: SystemNotification[], hasMore: boolean, nextCursor: string): ListResult => ({ items, meta: { total: 4, page: 1, pageSize: 2, hasMore, nextCursor } });

  it("se ve 05/10, 04/10, 03/10, 02/10 en la carga, tras 'Cargar más', tras el refresco y tras marcar una como leída", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce(page([A, C], true, "cursor-C"));
    vi.mocked(workforceApiService.readNotification).mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("Evento A");
    expect(rowDates()).toEqual(["05/10/2026", "04/10/2026"]);

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce(page([D, B], false, "cursor-B"));
    await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
    await screen.findByText("Evento B");
    const expected = ["05/10/2026", "04/10/2026", "03/10/2026", "02/10/2026"];
    expect(rowDates()).toEqual(expected);

    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [A, C, D, B], meta: { total: 4, page: 1, pageSize: 100, hasMore: false, nextCursor: "cursor-B" } });
    window.dispatchEvent(new Event("app:notifications-changed"));
    await waitFor(() => expect(workforceApiService.notifications).toHaveBeenLastCalledWith(expect.objectContaining({ through: "cursor-B" })));
    expect(rowDates()).toEqual(expected);

    const rowB = screen.getByText("Evento B").closest("article")!;
    await userEvent.click(within(rowB as HTMLElement).getByRole("button", { name: /Marcar leída/ }));
    await within(rowB as HTMLElement).findByText("Leída");
    expect(rowDates()).toEqual(expected);
  });

  it("con Desde 03/10 y Hasta 05/10 se ve 05/10, 04/10, 03/10 — la misma fecha visible es la filtrada", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce(page([A, C], true, "cursor-C"));
    renderPage();
    await screen.findByText("Evento A");

    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [A, C, D], meta: { total: 3, page: 1, pageSize: 20, hasMore: false, nextCursor: "cursor-D" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-05" } });
    await screen.findByText("Evento D");

    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: undefined, dateFrom: "2026-10-03", dateTo: "2026-10-05" });
    expect(rowDates()).toEqual(["05/10/2026", "04/10/2026", "03/10/2026"]);
    expect(screen.queryByText("Evento B")).not.toBeInTheDocument();
  });
});
