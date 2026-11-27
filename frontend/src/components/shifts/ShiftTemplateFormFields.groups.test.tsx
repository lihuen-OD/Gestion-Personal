import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { emptyShiftTemplate, ShiftTemplateFormFields, shiftTemplateFormToInput, shiftTemplateToFormValue, type ShiftTemplateFormValue } from "./ShiftTemplateFormFields";
import { shiftGroupSelectOptions } from "../../utils/shiftGroups";
import type { ShiftGroup } from "../../services/api/shiftGroupApiService";
import type { ShiftTemplate } from "../../services/api/workforceApiService";

const PLANTA: ShiftGroup = { id: "g-pl", code: "PLANTA", name: "Planta", sortOrder: 20, status: "ACTIVO", templateCount: 1, createdAt: "", updatedAt: "" };
const OFICINA: ShiftGroup = { id: "g-of", code: "OFICINA", name: "Oficina", sortOrder: 10, status: "ACTIVO", templateCount: 0, createdAt: "", updatedAt: "" };
const TALLER: ShiftGroup = { id: "g-ta", code: "TALLER", name: "Taller", sortOrder: 5, status: "INACTIVO", templateCount: 1, createdAt: "", updatedAt: "" };

function Harness({ initial, current, onValue }: { initial: ShiftTemplateFormValue; current: ShiftGroup | null; onValue: (value: ShiftTemplateFormValue) => void }) {
  const [value, setValue] = useState(initial);
  return <ShiftTemplateFormFields value={value} onChange={(next) => { setValue(next); onValue(next); }} groupField={{ options: shiftGroupSelectOptions([PLANTA, OFICINA, TALLER], current) }} />;
}

const templateWithGroup = (group: ShiftGroup | null): ShiftTemplate => ({
  id: "t1", code: "PL-01", name: "Planta 01", categoryName: "Planta", shiftGroupId: group?.id ?? null, shiftGroup: group,
  startTime: "07:00", endTime: "17:00", crossesMidnight: false, entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10,
  exitToleranceBeforeMinutes: 10, exitToleranceAfterMinutes: 10, absoluteOpenShiftLimitMinutes: 1200, status: "ACTIVO",
});

describe("selector Grupo del formulario de turno", () => {
  it("alta: «Sin grupo» por defecto + grupos activos ordenados (sin inactivos); null al enviar", () => {
    const onValue = vi.fn();
    render(<Harness initial={emptyShiftTemplate()} current={null} onValue={onValue} />);
    const select = screen.getByLabelText("Grupo (lugar)");
    expect(select).toHaveValue("");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Sin grupo", "Oficina", "Planta"]);
    expect(shiftTemplateFormToInput(emptyShiftTemplate()).shiftGroupId).toBeNull();
  });

  it("elegir un grupo y volver a «Sin grupo» (desasignar) sin tocar la categoría", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={shiftTemplateToFormValue(templateWithGroup(null))} current={null} onValue={onValue} />);
    await user.selectOptions(screen.getByLabelText("Grupo (lugar)"), "g-pl");
    expect(shiftTemplateFormToInput(onValue.mock.lastCall![0])).toMatchObject({ shiftGroupId: "g-pl", categoryName: "Planta" });
    await user.selectOptions(screen.getByLabelText("Grupo (lugar)"), "");
    expect(shiftTemplateFormToInput(onValue.mock.lastCall![0])).toMatchObject({ shiftGroupId: null, categoryName: "Planta" });
  });

  it("edición con grupo inactivo: se muestra como actual y se puede conservar, pero no es destino para otros", () => {
    render(<Harness initial={shiftTemplateToFormValue(templateWithGroup(TALLER))} current={TALLER} onValue={vi.fn()} />);
    const select = screen.getByLabelText("Grupo (lugar)");
    expect(select).toHaveValue("g-ta");
    expect(within(select).getByRole("option", { name: "Taller (inactivo)" })).toBeInTheDocument();
    expect(shiftTemplateFormToInput(shiftTemplateToFormValue(templateWithGroup(TALLER))).shiftGroupId).toBe("g-ta");
    render(<Harness initial={emptyShiftTemplate()} current={null} onValue={vi.fn()} />);
    expect(within(screen.getAllByLabelText("Grupo (lugar)")[1]!).queryByRole("option", { name: /Taller/ })).not.toBeInTheDocument();
  });

  it("la ayuda de categoría y grupo no forma parte del nombre accesible del control", () => {
    render(<ShiftTemplateFormFields value={emptyShiftTemplate()} onChange={vi.fn()} groupField={{ options: [{ value: "", label: "Sin grupo" }], unavailableMessage: "No pudimos cargar los grupos." }} />);
    expect(screen.getByLabelText("Grupo (lugar)")).toHaveAccessibleDescription("No pudimos cargar los grupos.");
    expect(screen.getByLabelText("Categoría / tipo")).toHaveAccessibleDescription("Función del turno. El lugar se elige en Grupo.");
  });
});
