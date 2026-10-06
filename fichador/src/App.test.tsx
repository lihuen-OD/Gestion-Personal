import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App, isKioskPath } from "./App";

vi.mock("./pages/TimeClockPage", () => ({ TimeClockPage: () => <h1>Fichador de personal</h1> }));

// F1 — el fichador standalone no tiene rutas administrativas: escribirlas a
// mano muestra el 404 propio, nunca una pantalla del admin.
describe("App — rutas del fichador standalone", () => {
  it("/ muestra el fichador", () => {
    render(<App pathname="/" />);
    expect(screen.getByRole("heading", { name: "Fichador de personal" })).toBeInTheDocument();
  });

  it.each(["/legajos", "/configuracion", "/usuarios", "/auditoria", "/fichador", "/horas", "/cierres", "/legajos/123"])(
    "%s no es una ruta válida: muestra el 404 propio con vuelta al fichador",
    (pathname) => {
      render(<App pathname={pathname} />);
      expect(screen.getByRole("heading", { name: "Página no encontrada" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ir al fichador" })).toHaveAttribute("href", "/");
      expect(screen.queryByRole("heading", { name: "Fichador de personal" })).not.toBeInTheDocument();
    },
  );

  it("sólo / (e /index.html) son rutas del kiosco", () => {
    expect(isKioskPath("/")).toBe(true);
    expect(isKioskPath("/index.html")).toBe(true);
    expect(isKioskPath("/configuracion")).toBe(false);
  });
});
