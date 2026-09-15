import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hourConceptApiService.getAll).mockResolvedValue([]);
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
