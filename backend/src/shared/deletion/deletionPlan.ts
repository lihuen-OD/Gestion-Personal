import { createHash } from "node:crypto";
import type { RoleName } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../errors/AppError";
import type { PrismaTransactionClient } from "../prisma/client";

/**
 * Eliminación controlada con dependencias (protocolo común a todos los módulos
 * que ofrecen "Eliminar"):
 *
 * 1. Vista previa calculada por el backend: qué se elimina, archiva, desvincula
 *    o queda incompleto, con nombres, cantidades y consecuencias.
 * 2. Confirmación explícita (con el nombre escrito si el impacto es grande).
 * 3. Al confirmar se recalcula el plan DENTRO de la transacción Serializable de
 *    la ejecución y se compara su huella con la de la vista previa: si las
 *    dependencias cambiaron, no se ejecuta nada y se devuelve el plan nuevo.
 * 4. Ejecución atómica con auditoría en la misma transacción; cachés después
 *    del commit.
 *
 * Criterio por tipo de relación (no hay cascada indiscriminada):
 * - DELETE: hijos propios y configuración exclusiva sin historia.
 * - ARCHIVE: registros que la historia necesita (períodos laborales, ubicaciones
 *   pasadas, alcances históricos, reglas): salen de catálogos y selectores pero
 *   se conservan.
 * - UNLINK: vínculos compartidos y referencias opcionales; nunca se borra la
 *   entidad compartida por perder un vínculo.
 * - END: vigencias de personas que dejan de regir desde hoy (con su historia).
 * - REVIEW: registros que quedan incompletos y deben recargarse o revisarse.
 * - RECALCULATE: resultados que se recalculan en períodos no protegidos (por
 *   ejemplo, multiplicadores al eliminar una regla de horas especiales).
 */

export type DeletionEffect = "DELETE" | "ARCHIVE" | "UNLINK" | "END" | "REVIEW" | "RECALCULATE";

export type DeletionItem = { id: string; name: string };

export type DeletionGroup = {
  /** Clave estable del grupo (entra en la huella). */
  key: string;
  effect: DeletionEffect;
  label: string;
  /** Explicación de negocio de lo que pasa con estos registros. */
  consequence: string;
  count: number;
  /** Muestra legible (hasta MAX_LISTED); la huella usa todos los ids. */
  items: DeletionItem[];
};

export type DeletionBlocker = { code: string; message: string };

export type DeletionPreview = {
  target: { kind: string; id: string; code: string | null; name: string; label: string };
  groups: DeletionGroup[];
  blockers: DeletionBlocker[];
  /** Impacto grande: hay que escribir el nombre del registro para confirmar. */
  requiresTypedConfirmation: boolean;
  confirmationText: string;
  /** Huella del plan: la ejecución la exige y la vuelve a calcular. */
  token: string;
};

export type DeletionConfirmation = { token: string; confirmationText?: string | null };

const MAX_LISTED = 50;
/** Desde esta cantidad de registros alcanzados se pide escribir el nombre. */
export const TYPED_CONFIRMATION_THRESHOLD = 10;

/** Acumula los grupos del plan con todos sus ids (para la huella). */
export class DeletionPlanBuilder {
  private readonly groups = new Map<string, { group: Omit<DeletionGroup, "count" | "items">; items: Map<string, string>; listed: boolean }>();
  private readonly blockers: DeletionBlocker[] = [];
  private personImpact = false;

  /** `listed: false`: el detalle entra en la huella y en la cantidad, pero no se lista (filas técnicas). */
  add(key: string, effect: DeletionEffect, label: string, consequence: string, items: DeletionItem[], options: { affectsPeople?: boolean; listed?: boolean } = {}) {
    if (!items.length) return this;
    const entry = this.groups.get(key) ?? { group: { key, effect, label, consequence }, items: new Map<string, string>(), listed: options.listed !== false };
    for (const item of items) entry.items.set(item.id, item.name);
    this.groups.set(key, entry);
    if (options.affectsPeople) this.personImpact = true;
    return this;
  }

