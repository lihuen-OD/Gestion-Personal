import type { Request, RequestHandler, Response } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import type { OrgEntityKind } from "./orgStructure.dependencies";
import type { NodeKind } from "./orgStructure.repository";
import { orgStructureService } from "./orgStructure.service";

// El body ya llegó validado por el schema zod de la ruta (validateBody).
type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const createNode = (kind: NodeKind): AsyncHandler => async (req, res) => {
  res.status(201).json({ data: await orgStructureService.createNode(kind, req.body, requestAuditContext(req)) });
};
const updateNode = (kind: NodeKind): AsyncHandler => async (req, res) => {
  res.json({ data: await orgStructureService.updateNode(kind, requireParam(req, "id"), req.body, requestAuditContext(req)) });
};
const deleteEntity = (kind: OrgEntityKind): AsyncHandler => async (req, res) => {
  res.json({ data: await orgStructureService.deleteEntity(kind, requireParam(req, "id"), requestAuditContext(req)) });
};

export const orgStructureController = {
  overview: (async (_req, res) => {
    res.json({ data: await orgStructureService.getOverview() });
  }) satisfies RequestHandler,

  createCompany: createNode("company"),
  updateCompany: updateNode("company"),
  createBusinessUnit: createNode("businessUnit"),
  updateBusinessUnit: updateNode("businessUnit"),
  createSector: createNode("sector"),
  updateSector: updateNode("sector"),
  createArea: createNode("area"),
  updateArea: updateNode("area"),
  createZone: createNode("zone"),
  updateZone: updateNode("zone"),
  createEstablishment: createNode("establishment"),
  updateEstablishment: updateNode("establishment"),

  createCostCenter: (async (req, res) => res.status(201).json({ data: await orgStructureService.createCostCenter(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateCostCenter: (async (req, res) => res.json({ data: await orgStructureService.updateCostCenter(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,

  deleteCompany: deleteEntity("company"),
  deleteBusinessUnit: deleteEntity("businessUnit"),
  deleteSector: deleteEntity("sector"),
  deleteArea: deleteEntity("area"),
  deleteZone: deleteEntity("zone"),
  deleteEstablishment: deleteEntity("establishment"),
  deleteCostCenter: deleteEntity("costCenter"),
};
