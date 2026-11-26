/**
 * Migra las asignaciones TIME_RESPONSIBLE vigentes del modelo anterior
 * (Nivel 3 directo, Nivel 2 heredado) al modelo actual (Nivel 2 directo,
 * Nivel 3 heredado).
 *
 * Sólo lectura por defecto. Para escribir exige, sin bypass:
 * - conexión explícita y host esperado;
 * - identidad Neon verificada por API;
 * - rama no-default llamada exactamente `development`;
 * - `--confirm-development`;
 * - respaldo nuevo fuera del repositorio, persistido antes de la primera
 *   mutación y acompañado por SHA-256.
 *
 * Uso (las credenciales/flags de identidad deben salir de un lanzador seguro):
 *   npx tsx scripts/reconcile-time-responsible-hierarchy.ts \
 *     --env-file=<archivo> --expected-host=<host> \
 *     --neon-project-id=<id> --expected-branch-id=<id> \
 *     --expected-branch-name=development
 *
 *   ... --apply --confirm-development --backup=/ruta/fuera-del-repo/respaldo.json
 */
import { existsSync, fsyncSync, openSync, closeSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type { EmployeeAssignment, Prisma, PrismaClient } from "@prisma/client";
import { arg, connectTarget, flag, readOnly } from "./org-reorg/lib";
import { requireVerifiedIdentity } from "../src/modules/org-structure/reorg/targetIdentity";
import { activeTimeResponsibleWhere, employeeAccessWhere } from "../src/modules/employees/employeeAccess";
import { todayArgentinaDateKey } from "../src/shared/datetime/argentinaTime";
import { roles } from "../src/shared/security/roles";

type Db = PrismaClient | Prisma.TransactionClient;
type LegacyAssignment = EmployeeAssignment & {
  employee: { legajo: string; firstName: string; lastName: string };
  user: { id: string; name: string; role: string; status: string } | null;
};
type TargetUser = { id: string; name: string };

interface MigrationItem {
  source: LegacyAssignment;
  targets: TargetUser[];
  unresolvedReason?: string;
}

interface Plan {
  dateKey: string;
  legacy: MigrationItem[];
  alreadyValid: LegacyAssignment[];
  invalidOrUnlinked: LegacyAssignment[];
}

const backendRoot = resolve(__dirname, "..");
const repositoryRoot = resolve(backendRoot, "..");

function dateValue(value: Date | null) {
  return value?.toISOString() ?? null;
}

function assignmentKey(assignment: Pick<EmployeeAssignment, "employeeId" | "userId" | "effectiveFrom" | "effectiveTo" | "status" | "notes">) {
  return JSON.stringify([
    assignment.employeeId,
    assignment.userId,
    dateValue(assignment.effectiveFrom),
    dateValue(assignment.effectiveTo),
    assignment.status,
    assignment.notes,
  ]);
}

async function buildPlan(db: Db, dateKey: string): Promise<Plan> {
  const plantaCandidates = await db.user.findMany({
    where: {
      role: roles.supervision,
      status: "ACTIVO",
      OR: [
        { name: { contains: "planta", mode: "insensitive" } },
        { email: { contains: "planta", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });
  const active = await db.employeeAssignment.findMany({
    where: activeTimeResponsibleWhere(dateKey),
    include: {
      employee: { select: { legajo: true, firstName: true, lastName: true } },
      user: { select: { id: true, name: true, role: true, status: true } },
    },
    orderBy: [{ employee: { legajo: "asc" } }, { createdAt: "asc" }],
  }) as LegacyAssignment[];

  const legacy: MigrationItem[] = [];
  const alreadyValid: LegacyAssignment[] = [];
  const invalidOrUnlinked: LegacyAssignment[] = [];
  for (const assignment of active) {
    if (assignment.user?.role === roles.supervision && assignment.user.status === "ACTIVO") {
      alreadyValid.push(assignment);
      continue;
    }
    if (assignment.user?.role !== roles.cargaHoraria || assignment.user.status !== "ACTIVO") {
      // Corrección de datos solicitada y verificable: Juanjo 992 tiene una
      // fila legacy sólo por nombre ("Wicky Stefania"). El responsable real
      // es el único usuario Nivel 2 ACTIVO identificado como Planta.
      if (assignment.employee.legajo === "992" && plantaCandidates.length === 1) {
        legacy.push({ source: assignment, targets: plantaCandidates });
        continue;
      }
      invalidOrUnlinked.push(assignment);
      continue;
    }
    const relations = await db.userSupervisionAssignment.findMany({
      where: {
        supervisedUserId: assignment.user.id,
        supervisor: { role: roles.supervision, status: "ACTIVO" },
      },
      select: { supervisor: { select: { id: true, name: true } } },
      orderBy: { supervisor: { name: "asc" } },
    });
    const targets = relations.map((relation) => relation.supervisor);
    legacy.push({
      source: assignment,
      targets,
      ...(targets.length ? {} : { unresolvedReason: "El Nivel 3 no tiene un Nivel 2 ACTIVO que lo supervise." }),
    });
  }
  return { dateKey, legacy, alreadyValid, invalidOrUnlinked };
}

function publicPlan(plan: Plan) {
  return {
    dateKey: plan.dateKey,
    activeRows: plan.legacy.length + plan.alreadyValid.length + plan.invalidOrUnlinked.length,
    alreadyValidN2: plan.alreadyValid.length,
    legacyN3ToMigrate: plan.legacy.filter((item) => !item.unresolvedReason && item.source.user?.role === roles.cargaHoraria).length,
    explicitJuanjo992Repair: plan.legacy.filter((item) => !item.unresolvedReason && item.source.employee.legajo === "992").length,
    unresolvedN3: plan.legacy.filter((item) => item.unresolvedReason).map((item) => ({
      assignmentId: item.source.id,
      legajo: item.source.employee.legajo,
      user: item.source.user?.name,
      reason: item.unresolvedReason,
    })),
    invalidOrUnlinked: plan.invalidOrUnlinked.map((item) => ({
      assignmentId: item.id,
      legajo: item.employee.legajo,
      userId: item.userId,
      user: item.user?.name ?? item.personName,
      role: item.user?.role ?? null,
      status: item.user?.status ?? null,
    })),
    migrations: plan.legacy.filter((item) => !item.unresolvedReason).map((item) => ({
      assignmentId: item.source.id,
      legajo: item.source.employee.legajo,
      from: item.source.user?.name ?? item.source.personName,
      to: item.targets.map((target) => target.name),
    })),
  };
}

function assertBackupPath(pathValue: string | undefined) {
  if (!pathValue) throw new Error("Falta --backup=<archivo.json> para --apply.");
  const path = resolve(pathValue);
  if (!isAbsolute(pathValue)) throw new Error("--backup debe ser una ruta absoluta fuera del repositorio.");
  const insideRepo = relative(repositoryRoot, path);
  if (!insideRepo.startsWith("..") && insideRepo !== "") throw new Error("El respaldo debe guardarse fuera del repositorio.");
  if (existsSync(path) || existsSync(`${path}.sha256`)) throw new Error("El respaldo o su SHA-256 ya existen; no se sobrescriben.");
  return path;
}

function persistBackup(path: string, payload: unknown) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(path, json, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  const sha256 = createHash("sha256").update(json).digest("hex");
  writeFileSync(`${path}.sha256`, `${sha256}  ${path}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return sha256;
}

async function applyPlan(db: Prisma.TransactionClient, plan: Plan) {
  const migrated: Array<{ sourceId: string; updatedTo?: string; createdIds: string[]; deleted: boolean }> = [];
  for (const item of plan.legacy) {
    if (item.unresolvedReason) continue;
    const existing = await db.employeeAssignment.findMany({
      where: { employeeId: item.source.employeeId, type: "TIME_RESPONSIBLE", userId: { in: item.targets.map((target) => target.id) } },
    });
    const existingKeys = new Set(existing.map(assignmentKey));
    const missing = item.targets.filter((target) => !existingKeys.has(assignmentKey({ ...item.source, userId: target.id })));
    const createdIds: string[] = [];
    if (!missing.length) {
      await db.employeeAssignment.delete({ where: { id: item.source.id } });
      migrated.push({ sourceId: item.source.id, createdIds, deleted: true });
      continue;
    }

    const [first, ...rest] = missing;
    await db.employeeAssignment.update({
      where: { id: item.source.id },
      data: { userId: first.id, personName: null, role: null },
    });
    for (const target of rest) {
      const id = randomUUID();
      await db.employeeAssignment.create({
        data: {
          id,
          employeeId: item.source.employeeId,
          userId: target.id,
          personName: null,
          type: "TIME_RESPONSIBLE",
          role: null,
          effectiveFrom: item.source.effectiveFrom,
          effectiveTo: item.source.effectiveTo,
          status: item.source.status,
          notes: item.source.notes,
          createdAt: item.source.createdAt,
        },
      });
      createdIds.push(id);
    }
    migrated.push({ sourceId: item.source.id, updatedTo: first.id, createdIds, deleted: false });
  }
  return migrated;
}

async function validateLive(db: Db, dateKey: string) {
  const activeWhere = activeTimeResponsibleWhere(dateKey);
  const plantaCandidates = await db.user.findMany({
    where: {
      role: roles.supervision,
      status: "ACTIVO",
      OR: [
        { name: { contains: "planta", mode: "insensitive" } },
        { email: { contains: "planta", mode: "insensitive" } },
        { employee: { OR: [{ firstName: { contains: "planta", mode: "insensitive" } }, { lastName: { contains: "planta", mode: "insensitive" } }] } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  const juanjo = await db.employee.findUnique({ where: { legajo: "992" }, select: { id: true, legajo: true, firstName: true, lastName: true } });
  const juanjoDirect = juanjo ? await db.employeeAssignment.findMany({
    where: { AND: [activeWhere, { employeeId: juanjo.id }, { userId: { in: plantaCandidates.map((user) => user.id) } }] },
    select: { id: true, userId: true },
  }) : [];

  const nivel3 = await db.user.findMany({
    where: { role: roles.cargaHoraria, status: "ACTIVO" },
    select: { id: true, name: true, supervisionsAsSupervised: { select: { supervisor: { select: { id: true, name: true, role: true, status: true } } } } },
    orderBy: { name: "asc" },
  });
  const inheritance = [];
  for (const user of nivel3) {
    const activeSupervisors = user.supervisionsAsSupervised.map((relation) => relation.supervisor).filter((supervisor) => supervisor.role === roles.supervision && supervisor.status === "ACTIVO");
    const expected = await db.employee.findMany({
      where: { assignments: { some: { AND: [activeWhere, { userId: { in: activeSupervisors.map((supervisor) => supervisor.id) } }] } } },
      select: { legajo: true }, orderBy: { legajo: "asc" },
    });
    const actual = await db.employee.findMany({
      where: employeeAccessWhere({ id: user.id, role: roles.cargaHoraria } as Express.AuthUser),
      select: { legajo: true }, orderBy: { legajo: "asc" },
    });
    inheritance.push({
      user: user.name,
      supervisors: activeSupervisors.map((supervisor) => supervisor.name),
      employeeCount: actual.length,
      ok: JSON.stringify(actual) === JSON.stringify(expected),
    });
  }
  return {
    juanjo992: {
      found: Boolean(juanjo),
      employee: juanjo ? `${juanjo.lastName} ${juanjo.firstName}` : null,
      plantaCandidates: plantaCandidates.map((user) => ({ id: user.id, name: user.name, email: user.email })),
      visibleDirectly: plantaCandidates.length === 1 && juanjoDirect.some((assignment) => assignment.userId === plantaCandidates[0].id),
    },
    nivel3Inheritance: inheritance,
    allNivel3Ok: inheritance.every((item) => item.ok),
  };
}

async function main() {
  const apply = flag("apply");
  const target = await connectTarget();
  try {
    const dateKey = todayArgentinaDateKey();
    if (!apply) {
      const result = await readOnly(target.prisma, async (tx) => ({
        identity: target.identity,
        plan: publicPlan(await buildPlan(tx, dateKey)),
        validation: await validateLive(tx, dateKey),
      }));
      console.log(JSON.stringify({ mode: "dry-run (sólo lectura)", host: target.host, ...result }, null, 2));
      return;
    }

    requireVerifiedIdentity(target.identity);
    if (target.identity.branchName !== "development") throw new Error(`La rama verificada es "${target.identity.branchName}", no "development". No se escribió nada.`);
    if (!flag("confirm-development")) throw new Error("Falta --confirm-development. No se escribió nada.");
    const backupPath = assertBackupPath(arg("backup"));

    const result = await target.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('time-responsible-hierarchy-reconcile', 0))");
      const plan = await buildPlan(tx, dateKey);
      const affectedEmployeeIds = Array.from(new Set(plan.legacy.map((item) => item.source.employeeId)));
      const snapshot = {
        format: "time-responsible-hierarchy-backup/v1",
        createdAt: new Date().toISOString(),
        identity: target.identity,
        host: target.host,
        plan: publicPlan(plan),
        assignments: await tx.employeeAssignment.findMany({ where: { employeeId: { in: affectedEmployeeIds }, type: "TIME_RESPONSIBLE" }, orderBy: { createdAt: "asc" } }),
        supervisions: await tx.userSupervisionAssignment.findMany({
          where: { supervisedUserId: { in: plan.legacy.map((item) => item.source.userId).filter((id): id is string => Boolean(id)) } },
          orderBy: { createdAt: "asc" },
        }),
      };
      const sha256 = persistBackup(backupPath, snapshot);
      const migrated = await applyPlan(tx, plan);
      const validation = await validateLive(tx, dateKey);
      if (!validation.juanjo992.visibleDirectly) throw new Error("La validación transaccional falló: Juanjo 992 no quedó visible directamente para el único usuario Planta Nivel 2.");
      if (!validation.allNivel3Ok) throw new Error("La validación transaccional falló: al menos un Nivel 3 no coincide con la unión de sus Nivel 2 activos.");
      return { plan: publicPlan(plan), migrated, validation, backup: { path: backupPath, sha256 } };
    }, { timeout: 120_000, maxWait: 30_000, isolationLevel: "Serializable" });
    console.log(JSON.stringify({ mode: "applied", branch: target.identity.branchName, production: false, ...result }, null, 2));
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
