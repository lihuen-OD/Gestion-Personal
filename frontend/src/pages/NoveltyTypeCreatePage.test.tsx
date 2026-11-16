import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NoveltyTypeCreatePage } from "./NoveltyTypeCreatePage";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import { ApiError } from "../services/api/apiClient";

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
    await screen.findByText("1. Datos generales");

    expect(screen.queryByText("Origen")).not.toBeInTheDocument();
    expect(screen.queryByText("INTERNA")).not.toBeInTheDocument();
  });

  // Etapa 15L.6 (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md): los 3
  // campos legacy ya no existen en absoluto en el modelo.
  it("no muestra los campos legacy de comportamiento horario (blocksTimeEntry/setsWorkedHoursToZero/timeImpact)", async () => {
    renderPage();
    await screen.findByText("4. Carga y control");

    expect(screen.queryByText("Bloquea carga horaria")).not.toBeInTheDocument();
    expect(screen.queryByText("Horas trabajadas cero")).not.toBeInTheDocument();
    expect(screen.queryByText("No modifica las horas")).not.toBeInTheDocument();
  });

  it("muestra un único selector de bloqueo con las dos opciones", async () => {
    renderPage();
    await screen.findByText("4. Carga y control");

    expect(screen.getByText("No bloquea la carga horaria")).toBeInTheDocument();
    expect(screen.getByText("Bloquea nueva carga horaria cuando la novedad está aprobada")).toBeInTheDocument();
  });

  it("cambiar el comportamiento horario actualiza la descripción mostrada", async () => {
    renderPage();
    await screen.findByText("4. Carga y control");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Bloquea nuevas cargas/ }), "Bloquea nueva carga horaria cuando la novedad está aprobada");

    expect(screen.getByText(/Cuando la novedad está aprobada, evita crear nuevas cargas horarias/)).toBeInTheDocument();
  });

  it("permite editar Observaciones internas (notes)", async () => {
    renderPage();
    await screen.findByText("1. Datos generales");

    const notesField = screen.getByLabelText("Observaciones internas");
    await userEvent.type(notesField, "Uso interno");

    expect(notesField).toHaveValue("Uso interno");
  });

  it("Finnegans apagado (default) oculta la configuración de exportación", async () => {
    renderPage();
    await screen.findByText("5. Integración y otras opciones");

    expect(screen.queryByLabelText(/Código Finnegans/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Unidad de Valor 1/)).not.toBeInTheDocument();
  });

  it("activar Finnegans muestra código, nombre y unidad, sin exportConcept/prioridad/estado del link", async () => {
    renderPage();
    await screen.findByText("5. Integración y otras opciones");

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
    await screen.findByText("1. Datos generales");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Vacaciones");
    await userEvent.type(screen.getByLabelText("Descripción funcional *"), "Licencia anual");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    expect(await screen.findByText("Para exportar a Finnegans completá el código y el nombre Finnegans.")).toBeInTheDocument();
    expect(noveltyTypeApiService.create).not.toHaveBeenCalled();
  });

  it("guardar con Finnegans activo, código y nombre pero sin unidad rechaza pidiendo la unidad", async () => {
    renderPage();
    await screen.findByText("1. Datos generales");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Vacaciones");
    await userEvent.type(screen.getByLabelText("Descripción funcional *"), "Licencia anual");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.type(screen.getByLabelText(/Código Finnegans/), "VAC");
    await userEvent.type(screen.getByLabelText(/Nombre Finnegans/), "Vacaciones gozadas");

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    expect(await screen.findByText("Para exportar a Finnegans elegí la unidad de Valor 1.")).toBeInTheDocument();
  });

  it("guardar con Finnegans completo (código, nombre, unidad) crea el tipo", async () => {
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new" } as NoveltyType);
    renderPage();
    await screen.findByText("1. Datos generales");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Vacaciones");
    await userEvent.type(screen.getByLabelText("Descripción funcional *"), "Licencia anual");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.type(screen.getByLabelText(/Código Finnegans/), "VAC");
    await userEvent.type(screen.getByLabelText(/Nombre Finnegans/), "Vacaciones gozadas");
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Días");

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Vacaciones",
        finnegansCode: "VAC",
        finnegansName: "Vacaciones gozadas",
        rules: expect.objectContaining({ exportsToFinnegans: true, finnegansValueUnit: "DAYS" }),
      }),
    ));
  });
});

