import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoveltyModal } from "./NoveltyModal";
import { ApiError } from "../../services/api/apiClient";
import { noveltyApiService } from "../../services/api/noveltyApiService";
import { noveltyTypeApiService } from "../../services/api/noveltyTypeApiService";
import { hourConceptApiService } from "../../services/api/hourConceptApiService";
import type { NoveltyCoveragePreview, NoveltyCoveragePreviewDay } from "../../services/api/noveltyApiService";
import type { Employee, Novelty } from "../../types";
import type { NoveltyType } from "../../types/noveltyType.types";
import { defaultNoveltyTypeCoverage } from "../../utils/noveltyTypeCoverage";

vi.mock("../../services/api/noveltyApiService", () => ({
  noveltyApiService: { create: vi.fn(), createWithDocument: vi.fn(), previewCoverage: vi.fn() },
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
    description: "",
    status: "ACTIVO",
    rules: {
      exportsToFinnegans: false,
      requiresDocumentation: false,
      allowsHours: false,
      timeEntryBehavior: "NO_BLOQUEA",
      allowsDateRange: true,
      finnegansValueUnit: null,
      finnegansRequiresValidity: false,
      requiresObservation: false,
    },
    coverage: defaultNoveltyTypeCoverage(),
    allowedLoadRoles: [],
    finnegansCode: null,
    finnegansName: null,
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    ...overrides,
  };
}


// Etapa 8 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §15): los cinco tipos de
// validación son sólo configuraciones; el formulario nunca mira el nombre.
const baseRules = buildNoveltyType().rules;
const base = defaultNoveltyTypeCoverage();
const tramite = buildNoveltyType({
  id: "type-tramite", code: "TB", name: "Trámite bancario",
  rules: { ...baseRules, allowsDateRange: false },
  coverage: { ...base, mode: "FIXED_MINUTES", fixedMinutes: 240, onDayOff: "NO_COVERAGE", onHoliday: "NO_COVERAGE", countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
});
const vacaciones = buildNoveltyType({
  id: "type-vacaciones", code: "VAC", name: "Vacaciones",
  coverage: { ...base, mode: "EXPECTED_SCHEDULE", dayRule: "WORK_OBLIGATION", appliesSpecialHours: true, countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
});
const maternidad = buildNoveltyType({
  id: "type-maternidad", code: "MAT", name: "Maternidad",
  coverage: { ...base, mode: "FIXED_MINUTES", fixedMinutes: 480, dayRule: "SELECTED_WEEKDAYS", weekdays: [1, 2, 3, 4, 5], onDayOff: "COVER", onHoliday: "NO_COVERAGE", countsTowardTotal: true, realWorkCompatibility: "INCOMPATIBLE" },
});
const llegadaTarde = buildNoveltyType({
  id: "type-llegada", code: "LLT", name: "Llegada tarde",
  rules: { ...baseRules, allowsDateRange: false, allowsHours: true },
  coverage: { ...base, mode: "MANUAL_MINUTES" },
});
const faltaSinAviso = buildNoveltyType({
  id: "type-falta", code: "FSA", name: "Falta sin aviso",
  coverage: { ...base, realWorkCompatibility: "INCOMPATIBLE" },
});

function previewDay(date: string, overrides: Partial<NoveltyCoveragePreviewDay> = {}): NoveltyCoveragePreviewDay {
  return {
    date, outcome: "COVERED", scheduleReviewReason: null, reviewStatus: "NOT_REQUIRED", label: "Cubre", expectedMinutes: 480, baseMinutes: 480,
    resolution: null, resolvedBaseMinutes: null, effectiveBaseMinutes: 480, multiplier: 1, computedMinutes: 480, countsTowardTotal: true,
    workedMinutes: 0, stateWhenApproved: "COUNTED", reviewReasons: [], ...overrides,
  };
}

function previewOf(days: NoveltyCoveragePreviewDay[], initialStatus: NoveltyCoveragePreview["initialStatus"] = "APROBADO"): NoveltyCoveragePreview {
  return {
    noveltyType: { id: "type", code: "T", name: "Tipo" },
    initialStatus,
    employees: [{ employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" }, days, totals: { days: days.length, coveredDays: 0, pendingReviewDays: 0, baseMinutes: 0, computedMinutes: 0 } }],
  };
}

function renderModal(types: NoveltyType[], props: Partial<Parameters<typeof NoveltyModal>[0]> = {}) {
  vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue(types);
  const saved = vi.fn();
  render(<NoveltyModal employees={[buildEmployee()]} close={vi.fn()} saved={saved} initialFromDate="2026-11-16" {...props} />);
  return { saved };
}

async function chooseType(name: string) {
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Tipo de novedad" }), name);
}

const createdNovelties = [{ id: "nov-1", employeeId: "employee-1" }] as Novelty[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hourConceptApiService.getAll).mockResolvedValue([]);
  authAs("Nivel 1 - RRHH");
  vi.mocked(noveltyApiService.previewCoverage).mockResolvedValue(previewOf([previewDay("2026-11-16")]));
  vi.mocked(noveltyApiService.create).mockResolvedValue(createdNovelties);
  vi.mocked(noveltyApiService.createWithDocument).mockResolvedValue(createdNovelties);
});

describe("NoveltyModal — Etapa 8: adaptación según el Tipo", () => {
  it("Trámite bancario: 4 h fijas, sin duración ni fecha hasta; preview 4 h y conflicto con trabajo real", async () => {
    vi.mocked(noveltyApiService.previewCoverage).mockResolvedValue(previewOf([
      previewDay("2026-11-16", { baseMinutes: 240, effectiveBaseMinutes: 240, computedMinutes: 240, workedMinutes: 300, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] }),
    ]));
    renderModal([tramite]);

    expect(await screen.findByText("Este tipo cubre 4 h por día según su configuración.")).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha *")).toHaveValue("2026-11-16");
    expect(screen.queryByLabelText(/Hasta/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Duración/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Cubre: 4 h/)).toBeInTheDocument();
    expect(screen.getByText("Trabajo registrado: 5 h")).toBeInTheDocument();
    expect(screen.getByText(/Existe trabajo registrado en este día y este tipo de novedad no puede coexistir con horas trabajadas/)).toBeInTheDocument();
    expect(noveltyApiService.previewCoverage).toHaveBeenCalledWith({ employeeIds: ["employee-1"], noveltyTypeId: "type-tramite", fromDate: "2026-11-16", toDate: null, quantityHours: null }, expect.anything());

    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ toDate: null, quantityHours: null, quantityDays: null })));
  });

  it("Vacaciones: rango opcional y vista previa por día (domingo ×2, franco, feriado no convocado, sin jornada)", async () => {
    vi.mocked(noveltyApiService.previewCoverage).mockResolvedValue(previewOf([
      previewDay("2026-11-16"),
      previewDay("2026-11-17", { outcome: "DAY_OFF", label: "Franco", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0 }),
      previewDay("2026-11-20", { outcome: "HOLIDAY_NOT_CONVOKED", label: "Feriado sin convocatoria", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0 }),
      previewDay("2026-11-22", { multiplier: 2, computedMinutes: 960 }),
      previewDay("2026-11-23", { outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "EXPECTED_MINUTES_UNKNOWN", reviewStatus: "PENDING", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["SCHEDULE_UNRESOLVED"] }),
    ], "PENDIENTE"));
    renderModal([vacaciones]);

    expect(await screen.findByText("Las horas se calcularán según la jornada que debía cumplir la persona.")).toBeInTheDocument();
    expect(screen.getByLabelText("Hasta (opcional)")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Hasta (opcional)"), "2026-11-23");

    const panel = screen.getByRole("region", { name: "Vista previa de cobertura" });
    await within(panel).findByText("Lunes 16/11");
    expect(within(panel).getByText("Franco")).toBeInTheDocument();
    expect(within(panel).getByText("Feriado · No convocado")).toBeInTheDocument();
    expect(within(panel).getByText("Cubre: 8 h · Multiplicador ×2 · Liquidación: 16 h")).toBeInTheDocument();
    expect(within(panel).getByText("Requiere revisión")).toBeInTheDocument();
    expect(within(panel).getByText("No se pudo determinar la jornada.")).toBeInTheDocument();
    expect(within(panel).getByText("Cobertura provisional: 0 h")).toBeInTheDocument();
    // Resumen agregado sólo con lo calculado por el backend.
    expect(within(panel).getByText("Computables").nextSibling).toHaveTextContent("16 h");
    expect(within(panel).getByText("Para liquidación").nextSibling).toHaveTextContent("24 h");
    expect(within(panel).getByText("Requieren revisión").nextSibling).toHaveTextContent("1 día");
    expect(panel.textContent).not.toMatch(/SCHEDULE_UNRESOLVED|EXPECTED_MINUTES_UNKNOWN|DAY_OFF|HOLIDAY_NOT_CONVOKED/);
    expect(noveltyApiService.previewCoverage).toHaveBeenLastCalledWith(expect.objectContaining({ toDate: "2026-11-23" }), expect.anything());
  });

  it("Maternidad: 8 h fijas, fin de semana fuera y política de feriado tal como la resolvió el backend", async () => {
    vi.mocked(noveltyApiService.previewCoverage).mockResolvedValue(previewOf([
      previewDay("2026-11-20", { outcome: "HOLIDAY_EXCLUDED", label: "Feriado: no cuenta", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0 }),
      previewDay("2026-11-21", { outcome: "WEEKDAY_NOT_INCLUDED", label: "Día no incluido", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0 }),
    ]));
    renderModal([maternidad]);

    expect(await screen.findByText("Este tipo cubre 8 h por día según su configuración.")).toBeInTheDocument();
    expect(await screen.findByText("Feriado · No cuenta")).toBeInTheDocument();
    expect(screen.getByText("Día no incluido")).toBeInTheDocument();
  });

  it("Llegada tarde: pide duración HH:mm, es informativa y envía la cantidad una sola vez", async () => {
    vi.mocked(noveltyApiService.previewCoverage).mockResolvedValue(previewOf([
      previewDay("2026-11-16", { baseMinutes: 90, effectiveBaseMinutes: 90, computedMinutes: 90, countsTowardTotal: false, stateWhenApproved: "INFORMATIVE" }),
    ]));
    renderModal([llegadaTarde]);

    const duration = await screen.findByLabelText("Duración *");
    expect(screen.queryByLabelText(/Cantidad de horas informativa/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Hasta/)).not.toBeInTheDocument();
    expect(screen.getByText("Completá la fecha y la duración para ver cómo quedará la novedad.")).toBeInTheDocument();
    await userEvent.type(duration, "01:30");

    expect(await screen.findByText("Duración: 1 h 30 min · No suma al total")).toBeInTheDocument();
    expect(screen.getByText("Informativa", { selector: ".novelty-preview-day-title" })).toBeInTheDocument();
    expect(noveltyApiService.previewCoverage).toHaveBeenCalledWith(expect.objectContaining({ quantityHours: 1.5 }), expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ quantityHours: 1.5, quantityDays: null, toDate: null })));
  });

  it("Falta sin aviso: sin horas; con trabajo registrado avisa que deberá revisarse", async () => {
    vi.mocked(noveltyApiService.previewCoverage).mockResolvedValue(previewOf([
      previewDay("2026-11-16", { outcome: "NO_COVERAGE", label: "No registra tiempo", baseMinutes: 0, effectiveBaseMinutes: 0, computedMinutes: 0, countsTowardTotal: false, expectedMinutes: null, workedMinutes: 480, stateWhenApproved: "REVIEW_REQUIRED", reviewReasons: ["REAL_WORK_ON_INCOMPATIBLE"] }),
    ]));
    renderModal([faltaSinAviso]);

    await screen.findByLabelText("Observación");
    expect(screen.queryByLabelText(/Duración|Cantidad de horas/)).not.toBeInTheDocument();
    expect(await screen.findByText("Sin horas de cobertura")).toBeInTheDocument();
    expect(screen.getByText("Existe trabajo registrado en la fecha. La novedad deberá revisarse.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ quantityHours: null })));
  });

  it("registro heredado: con allowsHours fuera de la cantidad manual, la cantidad es sólo informativa", async () => {
    const legacy = buildNoveltyType({ id: "type-legacy", name: "Licencia con horas", rules: { ...baseRules, allowsHours: true } });
    renderModal([legacy]);

    const hours = await screen.findByLabelText("Cantidad de horas informativa");
    expect(screen.getByText("Este valor es sólo un dato adicional. No cubre horas ni suma al total.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Duración/)).not.toBeInTheDocument();
    await userEvent.type(hours, "2");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ quantityHours: 2 })));
    expect(noveltyApiService.previewCoverage).not.toHaveBeenCalledWith(expect.objectContaining({ quantityHours: 2 }), expect.anything());
  });

  it("cambiar de tipo adapta el formulario, limpia lo que no aplica y recalcula la vista previa", async () => {
    renderModal([llegadaTarde, vacaciones]);
    await userEvent.type(await screen.findByLabelText("Duración *"), "01:00");
    await waitFor(() => expect(noveltyApiService.previewCoverage).toHaveBeenCalledWith(expect.objectContaining({ noveltyTypeId: "type-llegada" }), expect.anything()));

    await chooseType("Vacaciones");

    expect(screen.queryByLabelText(/Duración/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Hasta (opcional)")).toBeInTheDocument();
    await waitFor(() => expect(noveltyApiService.previewCoverage).toHaveBeenLastCalledWith(expect.objectContaining({ noveltyTypeId: "type-vacaciones", quantityHours: null }), expect.anything()));
    expect(screen.queryByText("TB")).not.toBeInTheDocument();
  });
});

