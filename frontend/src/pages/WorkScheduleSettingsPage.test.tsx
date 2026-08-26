import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WorkScheduleSettingsPage } from "./WorkScheduleSettingsPage";
import { workforceApiService, type DoubleHourRule } from "../services/api/workforceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { positionApiService } from "../services/api/positionApiService";
import { employeeApiService } from "../services/api/employeeApiService";

// jsdom no implementa scrollIntoView — editRule() lo llama al abrir una
// regla para editar, sin relación con lo que este archivo prueba.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// confirmAction dispara un evento que sólo resuelve cuando el diálogo global
// de la app (no montado en este render aislado) responde — sin mockear,
// toggleRule/removeRule quedarían esperando para siempre. Se simula "el
// usuario confirmó" directamente.
vi.mock("../services/appDialog", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));

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

vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return {
    ...actual,
    workforceApiService: {
      ...actual.workforceApiService,
      doubleHourRules: vi.fn(),
      createDoubleHourRule: vi.fn(),
      updateDoubleHourRule: vi.fn(),
      removeDoubleHourRule: vi.fn(),
      doubleHourRulesCalendar: vi.fn(),
    },
  };
});

vi.mock("../services/api/orgStructureApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/orgStructureApiService")>();
  return { ...actual, orgStructureApiService: { ...actual.orgStructureApiService, getCatalog: vi.fn() } };
});

vi.mock("../services/api/positionApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/positionApiService")>();
  return { ...actual, positionApiService: { ...actual.positionApiService, getAll: vi.fn() } };
});

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getOptions: vi.fn() } };
});

const catalog = {
  companies: [{ id: "company-odwyer", code: "ODW", name: "Odwyer", legalName: "Odwyer SA", cuit: "1", status: "ACTIVO" as const }],
  businessUnits: [],
  establishments: [],
  areas: [],
  sectors: [{ id: "sector-panol", code: "PAN", name: "Pañol", status: "ACTIVO" as const }],
  costCenters: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkScheduleSettingsPage />
    </MemoryRouter>,
  );
}

async function fillRequiredBaseFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre de la regla"), "Domingo Odwyer");
  await user.type(screen.getByLabelText("Motivo o descripción"), "Los domingos valen doble");
  const desde = screen.getByLabelText("Desde") as HTMLInputElement;
  await user.clear(desde);
  await user.type(desde, "2026-01-01");
}

function existingRule(overrides: Partial<DoubleHourRule> = {}): DoubleHourRule {
  return {
    id: "rule-1",
    name: "Domingo",
    recurrenceType: "SEMANAL",
    fromDate: "2026-01-01",
    toDate: null,
    weekdays: [0],
    multiplier: 2,
    priority: 0,
    companyId: null,
    sectorId: null,
    costCenterId: null,
    positionId: null,
    dates: [],
    reason: "Domingo x2",
    status: "ACTIVO",
    employees: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([]);
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue(catalog);
  vi.mocked(positionApiService.getAll).mockResolvedValue([]);
  vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false } });
  vi.mocked(workforceApiService.doubleHourRulesCalendar).mockResolvedValue([]);
  vi.mocked(workforceApiService.createDoubleHourRule).mockResolvedValue({ id: "rule-1" } as never);
});

