import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoveltyModal } from "./NoveltyModal";
import { ApiError } from "../../services/api/apiClient";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../../services/api/noveltyTypeApiService";
import { hourConceptApiService } from "../../services/api/hourConceptApiService";
import type { Employee } from "../../types";
import type { NoveltyType } from "../../types/noveltyType.types";

vi.mock("../../services/api/noveltyApiService", () => ({
  noveltyApiService: { create: vi.fn() },
}));
vi.mock("../../services/api/noveltyTypeApiService", () => ({
  noveltyTypeApiService: { getAll: vi.fn() },
}));
vi.mock("../../services/api/hourConceptApiService", () => ({
  hourConceptApiService: { getAll: vi.fn() },
}));

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md,
// punto 25): NoveltyModal ahora filtra el catálogo por allowedLoadRoles del
// usuario -- por defecto se mockea RRHH (autoridad global, ve todo) para no
// afectar los tests existentes; los tests de filtrado por rol sobreescriben esto.
const mockUseAuth = vi.fn();
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));
function authAs(role: string) {
  mockUseAuth.mockReturnValue({ user: { id: "user-1", name: "Test", email: "", password: "", role, status: "Activo" }, login: vi.fn(), loginAs: vi.fn(), logout: vi.fn() });
}

function buildEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    legajo: "100",
    legajoInterno: "100",
    lastName: "Gomez",
    firstName: "Ana",
    dni: "12345678",
    cuil: "20-12345678-9",
    birthDate: "",
    gender: "",
    civilStatus: "",
    nationality: "Argentina",
    phone: "",
    mobile: "",
    email: "",
    address: "",
    addressStreet: "",
    addressNumber: "",
    city: "",
    department: "",
    province: "",
    zip: "",
    domicilio: {
      calle: "",
      numero: "",
      provinciaId: "",
      provinciaNombre: "",
      departamentoId: "",
      departamentoNombre: "",
      localidadId: "",
      localidadNombre: "",
      codigoPostal: "",
      ubicacionMapa: { lat: null, lng: null, source: "API", label: "" },
    },
    emergencyContact: "",
    emergencyRelation: "",
    emergencyPhone: "",
    company: "",
    businessUnit: "",
    establishment: "",
    costCenter: "",
    sector: "",
    position: "",
    receiptCategory: "",
    internalCategory: "",
    agreement: "",
    healthInsurance: "",
    directManager: "",
    timeResponsible: "",
    startDate: "",
    transport: false,
    transportRoute: "",
    transportNotes: "",
    enabledHours: [],
    status: "Activo",
    directManagerFrom: "",
    directManagerStatus: "",
    directManagerNotes: "",
    timeResponsibleRole: "",
    timeResponsibleFrom: "",
    timeResponsibleStatus: "",
    timeResponsibleNotes: "",
    mapLocation: "",
    locationMap: { lat: null, lng: null, source: "API", label: "" },
    novelties: [],
    documents: [],
    historyEvents: [],
    audit: [],
    routeHistory: [],
    ...overrides,
  };
}

function buildNoveltyType(overrides: Partial<NoveltyType> = {}): NoveltyType {
  return {
    id: "type-generic",
    code: "NOV-GENERICO",
    name: "Tipo genérico",
    uiColor: "blue",
    kind: "OTRO",
    origin: "INTERNA",
    description: "",
    status: "ACTIVO",
    rules: {
      exportsToFinnegans: false,
      requiresApproval: true,
      requiresDocumentation: false,
      allowsHours: false,
      allowsDateTo: true,
      hasValidity: false,
      blocksTimeEntry: false,
      setsWorkedHoursToZero: false,
      timeImpact: "NO_AFECTA_HORAS",
      timeEntryBehavior: "NO_BLOQUEA",
      allowsDateRange: true,
      finnegansValueUnit: null,
      finnegansRequiresValidity: false,
    },
    allowedLoadRoles: [],
    approvalRoles: [],
    finnegansLinks: [],
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    history: [],
    ...overrides,
  };
}

