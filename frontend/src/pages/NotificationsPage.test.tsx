import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";
import { NOTIFICATIONS_POLL_INTERVAL_MS, workforceApiService, type SystemNotification } from "../services/api/workforceApiService";
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

function buildNotification(overrides: Partial<SystemNotification> = {}): SystemNotification {
  return {
    id: "notif-1",
    type: "CIERRE_MENSUAL",
    priority: "ALTA",
    title: "Cierres mensuales recibidos",
    message: "3 legajos de 2026-08 esperan aprobación.",
    status: "NO_LEIDA",
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
    let resolveList!: (value: { items: SystemNotification[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(workforceApiService.notifications).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveList({ items: [buildNotification()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false } });
    await screen.findByText("Cierres mensuales recibidos");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("pide sólo las últimas 20 (page=1, take=20), no todas — y una sola vez al montar (sin llamadas duplicadas)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [buildNotification()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false } });

    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    expect(workforceApiService.notifications).toHaveBeenCalledTimes(1);
    expect(workforceApiService.notifications).toHaveBeenCalledWith({ page: 1, take: 20, status: undefined });
  });

  it("'Cargar más' agrega la página siguiente sin blanquear ni reemplazar las notificaciones ya visibles", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "notif-1", title: "Cierres mensuales recibidos" })],
      meta: { total: 25, page: 1, pageSize: 20, hasMore: true },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    let resolveNextPage!: (value: { items: SystemNotification[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(workforceApiService.notifications).mockReturnValue(new Promise((resolve) => { resolveNextPage = resolve; }));

    await user.click(screen.getByRole("button", { name: /Cargar/ }));

    // Mientras la página 2 está en vuelo, la notificación de la página 1
    // sigue visible y no aparece el skeleton de carga completo.
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();
    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 2, take: 20, status: undefined });

    resolveNextPage({
      items: [buildNotification({ id: "notif-2", title: "Corrección posterior al cierre" })],
      meta: { total: 25, page: 2, pageSize: 20, hasMore: false },
    });

    await waitFor(() => expect(screen.getByText("Corrección posterior al cierre")).toBeInTheDocument());
    // Se agregó, no se reemplazó — la de la página 1 sigue en pantalla.
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
  });

  it("cambiar el filtro de Estado pide status server-side y no blanquea la lista mientras llega la respuesta nueva", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ title: "Cierres mensuales recibidos" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    let resolveFiltered!: (value: { items: SystemNotification[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(workforceApiService.notifications).mockReturnValue(new Promise((resolve) => { resolveFiltered = resolve; }));

    await user.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");

    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: "NO_LEIDA" });
    // Todavía no blanquea mientras la respuesta filtrada está en vuelo.
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();

    resolveFiltered({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false } });
    await screen.findByText("No tenés notificaciones sin leer.");
  });

  it("marcar una notificación como leída actualiza el ítem de inmediato (sin esperar ningún refetch)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    vi.mocked(workforceApiService.readNotification).mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    await user.click(screen.getByRole("button", { name: /Marcar leída/ }));

    await screen.findByText("No se pudo marcar la notificación como leída.");
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
  });

  it("muestra un empty state claro cuando no hay notificaciones", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false } });

    renderPage();

    await screen.findByText("No hay notificaciones todavía.");
  });

  it("muestra un error local (sin texto técnico) si falla la carga inicial, y permite reintentar", async () => {
    vi.mocked(workforceApiService.notifications).mockRejectedValueOnce(new Error("Request failed with status 500"));

    renderPage();

    await screen.findByText("No se pudieron cargar las notificaciones.");
    expect(screen.queryByText(/500|schema|payload/i)).not.toBeInTheDocument();

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({ items: [buildNotification()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false } });
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    expect(screen.getByRole("link", { name: "Ver detalle" })).toHaveAttribute("href", "/novedades");
  });

  it("el botón explícito 'Marcar leída' sigue ejecutando la escritura, sin cambios", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA", link: "/novedades" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });

    renderPage();

    expect(await screen.findByRole("button", { name: /Crear novedad/ })).toBeInTheDocument();
  });

  it("una notificación SIN empleado resuelto (ej. cierres/correcciones/novedades pendientes) no muestra 'Crear novedad'", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ type: "CIERRE_MENSUAL", title: "Cierres mensuales recibidos" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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

  it("Caso B: al cumplirse el intervalo de polling, vuelve a pedir la página 1", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument());
    expect(workforceApiService.notifications).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(workforceApiService.notifications).toHaveBeenCalledTimes(2);
    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: undefined });
  });

  it("Caso C: una notificación nueva que aparece en el siguiente poll se muestra sin remontar la página", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Notificación A")).toBeInTheDocument());

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" }), buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false },
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    await vi.waitFor(() => expect(screen.getByText("Notificación B")).toBeInTheDocument());
    expect(screen.getByText("Notificación A")).toBeInTheDocument();
  });

  it("Caso D: el polling conserva el filtro activo (No leídas)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false } });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("No hay notificaciones todavía.")).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    await vi.waitFor(() => expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: "NO_LEIDA" }));

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(workforceApiService.notifications).toHaveBeenLastCalledWith({ page: 1, take: 20, status: "NO_LEIDA" });
  });

  it("Caso E: un fallo temporal de polling no vacía ni tapa la lista ya visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false },
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);
    await vi.waitFor(() => expect(screen.getByText("Notificación B")).toBeInTheDocument());
  });

  it("Caso F: el evento app:notifications-changed dispara un refetch inmediato, sin esperar al polling", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await screen.findByText("Notificación A");

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" }), buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false },
    });
    window.dispatchEvent(new Event("app:notifications-changed"));

    await screen.findByText("Notificación B");
  });

  it("recuperar el foco de la ventana también dispara un refetch inmediato (§21)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await screen.findByText("Notificación A");

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" }), buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: false },
    });
    window.dispatchEvent(new Event("focus"));

    await screen.findByText("Notificación B");
  });

  it("Caso G: al desmontar la página, se limpia el timer — no sigue pidiendo en segundo plano", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification()],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await vi.waitFor(() => expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument());
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    expect(document.querySelector(".skeleton-bar")).toBeNull();
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
  });

  // Etapa 15M.19C §7/§24: paginación + polling.
  describe("paginación estable frente al polling", () => {
    it("con 2 páginas ya cargadas, un refresco silencioso con una notificación nueva no duplica ni pierde las ya cargadas", async () => {
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 21, page: 1, pageSize: 20, hasMore: true },
      });
      renderPage();
      await screen.findByText("Página uno");

      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p2", title: "Página dos" })],
        meta: { total: 21, page: 2, pageSize: 20, hasMore: false },
      });
      await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
      await screen.findByText("Página dos");

      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "nueva", title: "Notificación nueva" }), buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 22, page: 1, pageSize: 20, hasMore: true },
      });
      window.dispatchEvent(new Event("app:notifications-changed"));

      await screen.findByText("Notificación nueva");
      expect(screen.getAllByText("Página uno")).toHaveLength(1);
      expect(screen.getByText("Página dos")).toBeInTheDocument();
    });

    it("'Cargar más' después de un refresco silencioso no duplica una fila que ese refresco ya había traído", async () => {
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 25, page: 1, pageSize: 20, hasMore: true },
      });
      renderPage();
      await screen.findByText("Página uno");

      // El refresco silencioso ya trae, por drift de offset, una fila que la
      // próxima página "oficial" también incluiría.
      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "compartido", title: "Notificación compartida" }), buildNotification({ id: "p1", title: "Página uno" })],
        meta: { total: 26, page: 1, pageSize: 20, hasMore: true },
      });
      window.dispatchEvent(new Event("app:notifications-changed"));
      await screen.findByText("Notificación compartida");

      vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
        items: [buildNotification({ id: "compartido", title: "Notificación compartida" }), buildNotification({ id: "p2", title: "Página dos" })],
        meta: { total: 26, page: 2, pageSize: 20, hasMore: false },
      });
      await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
      await screen.findByText("Página dos");

      expect(screen.getAllByText("Notificación compartida")).toHaveLength(1);
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    await screen.findByText("Notificación A");

    // El próximo refresco silencioso (otro cliente ya marcó A como leída):
    // el backend, filtrando por NO_LEIDA, ya no la devuelve en absoluto.
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [],
      meta: { total: 0, page: 1, pageSize: 20, hasMore: false },
    });
    window.dispatchEvent(new Event("app:notifications-changed"));

    await waitFor(() => expect(screen.queryByText("Notificación A")).not.toBeInTheDocument());
    await screen.findByText("No tenés notificaciones sin leer.");
  });

  it("el mismo caso, pero vía polling (avanzando el intervalo) en vez del evento", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ id: "A", title: "Notificación A", status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "NO_LEIDA");
    await vi.waitFor(() => expect(screen.getByText("Notificación A")).toBeInTheDocument());

    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [],
      meta: { total: 0, page: 1, pageSize: 20, hasMore: false },
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_POLL_INTERVAL_MS);

    await vi.waitFor(() => expect(screen.queryByText("Notificación A")).not.toBeInTheDocument());
  });

  it("bajo el filtro 'Todas' (monótono), una fila que no reaparece en la página 1 fresca SÍ se conserva (no es el mismo bug)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "A", title: "Notificación A" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    renderPage();
    await screen.findByText("Notificación A");

    // Sin filtro, A sigue existiendo (sólo cambió de posición, no de status) --
    // una página 1 fresca que ya no la incluya (porque hay más recientes) no
    // significa que dejó de existir.
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: [buildNotification({ id: "B", title: "Notificación B" })],
      meta: { total: 2, page: 1, pageSize: 20, hasMore: true },
    });
    window.dispatchEvent(new Event("app:notifications-changed"));

    await screen.findByText("Notificación B");
    expect(screen.getByText("Notificación A")).toBeInTheDocument();
  });
});

