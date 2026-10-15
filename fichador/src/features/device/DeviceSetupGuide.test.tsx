import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeviceInstallHint, DeviceSetupChecklist } from "./DeviceSetupGuide";
import { isIOSDevice, isStandaloneMode } from "../../pwa/platform";
import { useInstallPrompt } from "../../pwa/installPrompt";

// F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29).
vi.mock("../../pwa/platform", () => ({ isIOSDevice: vi.fn(), isStandaloneMode: vi.fn() }));
vi.mock("../../pwa/installPrompt", () => ({ useInstallPrompt: vi.fn() }));

const prompt = vi.fn();
function setup({ ios = false, standalone = false, installAvailable = false } = {}) {
  vi.mocked(isIOSDevice).mockReturnValue(ios);
  vi.mocked(isStandaloneMode).mockReturnValue(standalone);
  vi.mocked(useInstallPrompt).mockReturnValue({ available: installAvailable, prompt });
}
const TECHNICAL = /PWA|standalone|Wake ?Lock|service worker|IndexedDB|navigator|beforeinstallprompt/i;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeviceInstallHint — configuración inicial", () => {
  it("iPad/iPhone en el navegador: pasos para agregar a la pantalla de inicio y aviso del orden", () => {
    setup({ ios: true });
    render(<DeviceInstallHint stage="setup" />);
    expect(screen.getByText("Instalá el fichador en este equipo")).toBeInTheDocument();
    expect(screen.getByText(/Compartir/)).toBeInTheDocument();
    expect(screen.getByText("“Agregar a pantalla de inicio”")).toBeInTheDocument();
    expect(screen.getByText("Abrí el fichador desde el nuevo ícono.")).toBeInTheDocument();
    expect(screen.getByText("Lo que se configura en el navegador no pasa al ícono instalado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Instalar en este equipo/ })).not.toBeInTheDocument();
  });

  it("abierto desde el ícono instalado: no repite cómo instalar", () => {
    setup({ ios: true, standalone: true });
    render(<DeviceInstallHint stage="setup" />);
    expect(screen.getByText("Fichador instalado en este equipo")).toBeInTheDocument();
    expect(screen.queryByText(/Agregar a pantalla de inicio/)).not.toBeInTheDocument();
  });

  it("escritorio sin aviso del navegador: indicación genérica, nunca los pasos de iOS", () => {
    setup();
    render(<DeviceInstallHint stage="setup" />);
    expect(screen.getByText(/Desde el menú del navegador/)).toBeInTheDocument();
    expect(screen.queryByText(/Compartir/)).not.toBeInTheDocument();
  });

  it("navegador con aviso de instalación propio: ofrece instalar en un toque", () => {
    setup({ installAvailable: true });
    render(<DeviceInstallHint stage="setup" />);
    fireEvent.click(screen.getByRole("button", { name: /Instalar en este equipo/ }));
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("nunca muestra términos técnicos", () => {
    for (const options of [{ ios: true }, { ios: true, standalone: true }, {}, { installAvailable: true }]) {
      setup(options);
      const { container, unmount } = render(<><DeviceInstallHint stage="setup" /><DeviceSetupChecklist /></>);
      expect(container.textContent).not.toMatch(TECHNICAL);
      unmount();
    }
  });
});

describe("DeviceInstallHint — esperando aprobación", () => {
  it("iOS configurado desde el navegador: avisa que al instalar habrá que configurarlo de nuevo", () => {
    setup({ ios: true });
    render(<DeviceInstallHint stage="pending" />);
    expect(screen.getByText("Este equipo se está configurando desde el navegador")).toBeInTheDocument();
  });

  it.each([
    ["iOS ya instalado", { ios: true, standalone: true }],
    ["escritorio/Android (el ícono comparte la configuración del navegador)", {}],
  ])("%s: sin aviso", (_label, options) => {
    setup(options);
    const { container } = render(<DeviceInstallHint stage="pending" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DeviceSetupChecklist", () => {
  it("explica el Acceso guiado como ayuda de uso, sin prometer que la app lo active ni que sea seguridad", () => {
    setup();
    render(<DeviceSetupChecklist />);
    expect(screen.getByText("Cómo dejar este equipo listo")).toBeInTheDocument();
    const guided = screen.getByText(/Acceso guiado/).closest("li")!;
    expect(guided.textContent).toContain("podés activar");
    expect(guided.textContent).toContain("no reemplaza la aprobación de RRHH");
    expect(screen.getByText(/conectado a la corriente/)).toBeInTheDocument();
  });
});
