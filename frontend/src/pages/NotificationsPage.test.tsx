import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";
import { workforceApiService, type SystemNotification } from "../services/api/workforceApiService";

vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, notifications: vi.fn(), readNotification: vi.fn() } };
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
