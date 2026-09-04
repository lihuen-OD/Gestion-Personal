import { describe, expect, it, vi } from "vitest";
import { mapTimeEntryFromApi, timeEntryApiService } from "./timeEntryApiService";
import type { TimeEntry } from "../../types";

// Etapa 11B: la Bandeja de revisión (HoursPage.tsx, vista "Por registro")
// perdía appliedMultiplier al mapear la respuesta cruda del backend al tipo
// TimeEntry del frontend — el backend ya lo devolvía (escalar de TimeEntry,
// sin select restrictivo en el listado plano), pero mapTimeEntryFromApi
// nunca lo leía. Estos tests cubren el mapeo nuevo, sin tocar `isSpecial`
// (Conceptos Horarios, dominio distinto — ver 8A/11A).
describe("mapTimeEntryFromApi — Horas Especiales en la Bandeja de revisión (Etapa 11B)", () => {
  const base = {
    id: "entry-1",
    employeeId: "employee-1",
    hourConceptId: "concept-normal",
    date: "2026-08-27",
    hours: "8",
    status: "EN_REVISION" as const,
  };

  it("appliedMultiplier=1 (o ausente): no agrega ningún campo de Hora Especial", () => {
    const entry = mapTimeEntryFromApi({ ...base, appliedMultiplier: 1 });
    expect(entry.specialHourMultiplier).toBeUndefined();
    expect(entry.specialHourLiquidableHours).toBeUndefined();
    expect(entry.specialHourRuleNames).toBeUndefined();

    const entryWithoutField = mapTimeEntryFromApi({ ...base });
    expect(entryWithoutField.specialHourMultiplier).toBeUndefined();
  });

  it("appliedMultiplier > 1 con timeSegment (fichador): mapea multiplicador, liquidable y regla(s)", () => {
    const entry = mapTimeEntryFromApi({
      ...base,
      appliedMultiplier: 2,
      timeSegment: { specialHourRuleApplications: [{ wasConflicting: false, doubleHourRule: { name: "Feriado" } }] },
    });

    expect(entry.specialHourMultiplier).toBe(2);
    expect(entry.specialHourLiquidableHours).toBe(16); // 8 real x2
    expect(entry.specialHourRuleNames).toEqual(["Feriado"]);
    expect(entry.specialHourConflict).toBe(false);
  });

  it("appliedMultiplier > 1 sin timeSegment (carga manual): mapea multiplicador/liquidable, sin nombre de regla", () => {
    const entry = mapTimeEntryFromApi({ ...base, appliedMultiplier: 2, timeSegment: null });

    expect(entry.specialHourMultiplier).toBe(2);
    expect(entry.specialHourLiquidableHours).toBe(16);
    expect(entry.specialHourRuleNames).toEqual([]);
  });

  it("conflicto de prioridad (empate): specialHourConflict=true", () => {
    const entry = mapTimeEntryFromApi({
      ...base,
      appliedMultiplier: 2.5,
      timeSegment: {
        specialHourRuleApplications: [
          { wasConflicting: true, doubleHourRule: { name: "Domingo Odwyer" } },
          { wasConflicting: true, doubleHourRule: { name: "Domingo Pañol" } },
        ],
      },
    });

    expect(entry.specialHourConflict).toBe(true);
    expect(entry.specialHourRuleNames).toEqual(["Domingo Odwyer", "Domingo Pañol"]);
  });

  it("isSpecial (Conceptos Horarios) no se toca ni se confunde con specialHourMultiplier (Horas Especiales)", () => {
    const entry = mapTimeEntryFromApi({
      ...base,
      appliedMultiplier: 2,
      hourConcept: { id: "concept-normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO" },
    });

    expect(entry.isSpecial).toBe(false); // kind === "NORMAL" -> Concepto Horario base, no especial
    expect(entry.specialHourMultiplier).toBe(2); // Hora Especial sigue aplicando igual, dominio independiente
  });
});

