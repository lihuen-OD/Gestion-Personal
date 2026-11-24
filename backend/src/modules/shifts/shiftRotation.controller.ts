import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { ListMembersQuery, ListRotationsQuery } from "./shiftRotation.schemas";
import { shiftRotationService } from "./shiftRotation.service";
import { shiftRotationMembershipService } from "./shiftRotationMembership.service";
import { shiftRotationVersionService } from "./shiftRotationVersion.service";

// R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9). Sin caché propia:
// la configuración se lee al abrirla y cada escritura devuelve el estado nuevo.
export const shiftRotationController = {
  list: (async (req, res) => {
    res.json({ data: await shiftRotationService.list(req.query as unknown as ListRotationsQuery) });
  }) satisfies RequestHandler,
  detail: (async (req, res) => {
    res.json({ data: await shiftRotationService.detail(requireParam(req, "id")) });
  }) satisfies RequestHandler,
  create: (async (req, res) => {
    res.status(201).json({ data: await shiftRotationService.create(req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  update: (async (req, res) => {
    res.json({ data: await shiftRotationService.update(requireParam(req, "id"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  remove: (async (req, res) => {
    res.json({ data: await shiftRotationService.remove(requireParam(req, "id"), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  activate: (async (req, res) => {
    res.json({ data: await shiftRotationService.activate(requireParam(req, "id"), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  deactivate: (async (req, res) => {
    res.json({ data: await shiftRotationService.deactivate(requireParam(req, "id"), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  finalizePreview: (async (req, res) => {
    res.json({ data: await shiftRotationService.finalizePreview(requireParam(req, "id"), req.body.lastDay) });
  }) satisfies RequestHandler,
  finalize: (async (req, res) => {
    res.json({ data: await shiftRotationService.finalize(requireParam(req, "id"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  createCrew: (async (req, res) => {
    res.status(201).json({ data: await shiftRotationService.createCrew(requireParam(req, "id"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  updateCrew: (async (req, res) => {
    res.json({ data: await shiftRotationService.updateCrew(requireParam(req, "id"), requireParam(req, "crewId"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  getVersion: (async (req, res) => {
    res.json({ data: await shiftRotationVersionService.get(requireParam(req, "id"), requireParam(req, "versionId")) });
  }) satisfies RequestHandler,
  createVersion: (async (req, res) => {
    res.status(201).json({ data: await shiftRotationVersionService.create(requireParam(req, "id"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  updateVersion: (async (req, res) => {
    res.json({ data: await shiftRotationVersionService.update(requireParam(req, "id"), requireParam(req, "versionId"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  removeVersion: (async (req, res) => {
    res.json({ data: await shiftRotationVersionService.remove(requireParam(req, "id"), requireParam(req, "versionId"), requestAuditContext(req)) });
  }) satisfies RequestHandler,
  listMembers: (async (req, res) => {
    res.json({ data: await shiftRotationMembershipService.list(requireParam(req, "id"), req.query as unknown as ListMembersQuery) });
  }) satisfies RequestHandler,
  addMembers: (async (req, res) => {
    res.status(201).json({ data: await shiftRotationMembershipService.add(requireParam(req, "id"), requireParam(req, "crewId"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  closeMember: (async (req, res) => {
    res.json({ data: await shiftRotationMembershipService.close(requireParam(req, "id"), requireParam(req, "memberId"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  moveMember: (async (req, res) => {
    res.json({ data: await shiftRotationMembershipService.move(requireParam(req, "id"), requireParam(req, "memberId"), req.body, requestAuditContext(req)) });
  }) satisfies RequestHandler,
  cancelMember: (async (req, res) => {
    res.json({ data: await shiftRotationMembershipService.cancel(requireParam(req, "id"), requireParam(req, "memberId"), requestAuditContext(req)) });
  }) satisfies RequestHandler,
};