describe("NoveltyModal — Etapa 8: fechas", () => {
  it("Hasta vacío es un solo día (toDate null), nunca un rango abierto", async () => {
    renderModal([vacaciones]);
    await screen.findByLabelText("Hasta (opcional)");
    expect(screen.getByText("Si la dejás vacía, la novedad vale sólo para la fecha desde.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ fromDate: "2026-11-16", toDate: null })));
  });

  it("Hasta anterior a Desde se marca y no se envía ni se pide vista previa", async () => {
    renderModal([vacaciones]);
    await userEvent.type(await screen.findByLabelText("Hasta (opcional)"), "2026-11-10");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    const to = screen.getByLabelText("Hasta (opcional)");
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(to).toHaveAccessibleDescription(/La fecha hasta no puede ser anterior a la fecha desde./);
    expect(noveltyApiService.create).not.toHaveBeenCalled();
    expect(noveltyApiService.previewCoverage).not.toHaveBeenCalledWith(expect.objectContaining({ toDate: "2026-11-10" }), expect.anything());
  });

  it("si el tipo exige vigencia, Hasta es obligatoria", async () => {
    renderModal([buildNoveltyType({ id: "type-vig", name: "Con vigencia", rules: { ...baseRules, finnegansRequiresValidity: true } })]);
    await screen.findByLabelText("Hasta *");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    expect(screen.getByText("Este tipo de novedad exige indicar la fecha hasta.")).toBeInTheDocument();
    expect(noveltyApiService.create).not.toHaveBeenCalled();
  });
});

describe("NoveltyModal — Etapa 8: observación, documentación y aprobación", () => {
  it("observación obligatoria: marca el campo, asocia el error y lleva el foco", async () => {
    renderModal([buildNoveltyType({ id: "type-obs", name: "Con observación", rules: { ...baseRules, requiresObservation: true } })], { initialObservation: undefined });
    const observation = await screen.findByLabelText("Observación *");

    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    expect(observation).toHaveFocus();
    expect(observation).toHaveAttribute("aria-invalid", "true");
    expect(observation).toHaveAccessibleDescription("Escribí la observación: este tipo de novedad la exige.");
    expect(noveltyApiService.create).not.toHaveBeenCalled();
    await userEvent.type(observation, "Detalle");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ observation: "Detalle" })));
  });

  it("observación opcional: se puede escribir y no es obligatoria", async () => {
    renderModal([vacaciones]);
    expect(await screen.findByLabelText("Observación")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ observation: null })));
  });

  // Etapa 8 (§15.1): novedad y documento viajan en un único pedido; el backend garantiza la regla.
  const conCertificado = buildNoveltyType({ id: "type-doc", name: "Con certificado", rules: { ...baseRules, requiresDocumentation: true } });

  it("documentación obligatoria sin archivo: no envía nada", async () => {
    renderModal([conCertificado]);
    await screen.findByLabelText("Documentación *");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    expect(screen.getByText("Adjuntá la documentación: este tipo de novedad la exige.")).toBeInTheDocument();
    expect(noveltyApiService.create).not.toHaveBeenCalled();
    expect(noveltyApiService.createWithDocument).not.toHaveBeenCalled();
  });

  it("documentación obligatoria con archivo: un solo pedido con la novedad y su documento", async () => {
    const { saved } = renderModal([conCertificado]);
    const file = new File(["%PDF"], "certificado.pdf", { type: "application/pdf" });
    await userEvent.upload(await screen.findByLabelText("Documentación *"), file);
    await userEvent.type(screen.getByLabelText("Observación"), "Certificado médico");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    await waitFor(() => expect(noveltyApiService.createWithDocument).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ["employee-1"], noveltyTypeId: "type-doc", observation: "Certificado médico" }), file, "Certificado médico",
    ));
    expect(noveltyApiService.create).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledWith(createdNovelties);
  });

  it("si el documento no se guarda, se informa que la novedad no se creó; reintentar no duplica", async () => {
    vi.mocked(noveltyApiService.createWithDocument).mockRejectedValueOnce(
      new ApiError("No pudimos guardar la documentación, así que la novedad no se creó. Intentá nuevamente.", "NOVELTY_DOCUMENT_UPLOAD_FAILED", 502),
    );
    const { saved } = renderModal([conCertificado]);
    await userEvent.upload(await screen.findByLabelText("Documentación *"), new File(["x"], "c.pdf", { type: "application/pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));

    expect(await screen.findByText("No pudimos guardar la documentación, así que la novedad no se creó. Intentá nuevamente.")).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Guardar novedad" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    // El primer intento no creó nada (el backend compensa): sólo el segundo crea.
    expect(noveltyApiService.createWithDocument).toHaveBeenCalledTimes(2);
    expect(noveltyApiService.create).not.toHaveBeenCalled();
  });

  it("documentación opcional: no se pide archivo y el alta es la de siempre", async () => {
    renderModal([vacaciones]);
    await screen.findByLabelText("Observación");
    expect(screen.queryByLabelText(/Documentación/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalled());
    expect(noveltyApiService.createWithDocument).not.toHaveBeenCalled();
  });

  it("sin aprobación administrativa: ningún rol ve avisos de aprobación pendiente", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    renderModal([buildNoveltyType({ ...vacaciones, allowedLoadRoles: ["Nivel 2 - Supervisión / Gestión"] })]);
    await screen.findByLabelText("Observación");
    expect(screen.queryByText(/quedará pendiente hasta ser aprobada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requiere aprobación/i)).not.toBeInTheDocument();
  });
});

describe("NoveltyModal — Etapa 8: vista previa", () => {
  it("muestra 'calculando' y luego el resultado", async () => {
    let resolve!: (value: NoveltyCoveragePreview) => void;
    vi.mocked(noveltyApiService.previewCoverage).mockReturnValue(new Promise((done) => { resolve = done; }));
    renderModal([tramite]);

    expect(await screen.findByText("Calculando vista previa…")).toBeInTheDocument();
    resolve(previewOf([previewDay("2026-11-16", { baseMinutes: 240, effectiveBaseMinutes: 240, computedMinutes: 240 })]));
    expect(await screen.findByText("Cubre: 4 h · Liquidación: 4 h")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Vista previa actualizada: 1 día.");
  });

  it("si falla, informa sin bloquear el guardado y permite reintentar", async () => {
    vi.mocked(noveltyApiService.previewCoverage).mockRejectedValueOnce(new Error("network"));
    renderModal([tramite]);

    expect(await screen.findByText("No pudimos calcular la vista previa. Intentá nuevamente.", { selector: ".novelty-preview-error p" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No pudimos calcular la vista previa.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText(/Cubre: 8 h/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalled());
  });
});

describe("NoveltyModal — Etapa 8: errores del backend en lenguaje de negocio", () => {
  it("período cerrado", async () => {
    vi.mocked(noveltyApiService.create).mockRejectedValue(new ApiError("El período ya fue enviado a cierre.", "PERIOD_CLOSED", 409));
    renderModal([tramite]);
    await screen.findByText("Este tipo cubre 4 h por día según su configuración.");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    expect(await screen.findByText("No se puede cargar esta novedad porque el período está cerrado. Reabrilo desde Cierres mensuales para modificarlo.")).toBeInTheDocument();
  });

  it("período cerrado: no ofrece una corrección con motivo (hay que reabrir el mes)", async () => {
    vi.mocked(noveltyApiService.create).mockRejectedValue(new ApiError("El período está cerrado.", "PERIOD_CLOSED", 409));
    renderModal([tramite]);
    await screen.findByText("Este tipo cubre 4 h por día según su configuración.");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await screen.findByText(/Reabrilo desde Cierres mensuales/);
    expect(screen.queryByLabelText(/Motivo de la corrección/)).not.toBeInTheDocument();
    expect(noveltyApiService.create).toHaveBeenCalledWith(expect.not.objectContaining({ correctionReason: expect.anything() }));
  });

  it("duplicado y solapamiento: se muestra el mensaje específico del backend", async () => {
    vi.mocked(noveltyApiService.create).mockRejectedValue(new ApiError('Ya existe una novedad "Trámite bancario" para el legajo 100 en la fecha seleccionada.', "NOVELTY_DUPLICATE", 409));
    renderModal([tramite]);
    await screen.findByText("Este tipo cubre 4 h por día según su configuración.");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    expect(await screen.findByText('Ya existe una novedad "Trámite bancario" para el legajo 100 en la fecha seleccionada.')).toBeInTheDocument();
  });

  it("un error sin mensaje apto muestra el genérico", async () => {
    vi.mocked(noveltyApiService.create).mockRejectedValue(new Error("TypeError: failed"));
    renderModal([tramite]);
    await screen.findByText("Este tipo cubre 4 h por día según su configuración.");
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    expect(await screen.findByText("No pudimos guardar la novedad. Revisá los datos e intentá nuevamente.")).toBeInTheDocument();
  });
});

describe("NoveltyModal — Etapa 15G.2 (precarga desde alerta)", () => {
  it("una cantidad sugerida va a la duración del tipo manual y la observación queda editable", async () => {
    renderModal([llegadaTarde], { initialFromDate: "2026-08-20", initialQuantityHours: 2, initialObservation: "Ingreso 10:00", suggestedNoveltyTypeCode: "LLT", contextNote: "Precargado desde una alerta." });

    expect(await screen.findByLabelText("Duración *")).toHaveValue("02:00");
    expect(screen.getByLabelText("Fecha *")).toHaveValue("2026-08-20");
    expect(screen.getByLabelText("Observación")).toHaveValue("Ingreso 10:00");
    expect(screen.getByText("Precargado desde una alerta.")).toBeInTheDocument();
  });

  it("funciona con un empleado mínimo (id/legajo/nombre/apellido)", async () => {
    const minimal = { id: "employee-9", legajo: "900", firstName: "Min", lastName: "Imo" } as Employee;
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([tramite]);
    render(<NoveltyModal employees={[minimal]} close={vi.fn()} saved={vi.fn()} initialFromDate="2026-11-16" />);

    expect(await screen.findByText(/900 · /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: ["employee-9"] })));
  });
});

describe("NoveltyModal — Etapa 15L.2B (filtro por allowedLoadRoles)", () => {
  it("un rol no-RRHH sólo ve los tipos que puede cargar", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    renderModal([
      buildNoveltyType({ id: "type-loadable", name: "Cargable", allowedLoadRoles: ["Nivel 2 - Supervisión / Gestión"] }),
      buildNoveltyType({ id: "type-not-loadable", name: "Solo RRHH", allowedLoadRoles: ["Nivel 1 - RRHH"] }),
    ]);
    await screen.findAllByText("Cargable");
    expect(screen.queryByText("Solo RRHH")).not.toBeInTheDocument();
  });

  it("RRHH ve todos los tipos activos sin importar allowedLoadRoles", async () => {
    renderModal([buildNoveltyType({ id: "type-rrhh-only", name: "Solo RRHH", allowedLoadRoles: [] })]);
    expect((await screen.findAllByText("Solo RRHH")).length).toBeGreaterThan(0);
  });

  it("si ningún tipo cargable, muestra un mensaje distinto al de catálogo vacío", async () => {
    authAs("Nivel 3 - Administrativo de Carga Horaria");
    renderModal([buildNoveltyType({ id: "type-rrhh-only", name: "Solo RRHH", allowedLoadRoles: ["Nivel 1 - RRHH"] })]);
    expect(await screen.findByText("Tu rol no tiene tipos de novedad habilitados para cargar.")).toBeInTheDocument();
  });
});

describe("NoveltyModal — límite de personas con documentación (ADR §15.1)", () => {
  const people = (count: number) => Array.from({ length: count }, (_, index) => buildEmployee({ id: `employee-${index + 1}`, legajo: String(100 + index) }));
  const conCertificado = buildNoveltyType({ id: "type-doc", name: "Con certificado", rules: { ...baseRules, requiresDocumentation: true } });

  it("26 personas con documentación: lo avisa enseguida, explica el motivo y no envía nada", async () => {
    renderModal([conCertificado], { employees: people(26) });
    await userEvent.upload(await screen.findByLabelText("Documentación *"), new File(["x"], "c.pdf", { type: "application/pdf" }));

    expect(screen.getByText("Con documentación podés cargar la novedad para hasta 25 personas por vez. Dividí la carga en grupos más pequeños.")).toBeInTheDocument();
    expect(screen.getByText(/se guarda una copia del archivo en el legajo de cada persona/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    expect(noveltyApiService.createWithDocument).not.toHaveBeenCalled();
  });

  it("25 personas con documentación: se envía", async () => {
    renderModal([conCertificado], { employees: people(25) });
    await userEvent.upload(await screen.findByLabelText("Documentación *"), new File(["x"], "c.pdf", { type: "application/pdf" }));
    expect(screen.queryByText(/Dividí la carga en grupos más pequeños/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.createWithDocument).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: people(25).map((item) => item.id) }), expect.any(File), null));
  });

  it("sin documentación, 26 personas siguen permitidas (máximo 250)", async () => {
    renderModal([vacaciones], { employees: people(26) });
    await screen.findByLabelText("Observación");
    expect(screen.queryByText(/personas por vez/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar novedad" }));
    await waitFor(() => expect(noveltyApiService.create).toHaveBeenCalledWith(expect.objectContaining({ employeeIds: people(26).map((item) => item.id) })));
  });
});