// Etapa 14C.2 (ampliada): guardado manual en Carga Horaria — save() hacía un
// GET redundante (getByEmployee) para decidir create-vs-update aunque el
// llamador (EmployeeHoursPage, ya con la grilla completa cargada en estado
// local) ya sabía la respuesta. knownExistingId permite saltear ese GET sin
// cambiar el resultado final (mismo create/update, mismo submit posterior).
describe("timeEntryApiService.save — knownExistingId evita el GET redundante (Etapa 14C.2 ampliada)", () => {
  const payload = {
    employeeId: "employee-1",
    period: "2026-08",
    day: 5,
    type: "Hora normal",
    hours: 8,
    notes: "",
    status: "Aprobado",
    conceptId: "concept-normal",
    isSpecial: false,
    origin: "MANUAL",
  } as unknown as Omit<TimeEntry, "id">;

  it("con knownExistingId (string): llama a update con ese id y NO consulta getByEmployee", async () => {
    const getByEmployeeSpy = vi.spyOn(timeEntryApiService, "getByEmployee");
    const updateSpy = vi
      .spyOn(timeEntryApiService, "update")
      .mockResolvedValue({ id: "entry-existing", status: "Aprobado" } as TimeEntry);
    const createSpy = vi.spyOn(timeEntryApiService, "create");

    const result = await timeEntryApiService.save(payload, { knownExistingId: "entry-existing" });

    expect(getByEmployeeSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith("entry-existing", payload);
    expect(createSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "entry-existing", status: "Aprobado" });

    getByEmployeeSpy.mockRestore();
    updateSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("con knownExistingId: null (sabido que no existe): llama a create y NO consulta getByEmployee", async () => {
    const getByEmployeeSpy = vi.spyOn(timeEntryApiService, "getByEmployee");
    const createSpy = vi
      .spyOn(timeEntryApiService, "create")
      .mockResolvedValue({ id: "entry-new", status: "Aprobado" } as TimeEntry);
    const updateSpy = vi.spyOn(timeEntryApiService, "update");

    const result = await timeEntryApiService.save(payload, { knownExistingId: null });

    expect(getByEmployeeSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledWith(payload);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "entry-new", status: "Aprobado" });

    getByEmployeeSpy.mockRestore();
    createSpy.mockRestore();
    updateSpy.mockRestore();
  });

  it("sin options (compatibilidad hacia atrás): sigue consultando getByEmployee para decidir create/update", async () => {
    const getByEmployeeSpy = vi
      .spyOn(timeEntryApiService, "getByEmployee")
      .mockResolvedValue([{ id: "entry-found", day: 5, conceptId: "concept-normal", type: "Hora normal" } as TimeEntry]);
    const updateSpy = vi
      .spyOn(timeEntryApiService, "update")
      .mockResolvedValue({ id: "entry-found", status: "Aprobado" } as TimeEntry);
    const createSpy = vi.spyOn(timeEntryApiService, "create");

    const result = await timeEntryApiService.save(payload);

    expect(getByEmployeeSpy).toHaveBeenCalledWith("employee-1", "2026-08");
    expect(updateSpy).toHaveBeenCalledWith("entry-found", payload);
    expect(createSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "entry-found", status: "Aprobado" });

    getByEmployeeSpy.mockRestore();
    updateSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("status 'En revisión' con resultado que aún no quedó en revisión: sigue disparando submit()", async () => {
    const updateSpy = vi
      .spyOn(timeEntryApiService, "update")
      .mockResolvedValue({ id: "entry-existing", status: "Aprobado" } as TimeEntry);
    const submitSpy = vi
      .spyOn(timeEntryApiService, "submit")
      .mockResolvedValue({ id: "entry-existing", status: "En revisión" } as TimeEntry);

    const result = await timeEntryApiService.save(
      { ...payload, status: "En revisión" },
      { knownExistingId: "entry-existing" },
    );

    expect(submitSpy).toHaveBeenCalledWith("entry-existing");
    expect(result).toEqual({ id: "entry-existing", status: "En revisión" });

    updateSpy.mockRestore();
    submitSpy.mockRestore();
  });
});