// Etapa 7 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §14): configuración de
// cobertura con preguntas de negocio, sin enums visibles.
async function fillRequired(name = "Vacaciones") {
  await screen.findByText("1. Datos generales");
  await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), name);
  await userEvent.type(screen.getByLabelText("Descripción funcional *"), "Descripción");
}

describe("NoveltyTypeCreatePage — Etapa 7 (cobertura)", () => {
  it("arranca en 'No registra horas' sin mostrar enums ni configuraciones que no aplican", async () => {
    renderPage();
    await screen.findByText("2. Tiempo que cubre");

    expect(screen.getByRole("radio", { name: /No registra horas/ })).toBeChecked();
    expect(screen.queryByText(/Días y situaciones especiales/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Cantidad de horas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reglas de domingos, feriados u Horas Especiales\?/)).not.toBeInTheDocument();
    expect(screen.getByText("¿Puede existir esta novedad el mismo día que hay horas trabajadas?")).toBeInTheDocument();
    for (const raw of ["NONE", "FIXED_MINUTES", "MANUAL_MINUTES", "EXPECTED_SCHEDULE", "WORK_OBLIGATION", "INCOMPATIBLE", "ONLY_IF_CONVOKED"]) {
      expect(screen.queryByText(raw)).not.toBeInTheDocument();
    }
  });

  it("configura una cantidad fija lunes a viernes (Maternidad) y envía los valores del backend", async () => {
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new" } as NoveltyType);
    renderPage();
    await fillRequired("Maternidad");

    await userEvent.click(screen.getByRole("radio", { name: /Cantidad fija/ }));
    await userEvent.type(screen.getByLabelText(/Cantidad de horas/), "08:00");
    await userEvent.click(screen.getByRole("radio", { name: /Sólo determinados días de la semana/ }));
    for (const day of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]) await userEvent.click(screen.getByRole("checkbox", { name: day }));
    await userEvent.click(within(screen.getByRole("group", { name: /franco ese día/ })).getByRole("radio", { name: /Cuenta igual/ }));
    await userEvent.click(within(screen.getByRole("group", { name: /es feriado/ })).getByRole("radio", { name: /convocada/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Sí, suma al total computable/ }));
    await userEvent.click(screen.getByRole("radio", { name: /No puede coexistir/ }));

    expect(screen.getByText("Cubre 8 h por día.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledWith(expect.objectContaining({
      coverage: {
        mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "SELECTED_WEEKDAYS", weekdays: [1, 2, 3, 4, 5],
        onDayOff: "COVER", onHoliday: "ONLY_IF_CONVOKED", appliesSpecialHours: false, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE",
      },
    })));
  });

  it("configura Vacaciones según la jornada: francos y feriados los decide la obligación laboral", async () => {
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new" } as NoveltyType);
    renderPage();
    await fillRequired();

    await userEvent.click(screen.getByRole("radio", { name: /Según la jornada que debía cumplir/ }));

    expect(screen.getByText("3. Días y situaciones especiales")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /franco ese día/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /es feriado/ })).not.toBeInTheDocument();
    expect(screen.getByText("Francos y feriados los decide la jornada de la persona")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /Sí, aplica multiplicadores/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Sí, suma al total computable/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledWith(expect.objectContaining({
      coverage: expect.objectContaining({ mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION", onDayOff: null, onHoliday: null, appliesSpecialHours: true, countsTowardTotal: true }),
    })));
  });

  it("cantidad indicada al cargar: un único día, sin rango ni reglas de días", async () => {
    renderPage();
    await screen.findByText("2. Tiempo que cubre");
    const range = screen.getByRole("checkbox", { name: /cargar para varios días/ });
    expect(range).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: /Cantidad indicada al cargar la novedad/ }));

    expect(range).not.toBeChecked();
    expect(range).toBeDisabled();
    expect(screen.queryByText(/Días y situaciones especiales/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Cantidad de horas/)).not.toBeInTheDocument();
    expect(screen.getByText("Cubre la duración que se indique al cargarla, para un único día.")).toBeInTheDocument();
  });

  it("no envía una cantidad fija sin horas, sin días ni políticas: marca cada campo", async () => {
    renderPage();
    await fillRequired();
    await userEvent.click(screen.getByRole("radio", { name: /Cantidad fija/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Sólo determinados días de la semana/ }));

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    expect(noveltyTypeApiService.create).not.toHaveBeenCalled();
    expect(screen.getAllByText("Indicá la cantidad de horas en formato HH:mm, entre 00:01 y 24:00.").length).toBeGreaterThan(0);
    expect(screen.getByText("Elegí al menos un día de la semana.")).toBeInTheDocument();
    expect(screen.getByText("Indicá qué sucede si la persona tiene franco ese día.")).toBeInTheDocument();
    expect(screen.getByText("Indicá qué sucede si el día es feriado.")).toBeInTheDocument();
  });

  it("muestra el motivo de negocio cuando el backend rechaza la configuración", async () => {
    vi.mocked(noveltyTypeApiService.create).mockRejectedValue(new ApiError("La jornada que el empleado tenía que cumplir sólo existe en los días que tenía que trabajar.", "NOVELTY_TYPE_COVERAGE_CONFIG_INVALID", 400));
    renderPage();
    await fillRequired();

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    expect(await screen.findByText("La jornada que el empleado tenía que cumplir sólo existe en los días que tenía que trabajar.")).toBeInTheDocument();
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
    await screen.findByText("5. Integración y otras opciones");
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Unidad");

    await userEvent.click(screen.getByRole("checkbox", { name: /Pedir una cantidad de horas al cargar/ }));

    expect(screen.getByRole("combobox", { name: /Unidad de Valor 1/ })).toHaveValue("UNIT");
  });

  it("cambiar Unidad de Valor 1 no modifica 'Permite cantidad de horas'", async () => {
    renderPage();
    await screen.findByText("4. Carga y control");
    const allowsHoursCheckbox = screen.getByRole("checkbox", { name: /Pedir una cantidad de horas al cargar/ }) as HTMLInputElement;
    expect(allowsHoursCheckbox.checked).toBe(false);

    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Horas");

    expect(allowsHoursCheckbox.checked).toBe(false);
  });

  it("tildar 'Permite cantidad de horas' con Finnegans ya en UNIT permite guardar sin exigir cambiar la unidad", async () => {
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new" } as NoveltyType);
    renderPage();
    await screen.findByText("1. Datos generales");
    await userEvent.type(screen.getByLabelText("Nombre de la novedad *"), "Sancion");
    await userEvent.type(screen.getByLabelText("Descripción funcional *"), "Sancion disciplinaria");
    await userEvent.click(screen.getByRole("checkbox", { name: /Pedir una cantidad de horas al cargar/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Exportar esta novedad a Finnegans/ }));
    await userEvent.type(screen.getByLabelText(/Código Finnegans/), "SANC");
    await userEvent.type(screen.getByLabelText(/Nombre Finnegans/), "Sancion");
    await userEvent.selectOptions(screen.getByLabelText(/Unidad de Valor 1/), "Unidad");

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ rules: expect.objectContaining({ allowsHours: true, finnegansValueUnit: "UNIT" }) }),
    ));
  });
});

