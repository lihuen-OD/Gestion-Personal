/**
 * Repara descripciones históricas de AuditLog que muestran un id técnico
 * (UUID) en vez de la identidad humana. Sólo reescribe familias conocidas y
 * obviamente incorrectas cuyo dato real se puede resolver sin ambigüedad
 * (UUID del texto == employeeId/userId del propio evento, y la entidad
 * existe). Todo lo demás queda como está y se reporta.
 *
 *   npm run staging:audit:technical-ids                       (dry-run)
 *   npm run staging:audit:technical-ids -- --report=<archivo.json>   (dry-run + todas las propuestas)
 *   npm run staging:audit:technical-ids:apply -- --backup=<archivo.json>
 *
 * --apply escribe antes un backup {id, description} de cada fila a tocar y
 * actualiza en una sola transacción, sólo si la descripción no cambió desde
 * la lectura. Nunca toca entityId/before/after.
 */
import { writeFileSync } from "node:fs";
import { env } from "../src/config/env";
import { prisma } from "../src/shared/prisma/client";
import { formatArgentinaDate } from "../src/shared/datetime/argentinaTime";
import { formatEmployeeReference, employeeReferenceSelect } from "../src/shared/audit/employeeReference";
import { containsTechnicalId, describeRequestPath } from "../src/shared/audit/technicalIds";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_GLOBAL = new RegExp(UUID, "gi");

type AuditRow = { id: string; entity: string; action: string; entityId: string | null; userId: string | null; description: string; before: unknown; after: unknown };
type Lookups = { employees: Map<string, string>; hourConcepts: Map<string, { code: string; name: string }> };
type Outcome = { repaired: string } | { skipped: string };

