import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletionPreview } from "../../types/deletion.types";
import { DeletionPreviewModal } from "./DeletionPreviewModal";

const api = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn() }));
vi.mock("../../services/api/deletionApiService", async () => {
  const actual = await vi.importActual<typeof import("../../services/api/deletionApiService")>("../../services/api/deletionApiService");
  return { ...actual, deletionApiService: api };
});

const base: DeletionPreview = {
  target: { kind: "zone", id: "z1", code: "ZN-1", name: "Granjas porcinas", label: "Zona" },
  groups: [{ key: "establishments", effect: "DELETE", label: "Establecimientos", consequence: "Se eliminan con sus unidades propias.", count: 2, items: [{ id: "e1", name: "Granja Norte" }, { id: "e2", name: "Granja Sur" }] }],
  blockers: [], requiresTypedConfirmation: true, confirmationText: "Granjas porcinas", token: "a".repeat(64),
};

describe("DeletionPreviewModal", () => {
  beforeEach(() => { api.preview.mockReset(); api.confirm.mockReset(); api.preview.mockResolvedValue(base); api.confirm.mockResolvedValue({}); });

  it("carga la vista previa, exige el nombre y ejecuta con el token confirmado", async () => {
    const deleted = vi.fn();
    const user = userEvent.setup();
    render(<DeletionPreviewModal basePath="/org-structure/zones/z1" title="Eliminar zona" close={vi.fn()} onDeleted={deleted} />);
    expect(await screen.findByText("Establecimientos")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirmar eliminación" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Escribí Granjas porcinas/), "Granjas porcinas");
    await user.click(confirm);
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith("/org-structure/zones/z1", base, "Granjas porcinas"));
    expect(deleted).toHaveBeenCalledWith(base);
  });

  it("si cambia el impacto muestra la preview nueva y obliga a confirmar otra vez", async () => {
    const changed = { ...base, token: "b".repeat(64), groups: [...base.groups, { key: "units", effect: "DELETE" as const, label: "Unidades", consequence: "Se eliminan.", count: 1, items: [{ id: "u1", name: "Galpón 1" }] }] };
    const { ApiError } = await import("../../services/api/apiClient");
    api.confirm.mockRejectedValueOnce(new ApiError("Cambió el impacto", "DELETION_PREVIEW_CHANGED", 409, { preview: changed })).mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<DeletionPreviewModal basePath="/org-structure/zones/z1" title="Eliminar zona" close={vi.fn()} onDeleted={vi.fn()} />);
    await user.type(await screen.findByLabelText(/Escribí Granjas porcinas/), "Granjas porcinas");
    await user.click(screen.getByRole("button", { name: "Confirmar eliminación" }));
    expect(await screen.findByText("El impacto cambió")).toBeInTheDocument();
    expect(screen.getByText("Unidades")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar eliminación" })).toBeDisabled();
  });
});
