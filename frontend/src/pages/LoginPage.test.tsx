import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  profiles: [] as Array<{ role: "Nivel 1 - RRHH"; email: string; password: string }>,
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
});
