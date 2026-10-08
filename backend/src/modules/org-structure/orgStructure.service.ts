import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService, clearAuditDerivedCaches } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { invalidateOverviewCache, orgStructureRepository, type CatalogRow, type NodeInputs, type NodeKind, type OrgRecord } from "./orgStructure.repository";
import {
  dependencyBlockedMessage,
  describeDependencies,
  orgEntityLabels,
  parentChangeBlockedMessage,
  type OrgEntityKind,
} from "./orgStructure.dependencies";
import type {
  CreateCostCenterInput,
  CreateEstablishmentInput,
  UpdateCostCenterInput,
  UpdateEstablishmentInput,
} from "./orgStructure.schemas";

// Árboles del modelo objetivo (docs/decisions/ORG_LOCATION_REORGANIZATION.md
// §3.1): cada nodo tiene un único padre obligatorio. Empresa y Zona son raíces.
const parentOf: Partial<Record<NodeKind, { kind: NodeKind; field: string }>> = {
  businessUnit: { kind: "company", field: "companyId" },
  sector: { kind: "businessUnit", field: "businessUnitId" },
  area: { kind: "sector", field: "sectorId" },
  establishment: { kind: "zone", field: "zoneId" },
};

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("A record with the same unique value already exists", 409, "UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
    }
    if (error.code === "P2034") {
      throw new AppError("Otra operación modificó la estructura al mismo tiempo. Actualizá la pantalla e intentá nuevamente.", 409, "ORG_STRUCTURE_CONCURRENT_CHANGE");
    }
    if (error.code === "P2003") {
      throw new AppError("Related record not found or cannot be used", 400, "RELATION_CONSTRAINT");
    }
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

// Cachés en memoria: se limpian después del commit, nunca dentro de la
// transacción (si se revierte, no deben haber reaccionado a un cambio que no
// existe).
function afterCommit() {
  invalidateOverviewCache();
  clearAuditDerivedCaches();
}

function describe(kind: OrgEntityKind, item: { code: string; name: string }) {
  const { article, noun } = orgEntityLabels[kind];
  return `${article} ${noun} ${item.code} - ${item.name}`;
}

function snapshot(record: OrgRecord) {
  return { id: record.id, code: record.code, name: record.name, status: record.status, parentId: record.parentId };
}

function notFound(): never {
  throw new AppError("No encontramos el registro solicitado.", 404, "RECORD_NOT_FOUND");
}

function capitalized(kind: OrgEntityKind) {
  const { noun } = orgEntityLabels[kind];
  return `${noun[0]!.toUpperCase()}${noun.slice(1)}`;
}

// Concordancia de género: "el área" es femenino; el pronombre lo indica.
function gendered(kind: OrgEntityKind, stem: string) {
  return `${stem}${orgEntityLabels[kind].pronoun === "la" ? "a" : "o"}`;
}

// A8-1 (§12.1 I4, AT-3): el registro archivado es evidencia de G4/G7: no se
// edita, no se borra y no recibe relaciones nuevas. Un solo código para todas
// las causas "registro archivado" en este módulo.
function assertNotArchived(kind: OrgEntityKind, record: { name: string; archivedAt: Date | null }, detail = "no se edita ni se elimina") {
  if (!record.archivedAt) return;
  throw new AppError(`${capitalized(kind)} “${record.name}” está archivado: ${detail}.`, 409, "ORG_STRUCTURE_ARCHIVED_RECORD", { kind });
}

function invalidParent(kind: NodeKind, message: string): never {
  throw new AppError(message, 400, "ORG_STRUCTURE_INVALID_PARENT", { kind });
}

// El padre debe existir, estar activo y pertenecer al modelo objetivo: un
// nodo nuevo nunca cuelga de un registro del modelo anterior, que la limpieza
// controlada va a eliminar.
async function assertParent(tx: PrismaTransactionClient, kind: NodeKind, parentId: string) {
  const relation = parentOf[kind];
  if (!relation) return;
  const parent = await orgStructureRepository.findNode(tx, relation.kind, parentId);
  const { article, noun } = orgEntityLabels[relation.kind];
  if (!parent) invalidParent(kind, `No encontramos ${article} ${noun} ${gendered(relation.kind, "seleccionad")}.`);
  // A8 §12.4: archivado manda sobre legacy/inactivo — es la causa más específica.
  if (parent.archivedAt) {
    throw new AppError(`${capitalized(relation.kind)} “${parent.name}” está archivado y no puede recibir elementos nuevos.`, 409, "ORG_STRUCTURE_ARCHIVED_RECORD", { kind: relation.kind });
  }
  if (parent.isLegacy) invalidParent(kind, `${capitalized(relation.kind)} “${parent.name}” pertenece a la estructura anterior y no puede recibir elementos nuevos.`);
  if (parent.status !== "ACTIVO") invalidParent(kind, `${capitalized(relation.kind)} “${parent.name}” está ${gendered(relation.kind, "inactiv")}.`);
}

