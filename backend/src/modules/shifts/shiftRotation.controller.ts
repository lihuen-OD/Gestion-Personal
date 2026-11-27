import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListMembersQuery, ListRotationsQuery } from "./shiftRotation.schemas";
import { shiftRotationService } from "./shiftRotation.service";
import { requestShiftGroupScope } from "./shiftGroupAccess";
import { requestShiftActor } from "./shiftWriteAccess";
import { shiftRotationMembershipService } from "./shiftRotationMembership.service";
import { shiftRotationVersionService } from "./shiftRotationVersion.service";
import { clearNoveltyCoverageReadCaches } from "../novelties/noveltyCoverageReadCaches";
import { clearShiftTemplatesReadCache } from "../workforce-management/workforce.cache";
import { clearShiftAssignmentSummaryCache } from "./shiftAssignment.cache";

function clearRotationCoverageReads() {
  clearNoveltyCoverageReadCaches();
}

function clearRotationVersionReads() {
  clearRotationCoverageReads();
  // `GET /workforce/shift-templates` expone `inUseFromTomorrow`, que depende
  // de los bloques de versiones vigentes/futuras.
  clearShiftTemplatesReadCache();
}

// R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9). Sin caché propia:
// la configuración se lee al abrirla y cada escritura devuelve el estado nuevo.
export const shiftRotationController = {
  list: (async (req, res) => {
    res.json({ data: await shiftRotationService.list(req.query as unknown as ListRotationsQuery, req.user!, await requestShiftGroupScope(req)) });
  }) satisfies RequestHandler,
  detail: (async (req, res) => {
    res.json({ data: await shiftRotationService.detail(requireParam(req, "id"), req.user!, await requestShiftGroupScope(req)) });
  }) satisfies RequestHandler,
  create: (async (req, res) => {
    res.status(201).json({ data: await shiftRotationService.create(req.body, await requestShiftActor(req), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  update: (async (req, res) => {
    res.json({ data: await shiftRotationService.update(requireParam(req, "id"), req.body, await requestShiftActor(req), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  remove: (async (req, res) => {
    const data = await shiftRotationService.remove(requireParam(req, "id"), await requestShiftActor(req), requestAuditContext(req));
    clearShiftTemplatesReadCache();
    res.json({ data });
  }) satisfies RequestHandler,
  activate: (async (req, res) => {
    const data = await shiftRotationService.activate(requireParam(req, "id"), await requestShiftActor(req), requestAuditContext(req));
    clearRotationCoverageReads();
    res.json({ data });
  }) satisfies RequestHandler,
  deactivate: (async (req, res) => {
    const data = await shiftRotationService.deactivate(requireParam(req, "id"), await requestShiftActor(req), requestAuditContext(req));
    clearRotationCoverageReads();
    res.json({ data });
  }) satisfies RequestHandler,
  finalizePreview: (async (req, res) => {
    res.json({ data: await shiftRotationService.finalizePreview(requireParam(req, "id"), req.body.lastDay, await requestShiftActor(req)) });
  }) satisfies RequestHandler,
  finalize: (async (req, res) => {
    const data = await shiftRotationService.finalize(requireParam(req, "id"), req.body, await requestShiftActor(req), requestAuditContext(req));
    clearRotationVersionReads();
    res.json({ data });
  }) satisfies RequestHandler,
  createCrew: (async (req, res) => {
    res.status(201).json({ data: await shiftRotationService.createCrew(requireParam(req, "id"), req.body, await requestShiftActor(req), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  updateCrew: (async (req, res) => {
    res.json({ data: await shiftRotationService.updateCrew(requireParam(req, "id"), requireParam(req, "crewId"), req.body, await requestShiftActor(req), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  getVersion: (async (req, res) => {
    res.json({ data: await shiftRotationVersionService.get(requireParam(req, "id"), requireParam(req, "versionId"), await requestShiftGroupScope(req)) });
  }) satisfies RequestHandler,
  createVersion: (async (req, res) => {
    const data = await shiftRotationVersionService.create(requireParam(req, "id"), req.body, await requestShiftActor(req), requestAuditContext(req));
    clearRotationVersionReads();
    res.status(201).json({ data });
  }) satisfies RequestHandler,
  updateVersion: (async (req, res) => {
    const data = await shiftRotationVersionService.update(requireParam(req, "id"), requireParam(req, "versionId"), req.body, await requestShiftActor(req), requestAuditContext(req));
    clearRotationVersionReads();
    res.json({ data });
  }) satisfies RequestHandler,
  removeVersion: (async (req, res) => {
    const data = await shiftRotationVersionService.remove(requireParam(req, "id"), requireParam(req, "versionId"), await requestShiftActor(req), requestAuditContext(req));
    clearRotationVersionReads();
    res.json({ data });
  }) satisfies RequestHandler,
  listMembers: (async (req, res) => {
    const { items, hiddenCount } = await shiftRotationMembershipService.list(requireParam(req, "id"), req.query as unknown as ListMembersQuery, req.user!, await requestShiftGroupScope(req));
    res.json({ data: items, meta: { hiddenCount } });
  }) satisfies RequestHandler,
  addMembers: (async (req, res) => {
    const data = await shiftRotationMembershipService.add(requireParam(req, "id"), requireParam(req, "crewId"), req.body, await requestShiftActor(req), requestAuditContext(req));
    clearRotationCoverageReads();
    // Opción C puede cerrar/deshabilitar asignaciones fijas.
    clearShiftAssignmentSummaryCache();
    res.status(201).json({ data });
  }) satisfies RequestHandler,
  closeMember: (async (req, res) => {
    const data = await shiftRotationMembershipService.close(requireParam(req, "id"), requireParam(req, "memberId"), req.body, await requestShiftActor(req), requestAuditContext(req));
    clearRotationCoverageReads();
    res.json({ data });
  }) satisfies RequestHandler,
  moveMember: (async (req, res) => {
    const data = await shiftRotationMembershipService.move(requireParam(req, "id"), requireParam(req, "memberId"), req.body, await requestShiftActor(req), requestAuditContext(req));
    clearRotationCoverageReads();
    res.json({ data });
  }) satisfies RequestHandler,
  cancelMember: (async (req, res) => {
    const data = await shiftRotationMembershipService.cancel(requireParam(req, "id"), requireParam(req, "memberId"), await requestShiftActor(req), requestAuditContext(req));
    clearRotationCoverageReads();
    res.json({ data });
  }) satisfies RequestHandler,
};
