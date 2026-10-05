import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { holidayWorkAssignmentController } from "./holidayWorkAssignment.controller";
import { holidayWorkAssignmentService } from "./holidayWorkAssignment.service";
import { clearWorkedTimeDerivedReadCaches } from "../time-entries/workedTimeReadCaches";

vi.mock("./holidayWorkAssignment.service", () => ({ holidayWorkAssignmentService: { save: vi.fn().mockResolvedValue([]) } }));
vi.mock("../time-entries/workedTimeReadCaches", () => ({ clearWorkedTimeDerivedReadCaches: vi.fn() }));

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §16: guardar la convocatoria
// de un feriado reinterpreta horas ya cargadas — grilla por legajo, Carga de
// horas/Por persona, dashboard y cierres se limpian en el momento.
describe("holidayWorkAssignmentController.save", () => {
  it("limpia las lecturas de horas después de guardar", async () => {
    const res = { json: vi.fn() } as unknown as Response;
    const req = { body: { date: "2026-10-05", assignments: [] }, user: { id: "user-1" }, ip: "127.0.0.1", get: vi.fn() } as unknown as Request;

    await holidayWorkAssignmentController.save(req, res);

    expect(holidayWorkAssignmentService.save).toHaveBeenCalled();
    expect(clearWorkedTimeDerivedReadCaches).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
  });
});