describe("WorkScheduleSettingsPage — Etapa 8B", () => {
  it("test 1 — el formulario permite crear una regla sin tocar el selector de empleados", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    await waitFor(() => expect(workforceApiService.createDoubleHourRule).toHaveBeenCalled());
    const payload = vi.mocked(workforceApiService.createDoubleHourRule).mock.calls[0]![0];
    expect(payload.employeeIds).toEqual([]);
    expect(screen.queryByText(/seleccioná al menos un empleado/i)).not.toBeInTheDocument();
  });

  it("test 2 — permite elegir una empresa sin seleccionar empleados", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.selectOptions(screen.getByLabelText("Empresa"), "company-odwyer");
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    await waitFor(() => expect(workforceApiService.createDoubleHourRule).toHaveBeenCalled());
    const payload = vi.mocked(workforceApiService.createDoubleHourRule).mock.calls[0]![0];
    expect(payload.companyId).toBe("company-odwyer");
    expect(payload.employeeIds).toEqual([]);
  });

  it("test 3 — permite elegir empresa + sector sin seleccionar empleados", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.selectOptions(screen.getByLabelText("Empresa"), "company-odwyer");
    await user.selectOptions(screen.getByLabelText("Sector"), "sector-panol");
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    await waitFor(() => expect(workforceApiService.createDoubleHourRule).toHaveBeenCalled());
    const payload = vi.mocked(workforceApiService.createDoubleHourRule).mock.calls[0]![0];
    expect(payload.companyId).toBe("company-odwyer");
    expect(payload.sectorId).toBe("sector-panol");
    expect(payload.employeeIds).toEqual([]);
  });

  it("test 4 — si se activa 'Limitar a empleados específicos' sin elegir a nadie, bloquea el envío", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.click(screen.getByLabelText("Limitar a empleados específicos"));
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    expect(await screen.findByText(/seleccioná al menos un empleado/i)).toBeInTheDocument();
    expect(workforceApiService.createDoubleHourRule).not.toHaveBeenCalled();
  });

  it("test 5 — el texto de ayuda explica el alcance por default correctamente", async () => {
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    expect(
      screen.getByText(/si no seleccionás empleados, la regla aplica a todos los empleados dentro del alcance configurado/i),
    ).toBeInTheDocument();
  });

  it("test 6 — el preset 'Todo el año actual' completa Desde/Hasta para una regla semanal", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Todo el año actual" }));

    const year = new Date().getFullYear();
    expect((screen.getByLabelText("Desde") as HTMLInputElement).value).toBe(`${year}-01-01`);
    expect((screen.getByLabelText("Hasta") as HTMLInputElement).value).toBe(`${year}-12-31`);
  });

  it("test 7 — el calendario muestra la alerta de superposición cuando el backend la reporta", async () => {
    vi.mocked(workforceApiService.doubleHourRulesCalendar).mockResolvedValue([
      { date: new Date().toISOString().slice(0, 10), rules: [{ id: "r1", name: "Domingo", priority: 1, multiplier: 2 }, { id: "r2", name: "Feriado", priority: 1, multiplier: 2 }], hasOverlap: true, hasConflict: false },
    ]);
    renderPage();

    expect(await screen.findByText("Superposición")).toBeInTheDocument();
  });

  it("test 8 — el campo de prioridad se puede editar y viaja en el payload al crear", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    // exact:false porque la etiqueta también envuelve el texto de ayuda (<small>).
    const priorityInput = screen.getByLabelText("Prioridad", { exact: false }) as HTMLInputElement;
    await user.clear(priorityInput);
    await user.type(priorityInput, "5");
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    await waitFor(() => expect(workforceApiService.createDoubleHourRule).toHaveBeenCalled());
    const payload = vi.mocked(workforceApiService.createDoubleHourRule).mock.calls[0]![0];
    expect(payload.priority).toBe(5);
  });

  it("corrección — permite cargar una sola regla 'Feriado' con varias fechas (agregar 3, desactivar 1, quitar 1) sin crear una regla por feriado", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Nombre de la regla"), "Feriado");
    await user.type(screen.getByLabelText("Motivo o descripción"), "Feriados nacionales");
    await user.selectOptions(screen.getByLabelText("Tipo de calendario"), "FECHA");

    const dateInput = screen.getByLabelText("Nueva fecha") as HTMLInputElement;
    const addButton = screen.getByRole("button", { name: "Agregar fecha" });
    for (const date of ["2026-01-01", "2026-07-09", "2026-12-25"]) {
      await user.clear(dateInput);
      await user.type(dateInput, date);
      await user.click(addButton);
    }

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3); // no hace falta una regla por feriado — las 3 fechas conviven en la misma regla

    await user.click(within(items[0]!).getByRole("button", { name: /desactivar/i })); // 01/01 queda cargado pero inactivo
    await user.click(within(items[1]!).getByRole("button", { name: /quitar/i })); // 09/07 se quita de la regla

    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    await waitFor(() => expect(workforceApiService.createDoubleHourRule).toHaveBeenCalled());
    const payload = vi.mocked(workforceApiService.createDoubleHourRule).mock.calls[0]![0];
    expect(payload.recurrenceType).toBe("FECHA");
    expect(payload.dates).toHaveLength(2);
    expect(payload.dates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-01-01", isActive: false }),
        expect.objectContaining({ date: "2026-12-25", isActive: true }),
      ]),
    );
  });
});