// A8 §12.8: unicidad de servicio por (zoneId, code) excluyendo archivados.
// `zoneId === null` es un establecimiento del modelo anterior: su unicidad la
// gobierna el único legado de la base, no este lookup del modelo objetivo.
async function assertUniqueEstablishmentCode(tx: PrismaTransactionClient, zoneId: string | null | undefined, code: string | undefined, excludeId?: string) {
  if (code === undefined || zoneId === null || zoneId === undefined) return;
  const conflict = await orgStructureRepository.findZonedEstablishmentByCode(tx, zoneId, code, excludeId);
  if (conflict) throw new AppError("A record with the same unique value already exists", 409, "UNIQUE_CONSTRAINT");
}

// Un centro de costo no agrega vínculos NUEVOS a registros del modelo
// anterior ni a registros archivados (§12.4). Los vínculos ya existentes no se
// tocan acá: los que apunten a destinos retirados son borrado autorizado en la
// limpieza (§12.4, bloque de borrados), no conservación.
async function assertNoNewLegacyLinks(
  tx: PrismaTransactionClient,
  input: Partial<Record<"companyIds" | "businessUnitIds" | "sectorIds" | "areaIds" | "establishmentIds", string[]>>,
  current?: Partial<Record<"companyIds" | "businessUnitIds" | "sectorIds" | "areaIds" | "establishmentIds", string[]>>,
) {
  const families = ["companyIds", "businessUnitIds", "sectorIds", "areaIds", "establishmentIds"] as const;
  const added = (key: (typeof families)[number]) => (input[key] ?? []).filter((id) => !current?.[key]?.includes(id));
  const archivedNames = await orgStructureRepository.findArchivedNames(tx, {
    companyIds: added("companyIds"),
    businessUnitIds: added("businessUnitIds"),
    sectorIds: added("sectorIds"),
    areaIds: added("areaIds"),
    establishmentIds: added("establishmentIds"),
  });
  if (archivedNames.length) {
    throw new AppError(
      `No se puede vincular el centro de costo a un registro archivado: ${archivedNames.join(", ")}.`,
      409,
      "ORG_STRUCTURE_ARCHIVED_RECORD",
    );
  }
  const legacyNames = await orgStructureRepository.findLegacyNames(tx, { sectorIds: added("sectorIds"), areaIds: added("areaIds"), establishmentIds: added("establishmentIds") });
  if (legacyNames.length) {
    throw new AppError(
      `No se puede vincular el centro de costo a elementos de la estructura anterior: ${legacyNames.join(", ")}.`,
      400,
      "ORG_STRUCTURE_LEGACY_LINK",
    );
  }
}