  block(code: string, message: string) {
    this.blockers.push({ code, message });
    return this;
  }

  build(target: DeletionPreview["target"], executablePlan: unknown): DeletionPreview {
    const groups = [...this.groups.values()].map(({ group, items, listed }) => {
      const sorted = [...items.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id));
      return { ...group, count: sorted.length, items: listed ? sorted : [], allIds: sorted.map((item) => item.id) };
    });
    const token = fingerprint(target, groups.map(({ key, effect, allIds }) => ({ key, effect, ids: allIds })), this.blockers, executablePlan);
    const affected = groups.reduce((total, group) => total + group.count, 0);
    const archives = groups.some((group) => group.effect === "ARCHIVE");
    return {
      target,
      groups: groups.map(({ allIds: _ids, items, ...group }) => ({ ...group, items: items.slice(0, MAX_LISTED) })),
      blockers: this.blockers,
      requiresTypedConfirmation: this.personImpact || archives || affected >= TYPED_CONFIRMATION_THRESHOLD,
      confirmationText: target.name,
      token,
    };
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") {
    const serializable = "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;
    if (serializable !== value) return canonicalize(serializable);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function fingerprint(target: DeletionPreview["target"], groups: Array<{ key: string; effect: string; ids: string[] }>, blockers: DeletionBlocker[], executablePlan: unknown) {
  const canonical = JSON.stringify(canonicalize({
    target,
    groups,
    blockers,
    executablePlan,
  }));
  return createHash("sha256").update(canonical).digest("hex");
}

const normalizeName = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

/**
 * Revalidación dentro de la transacción de ejecución. Si el plan cambió, no se
 * ejecuta nada: 409 con la vista previa actualizada para volver a confirmar.
 */
export function assertConfirmedPlan(current: DeletionPreview, confirmation: DeletionConfirmation) {
  if (current.token !== confirmation.token) {
    throw new AppError(
      "Las dependencias cambiaron desde la vista previa. Revisá el impacto actualizado y confirmá de nuevo.",
      409,
      "DELETION_PREVIEW_CHANGED",
      { preview: current },
    );
  }
  if (current.blockers.length) {
    throw new AppError(current.blockers.map((item) => item.message).join(" "), 409, "DELETION_BLOCKED", { preview: current });
  }
  if (current.requiresTypedConfirmation && normalizeName(confirmation.confirmationText ?? "") !== normalizeName(current.confirmationText)) {
    throw new AppError(`Para confirmar escribí exactamente “${current.confirmationText}”.`, 400, "DELETION_CONFIRMATION_MISMATCH");
  }
}

/**
 * Revalidación de permisos con lo leído en la misma transacción (el usuario de
 * la request puede venir de un caché de pocos segundos).
 */
export async function assertActorAuthorizedWithin(tx: PrismaTransactionClient, userId: string | null | undefined, allowed: readonly RoleName[]) {
  const actor = userId ? await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }) : null;
  if (!actor || actor.status !== "ACTIVO" || !allowed.includes(actor.role)) {
    throw new AppError("Tu usuario ya no tiene permiso para eliminar este registro.", 403, "DELETION_FORBIDDEN");
  }
}

export const deletionConfirmationSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  confirmationText: z.string().max(300).optional().nullable(),
});

/**
 * Conflictos de la confirmación: la vista previa actualizada viaja en el
 * cuerpo (no en `details`, que el manejador global oculta en producción) para
 * que la pantalla la muestre y pida confirmar de nuevo.
 */
export function deletionConflictResponse(error: unknown): { status: number; body: unknown } | null {
  if (!(error instanceof AppError) || !["DELETION_PREVIEW_CHANGED", "DELETION_BLOCKED"].includes(error.code)) return null;
  const preview = (error.details as { preview?: DeletionPreview } | undefined)?.preview;
  return { status: error.statusCode, body: { error: { code: error.code, message: error.message }, preview } };
}