// Corrección: el calendario (SpecialHourRulesCalendarMonth) tenía su propio
// fetch, desacoplado del listado — crear/editar/activar/borrar una regla
// nunca le llegaba ninguna señal y quedaba mostrando el mes visible con
// datos viejos hasta recargar la página o cambiar de mes. Estos tests
// cubren que el padre ahora avisa al calendario después de cada mutación.
describe("WorkScheduleSettingsPage — Etapa 8B (corrección: sincronización del calendario tras mutaciones)", () => {
  it("1 — crear una regla vuelve a pedir el calendario del mes visible", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(1));

    await fillRequiredBaseFields(user);
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    await waitFor(() => expect(workforceApiService.createDoubleHourRule).toHaveBeenCalled());
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(2));
  });

  it("2 — editar una regla existente también refresca el calendario", async () => {
    const rule = existingRule();
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([rule]);
    vi.mocked(workforceApiService.updateDoubleHourRule).mockResolvedValue(rule);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(1));
    await screen.findByText("Domingo");

    await user.click(screen.getByRole("button", { name: /editar domingo/i }));
    await user.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => expect(workforceApiService.updateDoubleHourRule).toHaveBeenCalled());
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(2));
  });

  it("3 — cambiar la prioridad de una regla y guardar refresca el calendario (para recalcular conflictos/superposiciones)", async () => {
    const rule = existingRule();
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([rule]);
    vi.mocked(workforceApiService.updateDoubleHourRule).mockResolvedValue({ ...rule, priority: 7 });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(1));
    await screen.findByText("Domingo");

    await user.click(screen.getByRole("button", { name: /editar domingo/i }));
    const priorityInput = screen.getByLabelText("Prioridad", { exact: false }) as HTMLInputElement;
    await user.clear(priorityInput);
    await user.type(priorityInput, "7");
    await user.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => expect(workforceApiService.updateDoubleHourRule).toHaveBeenCalledWith("rule-1", expect.objectContaining({ priority: 7 })));
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(2));
  });

  it("4 — agregar y quitar una fecha específica en una regla FECHA y guardar refresca el calendario", async () => {
    const rule = existingRule({ recurrenceType: "FECHA", dates: [{ id: "d1", date: "2026-12-25", isActive: true }] });
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([rule]);
    vi.mocked(workforceApiService.updateDoubleHourRule).mockResolvedValue(rule);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(1));
    await screen.findByText("Domingo");

    await user.click(screen.getByRole("button", { name: /editar domingo/i }));
    const dateInput = screen.getByLabelText("Nueva fecha") as HTMLInputElement;
    await user.type(dateInput, "2027-01-01");
    await user.click(screen.getByRole("button", { name: "Agregar fecha" }));
    const items = screen.getAllByRole("listitem");
    await user.click(within(items[0]!).getByRole("button", { name: /quitar/i }));

    await user.click(screen.getByRole("button", { name: /guardar cambios/i }));

    await waitFor(() => expect(workforceApiService.updateDoubleHourRule).toHaveBeenCalled());
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(2));
  });

  it("5 — si el calendario devuelve overlap/conflict actualizado tras la mutación, la UI lo refleja sin recargar la página", async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.mocked(workforceApiService.doubleHourRulesCalendar)
      .mockResolvedValueOnce([]) // carga inicial: sin superposición
      .mockResolvedValueOnce([{ date: today, rules: [{ id: "r1", name: "Domingo", priority: 1, multiplier: 2 }, { id: "r2", name: "Feriado", priority: 1, multiplier: 2 }], hasOverlap: true, hasConflict: false }]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Superposición")).not.toBeInTheDocument();

    await fillRequiredBaseFields(user);
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    expect(await screen.findByText("Superposición")).toBeInTheDocument();
  });

  it("6 — durante el refresh silencioso tras guardar, no se reemplaza el listado ni se vuelve a mostrar el loading de página completa del calendario", async () => {
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([existingRule()]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(1));
    await screen.findByText("Domingo"); // listado ya cargado

    await fillRequiredBaseFields(user);
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    await waitFor(() => expect(workforceApiService.doubleHourRulesCalendar).toHaveBeenCalledTimes(2));
    // El listado sigue en pantalla durante y después del refresh — nunca se vació.
    expect(screen.getByText("Domingo")).toBeInTheDocument();
    // El refresh fue silencioso: no volvió a aparecer el esqueleto de carga completo del calendario.
    expect(screen.queryByText("Cargando calendario...")).not.toBeInTheDocument();
  });
});

