import type { RequestHandler } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { orgStructureService } from "./orgStructure.service";

export const orgStructureController = {
  overview: (async (_req, res) => {
    res.json({ data: await orgStructureService.getOverview() });
  }) satisfies RequestHandler,

  createCompany: (async (req, res) => res.status(201).json({ data: await orgStructureService.createCompany(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateCompany: (async (req, res) => res.json({ data: await orgStructureService.updateCompany(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,

  createBusinessUnit: (async (req, res) => res.status(201).json({ data: await orgStructureService.createBusinessUnit(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateBusinessUnit: (async (req, res) => res.json({ data: await orgStructureService.updateBusinessUnit(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,

  createEstablishment: (async (req, res) => res.status(201).json({ data: await orgStructureService.createEstablishment(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateEstablishment: (async (req, res) => res.json({ data: await orgStructureService.updateEstablishment(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,

  createArea: (async (req, res) => res.status(201).json({ data: await orgStructureService.createArea(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateArea: (async (req, res) => res.json({ data: await orgStructureService.updateArea(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,

  createSector: (async (req, res) => res.status(201).json({ data: await orgStructureService.createSector(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateSector: (async (req, res) => res.json({ data: await orgStructureService.updateSector(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,

  createCostCenter: (async (req, res) => res.status(201).json({ data: await orgStructureService.createCostCenter(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateCostCenter: (async (req, res) => res.json({ data: await orgStructureService.updateCostCenter(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,
};
