import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Tabs, tabPanelProps } from "./Tabs";

const TABS = [
  { key: "a", label: "Primera" },
  { key: "b", label: "Segunda" },
  { key: "c", label: "Tercera" },
];

function Harness({ onChange }: { onChange?: (key: string) => void }) {
  const [active, setActive] = useState("a");
  return (
    <>
      <Tabs tabs={TABS} active={active} ariaLabel="Secciones" idBase="demo" onChange={(key) => { setActive(key); onChange?.(key); }} />
      <div {...tabPanelProps("demo", active)}>Contenido {active}</div>
    </>
  );
}

describe("Tabs (semántica WAI-ARIA)", () => {
  it("expone tablist, tabs con aria-selected y el panel vinculado", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Secciones" })).toBeInTheDocument();
    const first = screen.getByRole("tab", { name: "Primera" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveClass("active");
    expect(screen.getByRole("tab", { name: "Segunda" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Primera" })).toHaveTextContent("Contenido a");
    expect(first).toHaveAttribute("aria-controls", "demo-panel-a");
  });

  it("sólo la pestaña activa está en el orden de tabulación", () => {
    render(<Harness />);
    expect(screen.getAllByRole("tab").map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it("flechas, Inicio y Fin mueven el foco y activan la pestaña (con vuelta circular)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("tab", { name: "Primera" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Segunda" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Segunda" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Tercera" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Primera" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Tercera" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Primera" })).toHaveFocus();
    expect(onChange.mock.calls.map(([key]) => key)).toEqual(["b", "c", "a", "c", "a"]);
  });

  it("el clic sigue funcionando y no exige idBase", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="a" onChange={onChange} />);
    await user.click(screen.getByRole("tab", { name: "Tercera" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.getByRole("tab", { name: "Primera" })).not.toHaveAttribute("aria-controls");
  });
});