const llegadaTardeType = buildNoveltyType({
  id: "type-llegada-tarde",
  code: "NOV-LLEGADA-TARDE",
  name: "Llegada tarde",
  rules: {
    exportsToFinnegans: false,
    requiresApproval: false,
    requiresDocumentation: false,
    allowsHours: true,
    allowsDateTo: false,
    hasValidity: false,
    blocksTimeEntry: false,
    setsWorkedHoursToZero: false,
    timeImpact: "REGISTRA_HORAS_NO_TRABAJADAS",
    timeEntryBehavior: "NO_BLOQUEA",
    allowsDateRange: false,
    finnegansValueUnit: "HOURS",
    finnegansRequiresValidity: false,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hourConceptApiService.getAll).mockResolvedValue([]);
  authAs("Nivel 1 - RRHH");
});

describe("NoveltyModal — Etapa 15G.2 (precarga desde alerta)", () => {
  it("precarga fecha, cantidad de horas y observación cuando se pasan como props", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);

    render(
      <NoveltyModal
        employees={[buildEmployee()]}
        close={vi.fn()}
        saved={vi.fn()}
        initialFromDate="2026-08-20"
        initialQuantityHours={2}
        initialObservation="Generado desde alerta de fichador (Llegada tarde, alerta alert-1)."
        suggestedNoveltyTypeCode="NOV-LLEGADA-TARDE"
        contextNote="Se precargaron los datos detectados por la alerta."
      />,
    );

    await screen.findByText("Llegada tarde");

    expect(screen.getByLabelText("Desde")).toHaveValue("2026-08-20");
    expect(screen.getByLabelText("Cantidad de horas")).toHaveValue(2);
    expect(screen.getByText("Generado desde alerta de fichador (Llegada tarde, alerta alert-1).")).toBeInTheDocument();
  });

  it("la observación precargada es visible y editable aunque el tipo no exija documentación (Llegada tarde no la exige)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);

    render(
      <NoveltyModal
        employees={[buildEmployee()]}
        close={vi.fn()}
        saved={vi.fn()}
        initialObservation="Generado desde alerta de fichador."
        contextNote="Se precargaron los datos detectados por la alerta."
      />,
    );

    await screen.findByText("Llegada tarde");
    const textarea = screen.getByLabelText("Observación") as HTMLTextAreaElement;
    expect(textarea).toHaveValue("Generado desde alerta de fichador.");

    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Corregido por el usuario");
    expect(textarea).toHaveValue("Corregido por el usuario");
  });

  it("preselecciona el tipo sugerido por código cuando existe entre los tipos activos", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildNoveltyType({ id: "type-vac", code: "NOV-VACACIONES", name: "Vacaciones" }), llegadaTardeType]);

    render(
      <NoveltyModal
        employees={[buildEmployee()]}
        close={vi.fn()}
        saved={vi.fn()}
        suggestedNoveltyTypeCode="NOV-LLEGADA-TARDE"
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Tipo de novedad")).toHaveValue("type-llegada-tarde"));
  });

  it("si el código sugerido no existe entre los tipos activos, cae al primer tipo activo sin romper (no regresión)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildNoveltyType({ id: "type-vac", code: "NOV-VACACIONES", name: "Vacaciones" })]);

    render(
      <NoveltyModal
        employees={[buildEmployee()]}
        close={vi.fn()}
        saved={vi.fn()}
        suggestedNoveltyTypeCode="NOV-CODIGO-INEXISTENTE"
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("Tipo de novedad")).toHaveValue("type-vac"));
  });

  it("sin ningún prop de precarga, se comporta exactamente igual que la carga manual (sin regresión)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Llegada tarde");
    expect(screen.getByLabelText("Cantidad de horas")).toHaveValue(1);
    expect(screen.queryByText(/Se precargaron los datos/)).not.toBeInTheDocument();
  });

  it("muestra el contextNote cuando se pasa (aviso de que los datos vienen de una alerta)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);

    render(
      <NoveltyModal
        employees={[buildEmployee()]}
        close={vi.fn()}
        saved={vi.fn()}
        contextNote="Se precargaron los datos detectados por la alerta. Revisá el tipo y la observación antes de guardar."
      />,
    );

    expect(await screen.findByText(/Se precargaron los datos detectados por la alerta/)).toBeInTheDocument();
  });

  it("guardar sigue usando el flujo normal de creación de novedades (noveltyApiService.create), con los valores precargados", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-created" } as never]);
    const saved = vi.fn();

    render(
      <NoveltyModal
        employees={[buildEmployee()]}
        close={vi.fn()}
        saved={saved}
        initialFromDate="2026-08-20"
        initialQuantityHours={2}
        initialObservation="Generado desde alerta de fichador."
        suggestedNoveltyTypeCode="NOV-LLEGADA-TARDE"
      />,
    );

    await screen.findByText("Llegada tarde");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeIds: ["employee-1"],
        noveltyTypeId: "type-llegada-tarde",
        fromDate: "2026-08-20",
        quantityHours: 2,
        observation: "Generado desde alerta de fichador.",
      }),
    ));
    expect(saved).toHaveBeenCalledWith([{ id: "novelty-created" }]);
  });

  // Ajuste posterior (evitar over-fetching, docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md):
  // confirma en el propio componente -- no sólo en las páginas que lo
  // montan -- que un solo empleado con nada más que id/legajo/nombre/
  // apellido (el subconjunto mínimo que ya trae una alerta) alcanza para
  // que el modal funcione de punta a punta, sin necesitar el resto de los
  // ~45 campos de Employee.
  it("funciona con un empleado mínimo (id/legajo/firstName/lastName), sin el resto de los campos de Employee", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-created" } as never]);
    const minimalEmployee = { id: "employee-9", legajo: "900", firstName: "Luz", lastName: "Perez" } as Employee;

    render(<NoveltyModal employees={[minimalEmployee]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Llegada tarde");
    expect(screen.getByText("900 · Perez, Luz")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ["employee-9"] }),
    ));
  });
});

