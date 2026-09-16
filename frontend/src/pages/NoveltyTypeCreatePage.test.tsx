import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NoveltyTypeCreatePage } from "./NoveltyTypeCreatePage";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));
function authAsRrhh() {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "RRHH", email: "rrhh@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

vi.mock("../services/api/noveltyTypeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyTypeApiService")>();
  return {
    ...actual,
    noveltyTypeApiService: { ...actual.noveltyTypeApiService, getAll: vi.fn(), create: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([]);
});

function renderPage() {
  return render(<MemoryRouter><NoveltyTypeCreatePage /></MemoryRouter>);
}

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md):
// la pantalla de creación no debe exponer ningún concepto legacy/técnico.
describe("NoveltyTypeCreatePage — Etapa 15L.2B", () => {
  it("no muestra origin en ningún lado de la pantalla", async () => {
    renderPage();
    await screen.findByText("1. Identificación");

    expect(screen.queryByText("Origen")).not.toBeInTheDocument();
    expect(screen.queryByText("INTERNA")).not.toBeInTheDocument();
  });

  it("no muestra los campos legacy de comportamiento horario (blocksTimeEntry/setsWorkedHoursToZero/timeImpact)", async () => {
    renderPage();
    await screen.findByText("2. Reglas operativas");

    expect(screen.queryByText("Bloquea carga horaria")).not.toBeInTheDocument();
    expect(screen.queryByText("Horas trabajadas cero")).not.toBeInTheDocument();
    expect(screen.queryByText("No modifica las horas")).not.toBeInTheDocument();
  });

  it("muestra un único selector de Comportamiento con las dos opciones nuevas", async () => {
    renderPage();
    await screen.findByText("2. Reglas operativas");

    expect(screen.getByText("No bloquea la carga horaria")).toBeInTheDocument();
    expect(screen.getByText("Bloquea nueva carga horaria cuando la novedad está aprobada")).toBeInTheDocument();
  });

  it("cambiar el comportamiento horario actualiza la descripción mostrada", async () => {
    renderPage();
    await screen.findByText("2. Reglas operativas");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Comportamiento/ }), "Bloquea nueva carga horaria cuando la novedad está aprobada");

    expect(screen.getByText(/Cuando la novedad está aprobada, evita crear nuevas cargas horarias/)).toBeInTheDocument();
  });

  it("permite editar Observaciones internas (notes)", async () => {
    renderPage();
    await screen.findByText("1. Identificación");

    const notesField = screen.getByLabelText("Observaciones internas");
    await userEvent.type(notesField, "Uso interno");

    expect(notesField).toHaveValue("Uso interno");
  });

  it("Finnegans apagado (default) oculta la configuración de exportación", async () => {
    renderPage();
    await screen.findByText("3. Finnegans");

    expect(screen.queryByLabelText(/Código Finnegans/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Unidad de Valor 1/)).not.toBeInTheDocument();
  });

  it("activar Finnegans muestra código, nombre y unidad, sin exportConcept/prioridad/estado del link", async () => {
    renderPage();
    await screen.findByText("3. Finnegans");

    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));

    expect(screen.getByLabelText(/Código Finnegans/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre Finnegans/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Unidad de Valor 1/)).toBeInTheDocument();
    expect(screen.queryByText("Concepto exportable")).not.toBeInTheDocument();
    expect(screen.queryByText("Prioridad")).not.toBeInTheDocument();
    expect(screen.queryByText("Agregar vinculo Finnegans")).not.toBeInTheDocument();
  });

  it("guardar con Finnegans activo sin código/unidad rechaza con el mensaje correspondiente", async () => {
    renderPage();
    await screen.findByText("1. Identificación");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Vacaciones");
    await userEvent.type(screen.getByLabelText("Descripción funcional"), "Licencia anual");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    expect(await screen.findByText("Para exportar a Finnegans completá el código y el nombre Finnegans.")).toBeInTheDocument();
    expect(noveltyTypeApiService.create).not.toHaveBeenCalled();
  });

  it("guardar con Finnegans activo, código y nombre pero sin unidad rechaza pidiendo la unidad", async () => {
    renderPage();
    await screen.findByText("1. Identificación");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Vacaciones");
    await userEvent.type(screen.getByLabelText("Descripción funcional"), "Licencia anual");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.type(screen.getByLabelText(/Código Finnegans/), "VAC");

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    expect(await screen.findByText("Para exportar a Finnegans elegí la unidad de Valor 1.")).toBeInTheDocument();
  });

  it("guardar con Finnegans completo (código, nombre heredado, unidad) crea el tipo", async () => {
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new" } as NoveltyType);
    renderPage();
    await screen.findByText("1. Identificación");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Vacaciones");
    await userEvent.type(screen.getByLabelText("Descripción funcional"), "Licencia anual");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.type(screen.getByLabelText(/Código Finnegans/), "VAC");
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Días");

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Vacaciones",
        finnegansLinks: expect.arrayContaining([expect.objectContaining({ code: "VAC" })]),
        rules: expect.objectContaining({ exportsToFinnegans: true, finnegansValueUnit: "DAYS" }),
      }),
    ));
  });
});

// Etapa 15L.2B.1 (corrección puntual, docs/decisions/
// NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): "Permite cantidad de horas"
// (Reglas operativas) y "Unidad de Valor 1" (Finnegans) son controles
// independientes -- ambos viven en la misma página (no hay tabs en
// creación, las 3 secciones se renderizan juntas), así que el efecto (o la
// ausencia de efecto) es observable en el mismo render, sin recargar.
describe("NoveltyTypeCreatePage — Etapa 15L.2B.1 (allowsHours y finnegansValueUnit desacoplados)", () => {
  it("tildar 'Permite cantidad de horas' no modifica el selector de Unidad de Valor 1", async () => {
    renderPage();
    await screen.findByText("3. Finnegans");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Unidad");

    await userEvent.click(screen.getByRole("checkbox", { name: /Permite cantidad de horas/ }));

    expect(screen.getByRole("combobox", { name: /Unidad de Valor 1/ })).toHaveValue("UNIT");
  });

  it("cambiar Unidad de Valor 1 no modifica 'Permite cantidad de horas'", async () => {
    renderPage();
    await screen.findByText("2. Reglas operativas");
    const allowsHoursCheckbox = screen.getByRole("checkbox", { name: /Permite cantidad de horas/ }) as HTMLInputElement;
    expect(allowsHoursCheckbox.checked).toBe(false);

    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Horas");

    expect(allowsHoursCheckbox.checked).toBe(false);
  });

  it("tildar 'Permite cantidad de horas' con Finnegans ya en UNIT permite guardar sin exigir cambiar la unidad", async () => {
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new" } as NoveltyType);
    renderPage();
    await screen.findByText("1. Identificación");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Sancion");
    await userEvent.type(screen.getByLabelText("Descripción funcional"), "Sancion disciplinaria");
    await userEvent.click(screen.getByRole("checkbox", { name: /Permite cantidad de horas/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.type(screen.getByLabelText(/Código Finnegans/), "SANC");
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Unidad");

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ rules: expect.objectContaining({ allowsHours: true, finnegansValueUnit: "UNIT" }) }),
    ));
  });
});
