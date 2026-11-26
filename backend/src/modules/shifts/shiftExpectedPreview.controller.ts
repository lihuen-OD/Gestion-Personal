import type { RequestHandler } from "express";
import type { ExpectedShiftPreviewQuery } from "./shiftExpectedPreview.schemas";
import { shiftExpectedPreviewService } from "./shiftExpectedPreview.service";
import { requestShiftGroupScope } from "./shiftGroupAccess";

export const shiftExpectedPreviewController = {
  preview: (async (req, res) => {
    const result = await shiftExpectedPreviewService.preview(req.query as unknown as ExpectedShiftPreviewQuery, req.user!, await requestShiftGroupScope(req));
    res.json(result);
  }) satisfies RequestHandler,
};