export const orgStructureService = {
  async getOverview() {
    const [companies, businessUnits, establishments, areas, sectors, costCenters, zones] =
      await orgStructureRepository.getOverview();

    return { companies, businessUnits, sectors, areas, zones, establishments, costCenters };
  },

  async createNode<K extends NodeKind>(kind: K, input: NodeInputs[K][0], audit?: AuditContext): Promise<CatalogRow> {
    const item = await execute(() => orgStructureRepository.transaction(async (tx) => {
      const relation = parentOf[kind];
      if (relation) await assertParent(tx, kind, (input as unknown as Record<string, string>)[relation.field]!);
      if (kind === "establishment") await assertUniqueEstablishmentCode(tx, (input as CreateEstablishmentInput).zoneId, (input as CreateEstablishmentInput).code);
      const created = await orgStructureRepository.createNode(tx, kind, input);
      await auditService.registerWithin(tx, {
        ...audit,
        action: "CREATE",
        entity: orgEntityLabels[kind].auditEntity,
        entityId: created.id,
        description: `Se creó ${describe(kind, created)}.`,
        after: created as Prisma.InputJsonValue,
      });
      return created;
    }));
    afterCommit();
    return item;
  },

  async updateNode<K extends NodeKind>(kind: K, id: string, input: NodeInputs[K][1], audit?: AuditContext): Promise<CatalogRow> {
    const item = await execute(() => orgStructureRepository.transaction(async (tx) => {
      const current = await orgStructureRepository.findNode(tx, kind, id);
      if (!current) notFound();
      assertNotArchived(kind, current);

      const relation = parentOf[kind];
      const nextParentId = relation ? (input as Record<string, string | undefined>)[relation.field] : undefined;
      if (relation && nextParentId !== undefined && nextParentId !== current.parentId) {
        // Un registro del modelo anterior no se reubica en el árbol nuevo: se
        // crea uno nuevo (ORG_LOCATION_REORGANIZATION.md §4, sin
        // correspondencias). Nombre, código y estado sí se pueden corregir.
        if (current.isLegacy) {
          throw new AppError(
            `${capitalized(kind)} “${current.name}” pertenece a la estructura anterior: no se reubica en la nueva. Creá ${orgEntityLabels[kind].pronoun === "la" ? "una nueva" : "uno nuevo"}.`,
            409,
            "ORG_STRUCTURE_LEGACY_RECORD",
          );
        }
        const dependencies = describeDependencies(kind, current.counts);
        if (dependencies.length) {
          throw new AppError(parentChangeBlockedMessage(kind, current.name, dependencies), 409, "ORG_STRUCTURE_PARENT_IN_USE", { dependencies });
        }
        await assertParent(tx, kind, nextParentId);
      }
      // A8 §12.8: la validación (zoneId, code) corre siempre que cambie la
      // ZONA o el CÓDIGO — mover el establecimiento a otra zona con el mismo
      // código choca contra el único de la zona destino.
      if (kind === "establishment") {
        const establishment = input as UpdateEstablishmentInput;
        const nextZoneId = establishment.zoneId !== undefined ? establishment.zoneId : current.parentId;
        const zoneChanged = establishment.zoneId !== undefined && establishment.zoneId !== current.parentId;
        const codeChanged = establishment.code !== undefined && establishment.code !== current.code;
        if (zoneChanged || codeChanged) await assertUniqueEstablishmentCode(tx, nextZoneId, establishment.code ?? current.code, id);
      }

      const updated = await orgStructureRepository.updateNode(tx, kind, id, input);
      await auditService.registerWithin(tx, {
        ...audit,
        action: "UPDATE",
        entity: orgEntityLabels[kind].auditEntity,
        entityId: updated.id,
        description: `Se actualizó ${describe(kind, updated)}.`,
        before: snapshot(current) as Prisma.InputJsonValue,
        after: updated as Prisma.InputJsonValue,
      });
      return updated;
    }));
    afterCommit();
    return item;
  },

  async createCostCenter(input: CreateCostCenterInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.transaction(async (tx) => {
      await assertNoNewLegacyLinks(tx, input);
      const created = await orgStructureRepository.createCostCenter(tx, input);
      await auditService.registerWithin(tx, {
        ...audit,
        action: "CREATE",
        entity: "CostCenter",
        entityId: created.id,
        description: `Se creó ${describe("costCenter", created)}.`,
        after: { ...created, links: { companyIds: input.companyIds, businessUnitIds: input.businessUnitIds, sectorIds: input.sectorIds, areaIds: input.areaIds, establishmentIds: input.establishmentIds } } as Prisma.InputJsonValue,
      });
      return created;
    }));
    afterCommit();
    return item;
  },

  async updateCostCenter(id: string, input: UpdateCostCenterInput, audit?: AuditContext) {
    const item = await execute(() => orgStructureRepository.transaction(async (tx) => {
      const currentLinks = await orgStructureRepository.findCostCenterLinks(tx, id);
      if (!currentLinks) notFound();
      await assertNoNewLegacyLinks(tx, input, currentLinks);
      const updated = await orgStructureRepository.updateCostCenter(tx, id, input);
      await auditService.registerWithin(tx, {
        ...audit,
        action: "UPDATE",
        entity: "CostCenter",
        entityId: updated.id,
        description: `Se actualizó ${describe("costCenter", updated)}.`,
        before: { links: { ...currentLinks } } as Prisma.InputJsonValue,
        after: updated as Prisma.InputJsonValue,
      });
      return updated;
    }));
    afterCommit();
    return item;
  },

  // Eliminación definitiva de un registro creado por error. Sólo si no tiene
  // ninguna dependencia de negocio; si la tiene, 409 con el motivo y la
  // sugerencia de inactivarlo (Inactivar sigue siendo la baja normal). La
  // auditoría se escribe en la misma transacción que el borrado.
  async deleteEntity(kind: OrgEntityKind, id: string, audit?: AuditContext) {
    const { noun, auditEntity } = orgEntityLabels[kind];
    const result = await execute(() => orgStructureRepository.deleteIfUnused(
      kind,
      id,
      (record) => Boolean(record.archivedAt) || describeDependencies(kind, record.counts).length > 0,
      (tx, record) => auditService.registerWithin(tx, {
        ...audit,
        action: "DELETE",
        entity: auditEntity,
        entityId: record.id,
        description: `Se eliminó definitivamente ${noun} ${record.code} - ${record.name} (sin dependencias).`,
        before: snapshot(record) as Prisma.InputJsonValue,
      }),
    ));
    if (result.status === "NOT_FOUND") notFound();
    if (result.status === "BLOCKED") {
      assertNotArchived(kind, result.record);
      const dependencies = describeDependencies(kind, result.record.counts);
      throw new AppError(dependencyBlockedMessage(kind, result.record.name, dependencies), 409, "ORG_STRUCTURE_HAS_DEPENDENCIES", { dependencies });
    }
    afterCommit();
    const { record } = result;
    return { id: record.id, code: record.code, name: record.name };
  },
};
