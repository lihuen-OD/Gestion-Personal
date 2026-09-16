import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";
import { workforceApiService, type SystemNotification } from "../services/api/workforceApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import type { NoveltyType } from "../types/noveltyType.types";

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

  it("marcar una notificación como leída actualiza el ítem y no vuelve a pedir el listado completo", async () => {
    vi.mocked(workforceApiService.notifications).mockResolvedValue({
      items: [buildNotification({ status: "NO_LEIDA" })],
      meta: { total: 1, page: 1, pageSize: 20, hasMore: false },
    });
    vi.mocked(workforceApiService.readNotification).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Cierres mensuales recibidos");

    await user.click(screen.getByRole("button", { name: /Marcar leída/ }));

    await screen.findByText("Leída");
    expect(workforceApiService.readNotification).toHaveBeenCalledWith("notif-1");
    expect(workforceApiService.notifications).toHaveBeenCalledTimes(1);
    // La notificación sigue visible (no se blanqueó ni recargó toda la lista).
    expect(screen.getByText("Cierres mensuales recibidos")).toBeInTheDocument();
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
