import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShiftGroupsPanel } from "./ShiftGroupsPanel";
import { shiftGroupApiService, type ShiftGroup } from "../../services/api/shiftGroupApiService";
import { ApiError } from "../../services/api/apiClient";
import { confirmAction } from "../../services/appDialog";

vi.mock("../../services/appDialog", () => ({ confirmAction: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/api/shiftGroupApiService", () => ({ shiftGroupApiService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }));

const api = vi.mocked(shiftGroupApiService);
const PLANTA: ShiftGroup = { id: "g-pl", code: "PLANTA", name: "Planta", sortOrder: 20, status: "ACTIVO", templateCount: 2, createdAt: "", updatedAt: "" };
const OFICINA: ShiftGroup = { id: "g-of", code: "OFICINA", name: "Oficina", sortOrder: 10, status: "ACTIVO", templateCount: 0, createdAt: "", updatedAt: "" };

function renderPanel(props: Partial<Parameters<typeof ShiftGroupsPanel>[0]> = {}) {
  const onChanged = vi.fn();
  render(<ShiftGroupsPanel groups={[PLANTA, OFICINA]} status="success" canEdit onChanged={onChanged} onRetry={vi.fn()} {...props} />);
  return { onChanged };
}

beforeEach(() => vi.clearAllMocks());

describe("lista", () => {
  it("ordena por orden y muestra cantidad de turnos y estado", () => {
    renderPanel();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[2]!.textContent)).toEqual(["Oficina", "Planta"]);
    expect(within(rows[1]!).getByText("2 turnos")).toBeInTheDocument();
  });

  it("sin permisos de edición no hay acciones ni CTA", () => {
    renderPanel({ canEdit: false });
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Crear grupo|Editar|Inactivar|Eliminar/ })).not.toBeInTheDocument();
  });

  it("vacío: mensaje contextual y CTA sólo para RRHH; error: reintentar", () => {
    const { unmount } = render(<ShiftGroupsPanel groups={[]} status="success" canEdit onChanged={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("Aún no hay grupos configurados. Los turnos se muestran en «Sin grupo».")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Crear grupo/ }).length).toBeGreaterThan(0);
    unmount();
    render(<ShiftGroupsPanel groups={null} status="error" canEdit onChanged={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("No pudimos cargar los grupos de turnos.")).toBeInTheDocument();
  });
});

describe("crear", () => {
  it("normaliza (código en mayúsculas, sin espacios extra), sugiere el orden y avisa", async () => {
    api.create.mockResolvedValue({ ...OFICINA, id: "g-new", code: "MEDIO AMBIENTE", name: "Medio Ambiente", sortOrder: 30 });
    const user = userEvent.setup();
    const { onChanged } = renderPanel();
    await user.click(screen.getByRole("button", { name: /Crear grupo/ }));
    const dialog = screen.getByRole("dialog", { name: "Crear grupo" });
    expect(within(dialog).getByLabelText("Orden *")).toHaveValue(30);
    await user.type(within(dialog).getByLabelText("Código *"), "  medio   ambiente ");
    expect(within(dialog).getByLabelText("Código *")).toHaveValue("  MEDIO   AMBIENTE ");
    await user.type(within(dialog).getByLabelText("Nombre *"), " Medio   Ambiente ");
    await user.click(within(dialog).getByRole("button", { name: "Crear grupo" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ code: "MEDIO AMBIENTE", name: "Medio Ambiente", sortOrder: 30 }));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Grupo creado.");
  });

  it("valida antes de enviar", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Crear grupo/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código *"), "P");
    await user.clear(within(dialog).getByLabelText("Orden *"));
    await user.click(within(dialog).getByRole("button", { name: "Crear grupo" }));
    expect(within(dialog).getByText("Ingresá un código de al menos 2 caracteres.")).toBeInTheDocument();
    expect(within(dialog).getByText("Ingresá un nombre de al menos 2 caracteres.")).toBeInTheDocument();
    expect(within(dialog).getByText("Ingresá un número entero entre 0 y 9999.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Código *")).toHaveAttribute("aria-invalid", "true");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("duplicado: mensaje humano dentro del modal, sin código interno", async () => {
    api.create.mockRejectedValue(new ApiError("Ya existe un grupo con ese código o nombre.", "SHIFT_GROUP_DUPLICATE", 409));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Crear grupo/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Código *"), "planta");
    await user.type(within(dialog).getByLabelText("Nombre *"), "PLANTA");
    await user.click(within(dialog).getByRole("button", { name: "Crear grupo" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ya existe un grupo con ese código o nombre.");
    expect(dialog).not.toHaveTextContent("SHIFT_GROUP");
  });
});

describe("editar", () => {
  it("envía sólo los campos cambiados (no toca estado ni turnos)", async () => {
    api.update.mockResolvedValue({ ...PLANTA, name: "Planta Norte" });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Editar Planta" }));
    const dialog = screen.getByRole("dialog", { name: "Editar grupo" });
    expect(within(dialog).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("Nombre *"));
    await user.type(within(dialog).getByLabelText("Nombre *"), "Planta Norte");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("g-pl", { name: "Planta Norte" }));
  });
});

describe("activar / inactivar / eliminar", () => {
  it("inactivar explica que los turnos no se borran ni dejan de funcionar", async () => {
    api.update.mockResolvedValue({ ...PLANTA, status: "INACTIVO" });
    const user = userEvent.setup();
    const { onChanged } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Inactivar Planta" }));
    expect(vi.mocked(confirmAction).mock.calls[0]![0]).toContain("Deja de estar disponible para asociarle turnos nuevos. Sus 2 turnos no se borran ni dejan de funcionar.");
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("g-pl", { status: "INACTIVO" }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("cancelar la confirmación no llama al backend", async () => {
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Eliminar Oficina" }));
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("eliminar un grupo en uso: mensaje claro, sin UUID", async () => {
    api.remove.mockRejectedValue(new ApiError("Este grupo tiene turnos asociados. Podés inactivarlo, pero no eliminarlo.", "SHIFT_GROUP_IN_USE", 409));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Eliminar Planta" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este grupo tiene turnos asociados. Podés inactivarlo, pero no eliminarlo.");
    expect(alert.textContent).not.toMatch(/g-pl|SHIFT_GROUP/);
  });

  it("eliminar un grupo sin uso", async () => {
    api.remove.mockResolvedValue({ id: "g-of" });
    const user = userEvent.setup();
    const { onChanged } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Eliminar Oficina" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("g-of"));
    expect(onChanged).toHaveBeenCalled();
  });
});