// Etapa 15M.19D §31: offset drift con múltiples inserciones entre "Cargar
// más" sucesivos -- confirma que ninguna fila queda saltada (nunca
// alcanzable por ninguna página pedida), sólo eventualmente re-pedida y
// deduplicada.
describe("NotificationsPage — Etapa 15M.19D §31 (offset drift, sin gaps)", () => {
  it("dos inserciones sucesivas entre 'Cargar más' no dejan ninguna fila vieja sin cubrir por ninguna página pedida", async () => {
    // t0: página 1 (createdAt desc) = A,B,C,D,E,F (6 de un total de 9).
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: ["A", "B", "C", "D", "E", "F"].map((id) => buildNotification({ id, title: `Notificación ${id}` })),
      meta: { total: 9, page: 1, pageSize: 6, hasMore: true },
    });
    renderPage();
    await screen.findByText("Notificación A");

    // Se inserta X1 antes de pedir la página 2: el orden real pasa a ser
    // X1,A,B,C,D,E,F,G,H,I (10 en total). skip=6 (page=2) cae en F,G,H.
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: ["F", "G", "H"].map((id) => buildNotification({ id, title: `Notificación ${id}` })),
      meta: { total: 10, page: 2, pageSize: 6, hasMore: true },
    });
    await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
    await screen.findByText("Notificación G");
    // F ya estaba (deduplicada), no aparece dos veces.
    expect(screen.getAllByText("Notificación F")).toHaveLength(1);

    // Se inserta X2 antes de pedir la página 3: orden real ahora
    // X1,X2,A..I,J (11 en total). skip=12 (page=3) cae en H,I,J (X1/X2 nunca
    // se pidieron por "Cargar más" -- sólo un refresco silencioso los trae,
    // comportamiento esperado, no un gap de la paginación en sí).
    vi.mocked(workforceApiService.notifications).mockResolvedValueOnce({
      items: ["H", "I", "J"].map((id) => buildNotification({ id, title: `Notificación ${id}` })),
      meta: { total: 11, page: 3, pageSize: 6, hasMore: false },
    });
    await userEvent.click(screen.getByRole("button", { name: /Cargar/ }));
    await screen.findByText("Notificación J");

    // Ninguna de A-J quedó sin mostrarse (H se deduplica, no se pierde).
    for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
      expect(screen.getAllByText(`Notificación ${id}`)).toHaveLength(1);
    }
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
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
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