// Etapa 15G.3 (docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md): el
// backend ya arma un mensaje humano y especifico (tipo + legajo, sin ids
// tecnicos) para NOVELTY_DUPLICATE/NOVELTY_OVERLAP -- estos tests
// confirman que el modal lo muestra tal cual, sin reimplementar la regla
// de duplicado/solapamiento en el frontend (sólo refleja lo que el
// backend ya decidió) y sin romper el manejo de errores existente para
// otros codigos.
describe("NoveltyModal — Etapa 15G.3 (conflicto de duplicado/solapamiento)", () => {
  it("NOVELTY_DUPLICATE: muestra el mensaje especifico del backend (tipo + legajo), no el generico", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);
    vi.mocked(noveltyApiService.create).mockRejectedValue(
      new ApiError('Ya existe una novedad "Llegada tarde" para el legajo 100 en la fecha seleccionada.', "NOVELTY_DUPLICATE", 409),
    );

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Llegada tarde");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    expect(await screen.findByText('Ya existe una novedad "Llegada tarde" para el legajo 100 en la fecha seleccionada.')).toBeInTheDocument();
    expect(screen.queryByText("No pudimos guardar la novedad. Revisá los datos e intentá nuevamente.")).not.toBeInTheDocument();
  });

  it("NOVELTY_OVERLAP: muestra el mensaje especifico del backend, sin ningun id/UUID tecnico visible", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);
    vi.mocked(noveltyApiService.create).mockRejectedValue(
      new ApiError('Ya existe una novedad "Llegada tarde" para el legajo 100 que se superpone con el rango de fechas seleccionado.', "NOVELTY_OVERLAP", 409),
    );

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Llegada tarde");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    const message = await screen.findByText(/se superpone con el rango de fechas/);
    expect(message).toBeInTheDocument();
    expect(message.textContent?.toLowerCase()).not.toMatch(/\buuid\b|employee-1|type-llegada-tarde/);
  });

  it("otros codigos de error siguen mostrando el mensaje generico existente (sin regresion)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);
    vi.mocked(noveltyApiService.create).mockRejectedValue(
      new ApiError("El tipo de novedad no está disponible.", "NOVELTY_TYPE_NOT_AVAILABLE", 400),
    );

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Llegada tarde");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    expect(await screen.findByText("No pudimos guardar la novedad. Revisá los datos e intentá nuevamente.")).toBeInTheDocument();
  });
});