// Corrección de UI: la pantalla mezclaba un módulo ajeno (Turnos) y usaba
// lenguaje técnico de backend (TimeEntry, "regla ganadora") en textos
// pensados para RRHH. Estos tests fijan que ese copy no vuelva a aparecer.
describe("WorkScheduleSettingsPage — Etapa 8B (rediseño visual: copy funcional y limpieza de UI)", () => {
  it("no muestra nombres técnicos de backend (TimeEntry) en ningún texto de la pantalla", async () => {
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    expect(screen.queryByText(/TimeEntry/i)).not.toBeInTheDocument();
  });

  it("no muestra la card de Turnos — ese módulo ya tiene su propia pantalla", async () => {
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    expect(screen.queryByRole("heading", { name: "Turnos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ir a turnos/i })).not.toBeInTheDocument();
  });

  it("muestra el título y la bajada funcional de la pantalla, sin lenguaje técnico", async () => {
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    expect(screen.getByRole("heading", { name: "Horas especiales" })).toBeInTheDocument();
    expect(screen.getByText("Configurá reglas como domingos, feriados o casos especiales para calcular el valor liquidable de las horas registradas.")).toBeInTheDocument();
  });

  it("el formulario está organizado en secciones (Datos principales, Calendario, Alcance) dentro de una sola card", async () => {
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    expect(screen.getByRole("heading", { name: "Nueva regla" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Datos principales" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Calendario" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alcance" })).toBeInTheDocument();
  });

  it("el título de la card del formulario cambia a 'Editar regla' al editar una regla existente", async () => {
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([existingRule()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Domingo");

    await user.click(screen.getByRole("button", { name: /editar domingo/i }));

    expect(screen.getByRole("heading", { name: "Editar regla" })).toBeInTheDocument();
  });
});

// Corrección: el error de validación aparecía como un <div> sin ningún
// estilo (clase "form-error" sin reglas en styles.css) sentado arriba de
// toda la página, entre el header y la card — se veía como un título roto
// en vez de un aviso de formulario. Estos tests fijan que todo error quede
// contenido dentro de la card correspondiente, con aspecto de alert
// compacto (no de heading), y que el formulario/pantalla sigan usables.
describe("WorkScheduleSettingsPage — Etapa 8B (corrección: errores contenidos dentro de cada card, no sueltos en la página)", () => {
  function formCard() {
    const heading = screen.getByRole("heading", { name: /^(Nueva regla|Editar regla)$/ });
    const card = heading.closest("section");
    if (!card) throw new Error("No se encontró la card del formulario");
    return card;
  }

  it("el error de 'fechas específicas sin fechas' se renderiza dentro de la card del formulario, con rol alert", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.selectOptions(screen.getByLabelText("Tipo de calendario"), "FECHA");
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Agregá al menos una fecha para guardar esta regla.");
    expect(alert).toHaveClass("rule-form-alert-error");
    expect(formCard()).toContainElement(alert);
    expect(workforceApiService.createDoubleHourRule).not.toHaveBeenCalled();
  });

  it("el error no aparece como heading/título de página — no hay ningún <h1>-<h6> con ese texto", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.selectOptions(screen.getByLabelText("Tipo de calendario"), "FECHA");
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    const alert = await screen.findByRole("alert");
    expect(["DIV", "SPAN", "P"]).toContain(alert.tagName);
    expect(screen.queryByRole("heading", { name: /agregá al menos una fecha/i })).not.toBeInTheDocument();
  });

  it("activar 'empleados específicos' sin elegir a nadie muestra el error dentro de la card del formulario, con rol alert", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.click(screen.getByLabelText("Limitar a empleados específicos"));
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Seleccioná al menos un empleado o desactivá la opción de empleados específicos.");
    expect(formCard()).toContainElement(alert);
  });

  it("un error del backend al crear se muestra dentro de la card y el formulario sigue usable", async () => {
    vi.mocked(workforceApiService.createDoubleHourRule).mockRejectedValue(new Error("Ya existe una regla con ese nombre."));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalled());

    await fillRequiredBaseFields(user);
    await user.click(screen.getByRole("button", { name: /crear regla/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ya existe una regla con ese nombre.");
    expect(formCard()).toContainElement(alert);
    // La pantalla no se rompe: el formulario sigue ahí, con los datos cargados.
    expect(screen.getByRole("button", { name: /crear regla/i })).toBeInTheDocument();
    expect((screen.getByLabelText("Nombre de la regla") as HTMLInputElement).value).toBe("Domingo Odwyer");
  });

  it("un error del backend al editar también se muestra dentro de la card, sin romper la pantalla", async () => {
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([existingRule()]);
    vi.mocked(workforceApiService.updateDoubleHourRule).mockRejectedValue(new Error("No se pudo actualizar la regla."));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Domingo");

    await user.click(screen.getByRole("button", { name: /editar domingo/i }));
    await user.click(screen.getByRole("button", { name: /guardar cambios/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo actualizar la regla.");
    expect(formCard()).toContainElement(alert);
    expect(screen.getByRole("heading", { name: "Editar regla" })).toBeInTheDocument();
  });

  it("un error al activar/inactivar una regla se muestra dentro de la card del listado, no arriba de toda la página", async () => {
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([existingRule()]);
    vi.mocked(workforceApiService.updateDoubleHourRule).mockRejectedValue(new Error("No se pudo cambiar el estado."));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Domingo");

    await user.click(screen.getByRole("button", { name: /inactivar domingo/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo cambiar el estado.");
    const tableCard = screen.getByRole("heading", { name: "Reglas configuradas" }).closest("section");
    expect(tableCard).not.toBeNull();
    expect(tableCard).toContainElement(alert);
  });
});

describe("WorkScheduleSettingsPage — Etapa 8C (corrección: acciones de la tabla deshabilitadas durante el guardado)", () => {
  it("Editar/Activar-Inactivar/Eliminar quedan deshabilitados mientras una mutación está en curso, y se rehabilitan al terminar", async () => {
    vi.mocked(workforceApiService.doubleHourRules).mockResolvedValue([existingRule()]);
    let resolveUpdate!: (value: DoubleHourRule) => void;
    vi.mocked(workforceApiService.updateDoubleHourRule).mockReturnValue(
      new Promise((resolve) => { resolveUpdate = resolve; }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Domingo");

    expect(screen.getByRole("button", { name: /editar domingo/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /inactivar domingo/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /eliminar domingo/i })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: /inactivar domingo/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /editar domingo/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /(inactivar|activar) domingo/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /eliminar domingo/i })).toBeDisabled();
    });

    resolveUpdate(existingRule({ status: "INACTIVO" }));

    // La lista se recarga tras la mutación (mock siempre devuelve la regla
    // ACTIVO original) — lo que importa acá es que las 3 acciones vuelven a
    // habilitarse, no el estado final de la regla en sí.
    await waitFor(() => expect(screen.getByRole("button", { name: /editar domingo/i })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: /(inactivar|activar) domingo/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /eliminar domingo/i })).not.toBeDisabled();
  });
});