// Etapa 15M.19E: antes de esta etapa sólo se mostraba `createdAt` (cuándo se
// insertó la fila) — una notificación recuperada por catch-up (15M.19A/B)
// días después del hecho real parecía haber ocurrido "hoy". `eventDate`
// (nuevo en el DTO) trae la fecha real ya persistida en la entidad de
// origen; estos tests confirman que la pantalla la usa en vez de `createdAt`
// cuando está disponible, con el formato seguro correspondiente.
describe("NotificationsPage — Etapa 15M.19E (fecha real del hecho, no de creación de la fila)", () => {
  it("con eventDate de AttendanceInactivityIncident, muestra la fecha calendario real (no createdAt, y sin corrimiento de huso horario)", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        title: "No se registraron fichadas",
        entityType: "AttendanceInactivityIncident",
        eventDate: "2026-09-19T00:00:00.000Z",
        createdAt: "2026-09-21T10:00:00.000Z",
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });

    renderPage();

    await screen.findByText("No se registraron fichadas");
    expect(screen.getByText("19/09/2026")).toBeInTheDocument();
    expect(screen.queryByText("18/09/2026")).not.toBeInTheDocument();
  });

  it("con eventDate de ShiftAlert, muestra fecha y hora del instante real, no createdAt", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({
        title: "Alerta de turno",
        entityType: "ShiftAlert",
        eventDate: "2026-09-19T08:11:00.000Z",
        createdAt: "2026-09-21T10:00:00.000Z",
      })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });

    renderPage();

    await screen.findByText("Alerta de turno");
    expect(screen.getByText(/19\/9\/2026/)).toBeInTheDocument();
  });

  it("sin eventDate (ej. notificación tipo Employee, o legado), sigue mostrando createdAt como antes", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ title: "Cierres mensuales recibidos", createdAt: "2026-08-20T10:00:00.000Z" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });

    renderPage();

    await screen.findByText("Cierres mensuales recibidos");
    expect(screen.getByText(new Date("2026-08-20T10:00:00.000Z").toLocaleString("es-AR"))).toBeInTheDocument();
  });
});