function jsonField(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

// El UUID del texto tiene que coincidir con el employeeId del propio evento
// (cuando el evento lo guarda) y con un Employee real.
function employeeReference(row: AuditRow, employeeId: string, lookups: Lookups, jsonEmployeeIds: unknown[]) {
  const recorded = jsonEmployeeIds.filter((value): value is string => typeof value === "string");
  if (recorded.some((value) => value.toLowerCase() !== employeeId.toLowerCase())) return null;
  return lookups.employees.get(employeeId.toLowerCase()) ?? null;
}

const rules: Array<{ name: string; matches: (row: AuditRow) => boolean; repair: (row: AuditRow, lookups: Lookups) => Outcome }> = [
  {
    name: "HourConceptBreakdown manual: 'para el legajo <employeeId>'",
    matches: (row) => row.entity === "HourConceptBreakdown" && new RegExp(` para el legajo ${UUID}\\.$`, "i").test(row.description),
    repair: (row, lookups) => {
      const employeeId = row.description.match(new RegExp(`(${UUID})\\.$`, "i"))![1]!;
      const reference = employeeReference(row, employeeId, lookups, [jsonField(row.after, "employeeId")]);
      if (!reference) return { skipped: "empleado no resoluble o distinto del registrado" };
      return { repaired: row.description.replace(new RegExp(` para el legajo ${UUID}\\.$`, "i"), ` para ${reference}.`) };
    },
  },
  {
    name: "EmployeeHourConcept: 'Se quitó el concepto horario del empleado <employeeId>'",
    matches: (row) => row.entity === "EmployeeHourConcept" && new RegExp(`^Se quitó el concepto horario del empleado ${UUID}\\.$`, "i").test(row.description),
    repair: (row, lookups) => {
      const employeeId = row.description.match(new RegExp(`(${UUID})\\.$`, "i"))![1]!;
      if (jsonField(row.before, "hourConceptId") !== row.entityId) return { skipped: "el before no corresponde al concepto del evento" };
      const reference = employeeReference(row, employeeId, lookups, [jsonField(row.before, "employeeId")]);
      if (!reference) return { skipped: "empleado no resoluble o distinto del registrado" };
      // Mismo texto que hourConceptsService.disableEmployee (nombre del concepto).
      const concept = row.entityId ? lookups.hourConcepts.get(row.entityId.toLowerCase()) : undefined;
      return { repaired: `Se quitó el concepto horario ${concept ? `${concept.name} ` : ""}de ${reference}.` };
    },
  },
  {
    name: "MonthlyTimeClosure / TimeCorrectionRequest: '(legajo <employeeId>...)'",
    matches: (row) => ["MonthlyTimeClosure", "TimeCorrectionRequest"].includes(row.entity) && new RegExp(`\\(legajo ${UUID}[,)]`, "i").test(row.description),
    repair: (row, lookups) => {
      const employeeId = row.description.match(new RegExp(`\\(legajo (${UUID})`, "i"))![1]!;
      const reference = employeeReference(row, employeeId, lookups, [jsonField(row.before, "employeeId"), jsonField(row.after, "employeeId")]);
      if (!reference) return { skipped: "empleado no resoluble o distinto del registrado" };
      return {
        repaired: row.description
          .replace(new RegExp(` \\(legajo ${UUID}, (de [^)]+)\\)`, "i"), ` de ${reference} ($1)`)
          .replace(new RegExp(` \\(legajo ${UUID}\\)`, "i"), ` de ${reference}`),
      };
    },
  },
  {
    name: "HourConceptRule: 'del concepto <hourConceptId>'",
    matches: (row) => row.entity === "HourConceptRule" && new RegExp(`del concepto ${UUID}\\.$`, "i").test(row.description),
    repair: (row, lookups) => {
      const hourConceptId = row.description.match(new RegExp(`(${UUID})\\.$`, "i"))![1]!;
      const recorded = jsonField(row.after, "hourConceptId");
      if (typeof recorded === "string" && recorded.toLowerCase() !== hourConceptId.toLowerCase()) return { skipped: "concepto distinto del registrado" };
      const concept = lookups.hourConcepts.get(hourConceptId.toLowerCase());
      if (!concept) return { skipped: "el concepto ya no existe (eliminado definitivamente)" };
      return { repaired: row.description.replace(new RegExp(`del concepto ${UUID}\\.$`, "i"), `del concepto ${concept.code} - ${concept.name}.`) };
    },
  },
  {
    name: "TimeEntry reconciliación 15M.4: '(duplicado de <timeEntryId>)'",
    matches: (row) => row.entity === "TimeEntry" && new RegExp(`^Reconciliación histórica 15M\\.4: retirada de cómputo \\(duplicado de ${UUID}\\)$`, "i").test(row.description),
    // El after es la carga retirada completa (id == entityId): de ahí salen
    // persona y fecha, el id de la canónica no hace falta.
    repair: (row, lookups) => {
      const employeeId = jsonField(row.after, "employeeId");
      const date = jsonField(row.after, "date");
      if (jsonField(row.after, "id") !== row.entityId) return { skipped: "el after no es la carga del evento" };
      if (typeof employeeId !== "string" || typeof date !== "string") return { skipped: "el after no tiene empleado/fecha" };
      const reference = lookups.employees.get(employeeId.toLowerCase());
      if (!reference) return { skipped: "empleado no resoluble" };
      return { repaired: `Reconciliación histórica 15M.4: retirada de cómputo de una carga duplicada del ${formatArgentinaDate(date)} de ${reference}.` };
    },
  },
  {
    name: "Route (acceso denegado): '— usuario <userId>' e ids en la ruta",
    matches: (row) => row.entity === "Route" && row.description.startsWith("Acceso denegado: "),
    repair: (row) => {
      const actor = row.description.match(new RegExp(` — usuario (${UUID}), rol `, "i"));
      if (actor && actor[1]!.toLowerCase() !== row.userId?.toLowerCase()) return { skipped: "el usuario del texto no es el userId del evento" };
      return { repaired: describeRequestPath(row.description.replace(new RegExp(` — usuario ${UUID}, rol `, "i"), " — rol ")) };
    },
  },
];

async function main() {
  if (env.APP_ENV !== "staging") throw new Error(`Refusing audit description repair in APP_ENV=${env.APP_ENV}`);
  const apply = process.argv.includes("--apply");
  const backupPath = process.argv.find((arg) => arg.startsWith("--backup="))?.slice("--backup=".length);
  const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
  if (apply && !backupPath) throw new Error("--apply requiere --backup=<archivo.json>");

  const rows = await prisma.$queryRaw<AuditRow[]>`
    SELECT id, entity, action::text AS action, "entityId", "userId", description, before, after
    FROM "AuditLog"
    WHERE description ~* ${UUID}
    ORDER BY "createdAt" ASC`;

  // Lecturas en lote: una consulta por tabla para todos los UUID del texto.
  const textIds = Array.from(new Set(rows.flatMap((row) => row.description.match(UUID_GLOBAL) ?? []).map((id) => id.toLowerCase())));
  const jsonEmployeeIds = rows
    .flatMap((row) => [jsonField(row.before, "employeeId"), jsonField(row.after, "employeeId")])
    .filter((id): id is string => typeof id === "string");
  const [employees, hourConcepts] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: [...textIds, ...jsonEmployeeIds] } }, select: { id: true, ...employeeReferenceSelect } }),
    prisma.hourConcept.findMany({ where: { id: { in: [...textIds, ...rows.flatMap((row) => (row.entityId ? [row.entityId] : []))] } }, select: { id: true, code: true, name: true } }),
  ]);
  const lookups: Lookups = {
    employees: new Map(employees.map((employee) => [employee.id.toLowerCase(), formatEmployeeReference(employee)])),
    hourConcepts: new Map(hourConcepts.map((concept) => [concept.id.toLowerCase(), concept])),
  };

  const repairs: Array<{ id: string; rule: string; before: string; after: string }> = [];
  const skipped: Array<{ id: string; rule: string; reason: string; description: string }> = [];
  for (const row of rows) {
    const rule = rules.find((candidate) => candidate.matches(row));
    if (!rule) {
      skipped.push({ id: row.id, rule: "(sin regla)", reason: "familia no reconocida — no se reescribe", description: row.description });
      continue;
    }
    const outcome = rule.repair(row, lookups);
    if ("skipped" in outcome) skipped.push({ id: row.id, rule: rule.name, reason: outcome.skipped, description: row.description });
    else if (containsTechnicalId(outcome.repaired)) skipped.push({ id: row.id, rule: rule.name, reason: "la reparación todavía tendría un id", description: row.description });
    else repairs.push({ id: row.id, rule: rule.name, before: row.description, after: outcome.repaired });
  }

  const countBy = <T extends { rule: string }>(items: T[]) => items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item.rule]: (acc[item.rule] ?? 0) + 1 }), {});
  console.log(JSON.stringify({
    appEnv: env.APP_ENV,
    mode: apply ? "apply" : "dry-run",
    affected: rows.length,
    repairable: repairs.length,
    skipped: skipped.length,
    repairableByRule: countBy(repairs),
    skippedByRule: countBy(skipped),
    skippedDetail: skipped,
    sample: Object.values(repairs.reduce<Record<string, (typeof repairs)[number]>>((acc, item) => ({ [item.rule]: item, ...acc }), {})),
  }, null, 2));
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ repairs, skipped }, null, 2));
  if (!apply || !repairs.length) return;

  writeFileSync(backupPath!, JSON.stringify(repairs.map(({ id, before }) => ({ id, description: before })), null, 2));
  const results = await prisma.$transaction(repairs.map((repair) =>
    prisma.auditLog.updateMany({ where: { id: repair.id, description: repair.before }, data: { description: repair.after } }),
  ));
  const updated = results.reduce((total, result) => total + result.count, 0);
  console.log(JSON.stringify({ updated, backup: backupPath, unchangedSinceRead: updated === repairs.length }));
  if (updated !== repairs.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
