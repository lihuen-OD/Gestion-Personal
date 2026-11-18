import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "./types";
import { App } from "./App";

// Acceso por nivel probado contra el router real de App con URL manual (no
// sólo el sidebar). Las páginas se reemplazan por stubs: acá sólo importa a
// qué pantalla llega cada nivel, no su contenido.
const auth = vi.hoisted(() => ({ role: "Nivel 1 - RRHH" as string }));
vi.mock("./context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Ana Prueba", email: "ana@example.com", role: auth.role }, login: vi.fn(), logout: vi.fn() }),
}));
vi.mock("./app/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const stub = (name: string) => () => <h1>{name}</h1>;
vi.mock("./pages/DashboardPage", () => ({ DashboardPage: stub("Dashboard") }));
vi.mock("./pages/PuestosPage", () => ({ PuestosPage: stub("Puestos") }));
vi.mock("./pages/PuestoCreatePage", () => ({ PuestoCreatePage: stub("Crear puesto") }));
vi.mock("./pages/PuestoDetailPage", () => ({ PuestoDetailPage: stub("Detalle de puesto") }));
vi.mock("./pages/OrganigramasPage", () => ({ OrganigramasPage: stub("Organigramas") }));
vi.mock("./pages/ReportsPage", () => ({ ReportsPage: stub("Reportes") }));
vi.mock("./pages/AttendancePage", () => ({ AttendancePage: stub("Asistencia") }));
vi.mock("./pages/ShiftAlertsPage", () => ({ ShiftAlertsPage: stub("Alertas de turnos") }));
vi.mock("./pages/HoursPage", () => ({ HoursPage: ({ pendingOnly }: { pendingOnly?: boolean }) => <h1>{pendingOnly ? "Bandeja de revisión" : "Carga de horas"}</h1> }));
vi.mock("./pages/MonthlyClosuresPage", () => ({ MonthlyClosuresPage: stub("Cierres mensuales") }));
vi.mock("./pages/NoveltiesPage", () => ({ NoveltiesPage: stub("Novedades") }));
vi.mock("./pages/NotificationsPage", () => ({ NotificationsPage: stub("Notificaciones") }));
vi.mock("./pages/EmployeesPage", () => ({ EmployeesPage: stub("Legajos") }));
vi.mock("./pages/EmployeeDetailPage", () => ({ EmployeeDetailPage: stub("Detalle de legajo") }));

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

async function open(role: Role, url: string) {
  auth.role = role;
  render(<MemoryRouter initialEntries={[url]}><App /><CurrentPath /></MemoryRouter>);
  return screen.findByRole("heading", { level: 1 });
}

const LEVEL_1: Role = "Nivel 1 - RRHH";
const LEVEL_2: Role = "Nivel 2 - Supervisión / Gestión";
const LEVEL_3: Role = "Nivel 3 - Administrativo de Carga Horaria";

beforeEach(() => {
  auth.role = LEVEL_1;
});

describe("App — Nivel 1 conserva Dashboard, Puestos, Organigramas y Reportes", () => {
  it.each([
    ["/", "Dashboard"],
    ["/puestos", "Puestos"],
    ["/puestos/nuevo", "Crear puesto"],
    ["/puestos/pos-1", "Detalle de puesto"],
    ["/organigramas", "Organigramas"],
    ["/reportes", "Reportes"],
    ["/asistencia", "Asistencia"],
    ["/pendientes", "Bandeja de revisión"],
  ])("%s abre %s", async (url, heading) => {
    expect(await open(LEVEL_1, url)).toHaveTextContent(heading);
    expect(screen.getByTestId("path")).toHaveTextContent(url);
  });

  it("/gestion-horaria (Inicio retirado) redirige a Asistencia", async () => {
    expect(await open(LEVEL_1, "/gestion-horaria")).toHaveTextContent("Asistencia");
    expect(screen.getByTestId("path")).toHaveTextContent("/asistencia");
  });
});

describe("App — Nivel 2 no entra a Dashboard, Puestos, Organigramas ni Reportes por URL manual", () => {
  it.each(["/", "/gestion-horaria", "/puestos", "/puestos/nuevo", "/puestos/pos-1", "/organigramas", "/reportes"])("%s redirige a /asistencia", async (url) => {
    expect(await open(LEVEL_2, url)).toHaveTextContent("Asistencia");
    expect(screen.getByTestId("path")).toHaveTextContent("/asistencia");
  });

  it.each([
    ["/legajos", "Legajos"],
    ["/legajos/emp-1", "Detalle de legajo"],
    ["/horas", "Carga de horas"],
    ["/pendientes", "Bandeja de revisión"],
    ["/novedades", "Novedades"],
  ])("conserva %s", async (url, heading) => {
    expect(await open(LEVEL_2, url)).toHaveTextContent(heading);
    expect(screen.getByTestId("path")).toHaveTextContent(url);
  });
});

describe("App — Nivel 3 mantiene sus rutas horarias y pierde sólo Inicio", () => {
  it.each(["/", "/gestion-horaria", "/legajos", "/puestos", "/puestos/pos-1", "/organigramas", "/reportes", "/pendientes"])("%s redirige a /asistencia", async (url) => {
    expect(await open(LEVEL_3, url)).toHaveTextContent("Asistencia");
    expect(screen.getByTestId("path")).toHaveTextContent("/asistencia");
  });

  it.each([
    ["/asistencia", "Asistencia"],
    ["/asistencia/alertas", "Alertas de turnos"],
    ["/horas", "Carga de horas"],
    ["/cierres", "Cierres mensuales"],
    ["/novedades", "Novedades"],
    ["/notificaciones", "Notificaciones"],
  ])("conserva %s", async (url, heading) => {
    expect(await open(LEVEL_3, url)).toHaveTextContent(heading);
    expect(screen.getByTestId("path")).toHaveTextContent(url);
  });
});
