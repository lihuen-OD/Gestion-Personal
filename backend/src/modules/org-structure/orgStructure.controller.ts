import type { Request, RequestHandler, Response } from "express";
import { requestAuditContext } from "../../shared/audit/requestAuditContext";
import { requireParam } from "../../shared/http/params";
import { AppError } from "../../shared/errors/AppError";
import { deletionConflictResponse } from "../../shared/deletion/deletionPlan";
import type { OrgEntityKind } from "./orgStructure.dependencies";
import { orgStructureDeletion } from "./orgStructure.deletion";
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

// Colección de la URL → tipo de registro (eliminación controlada).
const kindByCollection: Record<string, OrgEntityKind> = {
  companies: "company",
  "business-units": "businessUnit",
  sectors: "sector",
  areas: "area",
  provinces: "province",
  zones: "zone",
  establishments: "establishment",
  "establishment-units": "establishmentUnit",
  "cost-centers": "costCenter",
};

function kindOf(req: Request): OrgEntityKind {
  const kind = kindByCollection[requireParam(req, "collection")];
  if (!kind) throw new AppError("Tipo de registro desconocido.", 404, "RECORD_NOT_FOUND");
  return kind;
}

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
  createProvince: createNode("province"),
  updateProvince: updateNode("province"),
  createZone: createNode("zone"),
  updateZone: updateNode("zone"),
  createEstablishment: createNode("establishment"),
  updateEstablishment: updateNode("establishment"),
  createEstablishmentUnit: createNode("establishmentUnit"),
  updateEstablishmentUnit: updateNode("establishmentUnit"),

  createCostCenter: (async (req, res) => res.status(201).json({ data: await orgStructureService.createCostCenter(req.body, requestAuditContext(req)) })) satisfies RequestHandler,
  updateCostCenter: (async (req, res) => res.json({ data: await orgStructureService.updateCostCenter(requireParam(req, "id"), req.body, requestAuditContext(req)) })) satisfies RequestHandler,

  deleteCompany: deleteEntity("company"),
  deleteBusinessUnit: deleteEntity("businessUnit"),
  deleteSector: deleteEntity("sector"),
  deleteArea: deleteEntity("area"),
  deleteProvince: deleteEntity("province"),
  deleteZone: deleteEntity("zone"),
  deleteEstablishment: deleteEntity("establishment"),
  deleteEstablishmentUnit: deleteEntity("establishmentUnit"),
  deleteCostCenter: deleteEntity("costCenter"),

  deletionPreview: (async (req, res) => {
    res.json({ data: await orgStructureDeletion.preview(kindOf(req), requireParam(req, "id")) });
  }) satisfies RequestHandler,
  executeDeletion: (async (req, res) => {
    try {
      res.json({ data: await orgStructureDeletion.execute(kindOf(req), requireParam(req, "id"), req.body, requestAuditContext(req)) });
    } catch (error) {
      const conflict = deletionConflictResponse(error);
      if (!conflict) throw error;
      res.status(conflict.status).json(conflict.body);
    }
  }) satisfies RequestHandler,
};
