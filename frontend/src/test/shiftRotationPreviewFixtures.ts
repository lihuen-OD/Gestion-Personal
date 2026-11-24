import type { PreviewBlock, PreviewCell, PreviewResponse, PreviewRow } from "../services/api/shiftRotationApiService";

/** Celdas de prueba con la forma real de `GET /shifts/expected` (R4.7). */
export function previewBlock(date: string, code: string, startTime: string, endTime: string, blockIndex = 0, source: PreviewBlock["source"] = "ROTATION"): PreviewBlock {
  const crossesMidnight = endTime <= startTime;
  const start = new Date(`${date}T${startTime}:00-03:00`);
  const end = new Date(`${date}T${endTime}:00-03:00`);
  if (crossesMidnight) end.setUTCDate(end.getUTCDate() + 1);
  return {
    operationalDate: date,
    blockIndex,
    source,
    template: { id: `t-${code}`, code, startTime, endTime, crossesMidnight },
    scheduledStartAt: start.toISOString(),
    scheduledEndAt: end.toISOString(),
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
  };
}

export function previewCell(date: string, overrides: Partial<PreviewCell> & { kind?: PreviewCell["planning"]["kind"]; blocks?: PreviewBlock[]; week?: string | null } = {}): PreviewCell {
  const { kind = "SHIFTS", blocks = [], week = "A", ...rest } = overrides;
  return {
    date,
    assignment: week === null ? null : { membershipId: "m1", effectiveFrom: "2026-11-25", effectiveTo: null, crew: { id: "c1", code: "JOSE", name: "José" }, version: { id: "v1", effectiveFrom: "2026-11-24", effectiveTo: null }, cycleWeekIndex: week === "B" ? 1 : 0, cycleWeekLabel: week },
    planning: { kind, reason: kind === "MISSING" ? "NO_DAY_ROW" : kind === "CONFLICT" ? "OVERLAPPING_BLOCKS" : null, detail: kind === "CONFLICT" ? ["block:3f1c2a4b-1111#0", "block:3f1c2a4b-1111#1"] : [], origin: null, blocks },
    effective: {
      obligation: blocks.length ? "SHIFT" : kind === "MISSING" || kind === "CONFLICT" ? "UNRESOLVED" : "NO_OBLIGATION",
      source: kind === "FIXED_ASSIGNMENT" ? "FIXED_ASSIGNMENT" : kind === "NONE" ? "NONE" : "ROTATION",
      reason: kind === "REST" ? "ROTATION_REST_DAY" : kind === "MISSING" ? "ROTATION_DAY_MISSING" : kind === "CONFLICT" ? "ROTATION_CONFIG_CONFLICT" : null,
      blocks,
    },
    expectedWorkday: { obligation: blocks.length ? "WORKDAY" : "NO_WORK_OBLIGATION", unresolvedReason: null, expectedMinutes: blocks.reduce((sum, block) => sum + block.durationMinutes, 0), isHoliday: false, convoked: false, source: "SHIFT_ROTATION" },
    facts: { dayOff: false, holidayScope: null, convoked: false, regimeKind: "TURNO_OBLIGATORIO" },
    transitionFromPrevious: null,
    warnings: [],
    ...rest,
  };
}

export function previewRow(id: string, lastName: string, firstName: string, legajo: string, days: PreviewCell[], status = "ACTIVO"): PreviewRow {
  return { employee: { id, legajo, firstName, lastName, status }, days };
}

export function previewResponse(rows: PreviewRow[], { from, days, inactive = true, total = rows.length, page = 1 }: { from: string; days: number; inactive?: boolean; total?: number; page?: number }): PreviewResponse {
  const to = new Date(`${from}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() + days - 1);
  return {
    data: rows,
    context: {
      rotation: { id: "rot-1", code: "PLANTA-REAL", name: "Planta" },
      range: { from, to: to.toISOString().slice(0, 10), days },
      persistedStatus: inactive ? "INACTIVO" : "ACTIVO",
      readOnly: true,
      previewMode: inactive ? "HYPOTHETICAL_INACTIVE" : "CURRENT_CONFIGURATION",
      affectsRealObligations: false,
    },
    meta: { total, page, pageSize: 25, hasMore: page * 25 < total },
  };
}
