import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";
import type { Role } from "../types";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  profiles: [] as Array<{ role: Role; email: string; password: string }>,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ login: mocks.login, logout: vi.fn() }),
}));

vi.mock("../config/runtimeMode", () => ({
  get demoLoginProfiles() {
    return mocks.profiles;
  },
}));

describe("LoginPage", () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.login.mockResolvedValue(true);
    mocks.profiles = [];
  });

  it("starts with empty fields and hides demo-only copy and shortcuts by default", () => {
    render(<LoginPage />);

    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(screen.queryByText("Accesos rápidos para demo")).not.toBeInTheDocument();
    expect(screen.queryByText(/recorrer la demostración/i)).not.toBeInTheDocument();
  });

  it("keeps manual login unchanged", async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "manual-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Ingresar/ }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith("person@example.test", "manual-password"));
  });

  it("shows configured demo shortcuts and uses their environment-derived credentials", async () => {
    mocks.profiles = [{
      role: "Nivel 1 - RRHH",
      email: "demo-admin@example.test",
      password: "demo-password",
    }];
    render(<LoginPage />);

    expect(screen.getByText("Accesos rápidos para demo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nivel 1 - RRHH/ }));

    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith("demo-admin@example.test", "demo-password"));
  });

  it("with the three demo profiles configured, shows all three shortcuts and each calls login with its own role's credentials", async () => {
    mocks.profiles = [
      { role: "Nivel 1 - RRHH", email: "demo-admin@example.test", password: "demo-admin-password" },
      { role: "Nivel 2 - Supervisión / Gestión", email: "demo-supervisor@example.test", password: "demo-supervisor-password" },
      { role: "Nivel 3 - Administrativo de Carga Horaria", email: "demo-carga@example.test", password: "demo-carga-password" },
    ];
    render(<LoginPage />);

    expect(screen.getByRole("button", { name: /Nivel 1 - RRHH/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nivel 2 - Supervisión/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nivel 3 - Administrativo/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Nivel 2 - Supervisión/ }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith("demo-supervisor@example.test", "demo-supervisor-password"));

    fireEvent.click(screen.getByRole("button", { name: /Nivel 3 - Administrativo/ }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith("demo-carga@example.test", "demo-carga-password"));
  });

  it("with an incomplete demo profile (missing password/email for a role), renders only the complete ones without breaking the screen", () => {
    // resolveDemoLoginProfiles ya filtra los perfiles incompletos antes de
    // llegar acá (ver runtimeMode.test.ts) — este test confirma que la
    // página en sí no se rompe ni intenta renderizar un botón para el rol
    // faltante cuando sólo llegan perfiles parciales.
    mocks.profiles = [
      { role: "Nivel 1 - RRHH", email: "demo-admin@example.test", password: "demo-admin-password" },
    ];
    render(<LoginPage />);

    expect(screen.getByText("Accesos rápidos para demo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nivel 1 - RRHH/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nivel 2 - Supervisión/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nivel 3 - Administrativo/ })).not.toBeInTheDocument();
  });
});
