import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noveltyApiService, type NoveltyCoveragePreview, type NoveltyCoveragePreviewInput } from "../../services/api/noveltyApiService";
import { useNoveltyCoveragePreview } from "./useNoveltyCoveragePreview";

vi.mock("../../services/api/noveltyApiService", () => ({ noveltyApiService: { previewCoverage: vi.fn() } }));

const input = (employeeId: string): NoveltyCoveragePreviewInput => ({ employeeIds: [employeeId], noveltyTypeId: "type", fromDate: "2026-11-16", toDate: null, quantityHours: null });
const previewFor = (name: string) => ({ noveltyType: { id: "type", code: "T", name }, initialStatus: "APROBADO", employees: [] }) as NoveltyCoveragePreview;

beforeEach(() => vi.clearAllMocks());

describe("useNoveltyCoveragePreview", () => {
  it("sin datos suficientes no pide nada", () => {
    const { result } = renderHook(() => useNoveltyCoveragePreview(null, 0));
    expect(result.current.state).toEqual({ status: "idle" });
    expect(noveltyApiService.previewCoverage).not.toHaveBeenCalled();
  });

  it("al cambiar de empleado vuelve a pedir y nunca muestra la respuesta vieja", async () => {
    const pending: Record<string, (value: NoveltyCoveragePreview) => void> = {};
    vi.mocked(noveltyApiService.previewCoverage).mockImplementation((request) => new Promise((resolve) => { pending[request.employeeIds[0]!] = resolve; }));
    const { result, rerender } = renderHook(({ value }) => useNoveltyCoveragePreview(value, 0), { initialProps: { value: input("a") } });
    await waitFor(() => expect(pending.a).toBeDefined());

    rerender({ value: input("b") });
    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(pending.b).toBeDefined());
    // Llega primero la respuesta nueva y después la vieja: gana la nueva.
    await act(async () => pending.b!(previewFor("B")));
    await act(async () => pending.a!(previewFor("A")));

    expect(result.current.state).toMatchObject({ status: "success", data: { noveltyType: { name: "B" } } });
    expect(vi.mocked(noveltyApiService.previewCoverage).mock.calls.map(([request]) => request.employeeIds[0])).toEqual(["a", "b"]);
    // El pedido anterior se canceló.
    expect((vi.mocked(noveltyApiService.previewCoverage).mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
  });

  it("agrupa los cambios rápidos posteriores (debounce): nunca pide por un valor intermedio", async () => {
    vi.mocked(noveltyApiService.previewCoverage).mockResolvedValue(previewFor("ok"));
    const { rerender } = renderHook(({ value }) => useNoveltyCoveragePreview(value, 50), { initialProps: { value: input("a") } });
    rerender({ value: input("b") });
    rerender({ value: input("c") });
    await waitFor(() => expect(noveltyApiService.previewCoverage).toHaveBeenLastCalledWith(input("c"), expect.anything()));
    expect(vi.mocked(noveltyApiService.previewCoverage).mock.calls.map(([request]) => request.employeeIds[0])).not.toContain("b");
  });
});