describe("NoveltyTypeCreatePage — Etapa 7 (accesibilidad del envío)", () => {
  it("al fallar el envío lleva el foco al primer dato faltante", async () => {
    renderPage();
    await screen.findByText("1. Datos generales");

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    const name = screen.getByLabelText("Nombre de la novedad *");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Completá el nombre de la novedad.");
  });

  it("los días de la semana faltantes quedan asociados al grupo y reciben el foco", async () => {
    renderPage();
    await fillRequired();
    await userEvent.click(screen.getByRole("radio", { name: /Cantidad fija/ }));
    await userEvent.type(screen.getByLabelText(/Cantidad de horas/), "04:00");
    await userEvent.click(screen.getByRole("radio", { name: /Sólo determinados días de la semana/ }));

    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    const group = screen.getByRole("group", { name: "Días de la semana que cubre" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription("Elegí al menos un día de la semana.");
    expect(screen.getByRole("checkbox", { name: "Lunes" })).toHaveFocus();
  });

  it("el selector muestra los 22 colores de la paleta", async () => {
    renderPage();
    await screen.findByText("1. Datos generales");
    const swatches = within(screen.getByRole("group", { name: "Color en carga horaria" })).getAllByRole("button");
    expect(swatches).toHaveLength(22);
    expect(swatches.slice(0, 3).map((swatch) => swatch.getAttribute("aria-label"))).toEqual(["Azul", "Naranja", "Violeta"]);
  });

  it("al crear, preselecciona el primer color que ningún tipo usa (sin mirar nombre ni código)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([{ uiColor: "blue" }, { uiColor: "orange" }] as NoveltyType[]);
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new" } as NoveltyType);
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Violeta" })).toHaveAttribute("aria-pressed", "true"));
    await fillRequired("Vacaciones");
    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));
    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledWith(expect.objectContaining({ uiColor: "violet" })));
  });

  it("con los 22 colores en uso permite repetir y elegir cualquiera a mano", async () => {
    const allColors = ["blue", "orange", "violet", "emerald", "red", "cyan", "fuchsia", "yellow", "pine", "pink", "indigo", "lime", "brown", "sky", "tangerine", "purple", "green", "rose", "slate", "amber", "magenta", "teal"];
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([...allColors, "blue"].map((uiColor) => ({ uiColor })) as NoveltyType[]);
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Naranja" })).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(screen.getByRole("button", { name: "Azul" }));
    expect(screen.getByRole("button", { name: "Azul" })).toHaveAttribute("aria-pressed", "true");
  });

  it("el color elegido también se informa por nombre, no sólo por color", async () => {
    renderPage();
    await screen.findByText("1. Datos generales");

    await userEvent.click(screen.getByRole("button", { name: "Esmeralda" }));

    expect(screen.getByRole("button", { name: "Esmeralda" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Esmeralda", { selector: ".novelty-color-name" })).toBeInTheDocument();
  });
});

// Regresión: "Revisá los campos obligatorios o inválidos: Código." El código
// interno lo asigna el backend al guardar; la pantalla no lo calcula ni lo pide.
describe("NoveltyTypeCreatePage — código interno", () => {
  it("alta sin escribir código: se guarda aunque el catálogo no haya cargado, sin error de código", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockRejectedValue(new Error("sin catálogo"));
    vi.mocked(noveltyTypeApiService.create).mockResolvedValue({ id: "nt-new", code: "NOV-008" } as NoveltyType);
    renderPage();
    await fillRequired("Trámite bancario");

    const code = screen.getByLabelText("Código interno");
    expect(code).toHaveAttribute("readonly");
    expect(code).toHaveValue("");
    expect(code).toHaveAttribute("placeholder", "Se asigna al guardar");
    await userEvent.click(screen.getByRole("button", { name: "Guardar tipo" }));

    await waitFor(() => expect(noveltyTypeApiService.create).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Código/, { selector: ".error, .field-error" })).not.toBeInTheDocument();
    // Sin catálogo no se puede elegir un color no usado: queda el color por defecto.
    expect(noveltyTypeApiService.create).toHaveBeenCalledWith(expect.objectContaining({ uiColor: "blue" }));
  });
});
