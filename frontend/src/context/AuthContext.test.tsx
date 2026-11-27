import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";
import { authApiService } from "../services/api/authApiService";
import { tokenStorage } from "../services/api/apiClient";

vi.mock("../services/api/authApiService", () => ({ authApiService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() } }));
vi.mock("../services/cache", () => ({ clearAllAppCaches: vi.fn() }));

const stefi = { id: "u-stefi", name: "Stefi", email: "stefi@test.com", password: "", role: "Nivel 2 - Supervisión / Gestión" as const, status: "Activo" as const, shiftGroupAccess: { all: false, groupIds: ["g-planta"] } };

function Probe() {
  const { user, refreshShiftGroupAccess } = useAuth();
  return (
    <>
      <p>grupos: {user?.shiftGroupAccess?.groupIds.join(",") || "ninguno"}</p>
      <button onClick={() => void refreshShiftGroupAccess()}>refrescar</button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  tokenStorage.set("token");
  sessionStorage.setItem("losod_user", JSON.stringify(stefi));
});

describe("AuthContext — alcance por grupo de turnos (R8)", () => {
  it("una revocación hecha por RRHH se refleja al refrescar, sin volver a iniciar sesión", async () => {
    vi.mocked(authApiService.me).mockResolvedValue({ ...stefi, shiftGroupAccess: { all: false, groupIds: [] } });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText("grupos: g-planta")).toBeInTheDocument();
    await act(async () => screen.getByRole("button", { name: "refrescar" }).click());
    expect(screen.getByText("grupos: ninguno")).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("losod_user")!).shiftGroupAccess).toEqual({ all: false, groupIds: [] });
  });

  it("si /auth/me falla, conserva lo conocido (el backend sigue decidiendo)", async () => {
    vi.mocked(authApiService.me).mockRejectedValue(new Error("offline"));
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => screen.getByRole("button", { name: "refrescar" }).click());
    expect(screen.getByText("grupos: g-planta")).toBeInTheDocument();
  });

  it("no mezcla la respuesta de otra cuenta", async () => {
    vi.mocked(authApiService.me).mockResolvedValue({ ...stefi, id: "otra", shiftGroupAccess: { all: false, groupIds: ["g-taller"] } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => screen.getByRole("button", { name: "refrescar" }).click());
    expect(screen.getByText("grupos: g-planta")).toBeInTheDocument();
  });
});