// Etapa 15L.2B.1 (corrección puntual, docs/decisions/
// NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): allowsHours decide qué
// cantidad se envía -- decisión operativa de la novedad, siempre respetada
// sin importar finnegansValueUnit (que sólo describe cómo Finnegans va a
// interpretar esa cantidad al exportar, un tema del exportador). No
// modifica TimeEntry -- quantityHours/quantityDays son sólo metadato.
describe("NoveltyModal — Etapa 15L.2B.1 (allowsHours decide la cantidad, independiente de finnegansValueUnit)", () => {
  it("allowsHours=true envía quantityHours sin importar finnegansValueUnit=null", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-created" } as never]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Llegada tarde");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantityHours: expect.any(Number), quantityDays: null }),
    ));
  });

  it("allowsHours=true + finnegansValueUnit=UNIT igual envía quantityHours (no se descarta en silencio)", async () => {
    const type = buildNoveltyType({
      id: "type-hours-unit",
      code: "NOV-HOURS-UNIT",
      name: "HorasUnidad",
      rules: { ...buildNoveltyType().rules, allowsHours: true, finnegansValueUnit: "UNIT" },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-created" } as never]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("HorasUnidad");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantityHours: expect.any(Number), quantityDays: null }),
    ));
  });

  it("allowsHours=true + finnegansValueUnit=DAYS igual envía quantityHours", async () => {
    const type = buildNoveltyType({
      id: "type-hours-days",
      code: "NOV-HOURS-DAYS",
      name: "HorasDias",
      rules: { ...buildNoveltyType().rules, allowsHours: true, finnegansValueUnit: "DAYS" },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-created" } as never]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("HorasDias");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantityHours: expect.any(Number), quantityDays: null }),
    ));
  });

  // Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md): cierra
  // el gap que dejaba abierto 15L.2C -- antes el frontend calculaba y
  // enviaba un quantityDays (recortado al mes de fromDate, bug real) sin
  // importar si el tipo lo necesitaba. Ahora nunca se envía ninguno: el
  // backend es la única autoridad y lo recalcula siempre sobre el rango
  // real completo, sin importar finnegansValueUnit.
  it("allowsHours=false: nunca envía quantityDays calculado (el backend lo recalcula), sin importar finnegansValueUnit=UNIT", async () => {
    const type = buildNoveltyType({
      id: "type-sancion",
      code: "NOV-SANCION",
      name: "Sancion",
      rules: { ...buildNoveltyType().rules, allowsHours: false, finnegansValueUnit: "UNIT" },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);
    vi.mocked(noveltyApiService.create).mockResolvedValue([{ id: "novelty-created" } as never]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Sancion");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(
      expect.objectContaining({ quantityHours: null, quantityDays: null }),
    ));
  });

  it("allowsHours=false + finnegansValueUnit=HOURS: el input de horas ni siquiera se muestra (combinación imposible desde este formulario, documentada para 15L.2C)", async () => {
    const type = buildNoveltyType({
      id: "type-hours-export-no-capture",
      code: "NOV-HOURS-EXPORT",
      name: "SoloExportaHoras",
      rules: { ...buildNoveltyType().rules, allowsHours: false, finnegansValueUnit: "HOURS" },
    });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("SoloExportaHoras");
    expect(screen.queryByLabelText("Cantidad de horas")).not.toBeInTheDocument();
  });
});

// Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md §11/§20):
// previsualización de "Cantidad de días" -- nunca se envía como el dato
// definitivo (eso lo decide el backend), pero le muestra a RRHH un número
// coherente con lo que el backend va a calcular, sobre el rango real
// completo (nunca recortado al mes de fromDate, el bug que tenía la lógica
// duplicada antes de esta etapa).
describe("NoveltyModal — Etapa 15L.5 (previsualización de Cantidad de días)", () => {
  it("DAYS: no hay ningún input manual de cantidad de días -- sólo texto de previsualización", async () => {
    const type = buildNoveltyType({ id: "type-dias", code: "NOV-DIAS", name: "Suspension", rules: { ...buildNoveltyType().rules, allowsHours: false } });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Suspension");
    expect(screen.queryByLabelText("Cantidad de días")).not.toBeInTheDocument();
    expect(screen.getByText(/Cantidad de días:/)).toBeInTheDocument();
  });

  it("HOURS: sigue mostrando el input manual de cantidad de horas (sin cambios)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([llegadaTardeType]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Llegada tarde");
    expect(screen.getByLabelText("Cantidad de horas")).toBeInTheDocument();
    expect(screen.queryByText(/Cantidad de días:/)).not.toBeInTheDocument();
  });

  it("mismo día (Desde = Hasta): previsualiza 1 día", async () => {
    const type = buildNoveltyType({ id: "type-dias", code: "NOV-DIAS", name: "Suspension", rules: { ...buildNoveltyType().rules, allowsHours: false } });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);
    await screen.findByText("Suspension");

    expect(screen.getByText("Cantidad de días: 1")).toBeInTheDocument();
  });

  it("cross-month 30/07 → 02/08: previsualiza 4 días, no sólo los del mes de Desde", async () => {
    const type = buildNoveltyType({ id: "type-dias", code: "NOV-DIAS", name: "Suspension", rules: { ...buildNoveltyType().rules, allowsHours: false } });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);
    await screen.findByText("Suspension");

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-07-30" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-08-02" } });

    expect(screen.getByText("Cantidad de días: 4")).toBeInTheDocument();
  });

  it("cambio de año 31/12 → 02/01: previsualiza 3 días", async () => {
    const type = buildNoveltyType({ id: "type-dias", code: "NOV-DIAS", name: "Suspension", rules: { ...buildNoveltyType().rules, allowsHours: false } });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);
    await screen.findByText("Suspension");

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2027-01-02" } });

    expect(screen.getByText("Cantidad de días: 3")).toBeInTheDocument();
  });

  it("cambiar cualquiera de las dos fechas actualiza la previsualización", async () => {
    const type = buildNoveltyType({ id: "type-dias", code: "NOV-DIAS", name: "Suspension", rules: { ...buildNoveltyType().rules, allowsHours: false } });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([type]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);
    await screen.findByText("Suspension");
    expect(screen.getByText("Cantidad de días: 1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-09-05" } });
    expect(screen.getByText(/Cantidad de días: \d+/)).toBeInTheDocument();
    expect(screen.queryByText("Cantidad de días: 1")).not.toBeInTheDocument();
  });
});

// Etapa 15L.2B, punto 25: filtra el catálogo por allowedLoadRoles del
// usuario actual -- RRHH mantiene autoridad global (mismo criterio que
// assertCanLoad en el backend).
describe("NoveltyModal — Etapa 15L.2B (filtro por allowedLoadRoles)", () => {
  it("un rol no-RRHH sólo ve los tipos que puede cargar", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    const loadable = buildNoveltyType({ id: "type-loadable", code: "NOV-LOADABLE", name: "Cargable", allowedLoadRoles: ["Nivel 2 - Supervisión / Gestión"] });
    const notLoadable = buildNoveltyType({ id: "type-not-loadable", code: "NOV-NOLOAD", name: "Solo RRHH", allowedLoadRoles: ["Nivel 1 - RRHH"] });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([loadable, notLoadable]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Cargable");
    expect(screen.queryByText("Solo RRHH")).not.toBeInTheDocument();
  });

  it("RRHH ve todos los tipos activos sin importar allowedLoadRoles", async () => {
    authAs("Nivel 1 - RRHH");
    const rrhhOnly = buildNoveltyType({ id: "type-rrhh-only", code: "NOV-RRHH", name: "Solo RRHH", allowedLoadRoles: [] });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([rrhhOnly]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    await screen.findByText("Solo RRHH");
  });

  it("si ningún tipo cargable, muestra un mensaje distinto al de catálogo vacío", async () => {
    authAs("Nivel 3 - Administrativo de Carga Horaria");
    const rrhhOnly = buildNoveltyType({ id: "type-rrhh-only", code: "NOV-RRHH", name: "Solo RRHH", allowedLoadRoles: ["Nivel 1 - RRHH"] });
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([rrhhOnly]);

    render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={vi.fn()} />);

    expect(await screen.findByText("Tu rol no tiene tipos de novedad habilitados para cargar.")).toBeInTheDocument();
  });
});
