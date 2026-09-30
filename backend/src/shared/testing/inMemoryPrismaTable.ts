// Fake mínimo de `findMany`/`count` de Prisma para tests de listados
// paginados. Existe para probar que un repositorio compone WHERE → ORDER BY →
// OFFSET/LIMIT en la MISMA consulta (el orden se aplica al dataset filtrado
// completo, no a una página ya cortada) sin una base real — CI no tiene
// Postgres (ver .github/workflows/ci.yml). Emula la semántica de Postgres que
// importa para paginar:
// - strings comparados byte a byte (collation "C.UTF-8" de la base real);
// - NULL se ordena último en ASC y primero en DESC, salvo `nulls` explícito;
// - orderBy en relación to-one (`{ costCenter: { name: "asc" } }`).
// Soporta sólo los operadores de `where` que usan los tests; cualquier otro
// falla explícitamente en vez de ignorarse en silencio.

type Row = Record<string, unknown>;
type Order = "asc" | "desc";
type OrderSpec = Order | { sort: Order; nulls?: "first" | "last" } | Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

function matchesField(value: unknown, condition: unknown): boolean {
  if (!isPlainObject(condition)) return value === condition;
  if ("contains" in condition) {
    const needle = String(condition.contains);
    const haystack = value == null ? "" : String(value);
    return condition.mode === "insensitive" ? haystack.toLowerCase().includes(needle.toLowerCase()) : haystack.includes(needle);
  }
  if ("equals" in condition) return value === condition.equals;
  if ("in" in condition) return (condition.in as unknown[]).includes(value);
  if ("not" in condition) return value !== condition.not;
  // Relación to-one: `{ category: { name: ... } }`.
  if (isPlainObject(value)) return matchesWhere(value, condition);
  throw new Error(`inMemoryPrismaTable: condición no soportada ${JSON.stringify(condition)}`);
}

export function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === "AND") return (condition as Record<string, unknown>[]).every((part) => matchesWhere(row, part));
    if (key === "OR") return (condition as Record<string, unknown>[]).some((part) => matchesWhere(row, part));
    return matchesField(row[key], condition);
  });
}

function compareValues(a: unknown, b: unknown, spec: OrderSpec): number {
  const order: Order = typeof spec === "string" ? spec : (spec.sort as Order);
  const nulls = typeof spec === "string" ? (order === "asc" ? "last" : "first") : ((spec.nulls as "first" | "last" | undefined) ?? (order === "asc" ? "last" : "first"));
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) {
    if (aNull && bNull) return 0;
    return (aNull ? 1 : -1) * (nulls === "last" ? 1 : -1);
  }
  const left = a instanceof Date ? a.getTime() : (a as string | number);
  const right = b instanceof Date ? b.getTime() : (b as string | number);
  const result = left < right ? -1 : left > right ? 1 : 0;
  return order === "asc" ? result : -result;
}

function compareRows(a: Row, b: Row, orderBy: Record<string, OrderSpec>[]): number {
  for (const clause of orderBy) {
    const entry = Object.entries(clause)[0];
    if (!entry) continue;
    const [field, spec] = entry;
    const isRelation = isPlainObject(spec) && !("sort" in spec);
    const result = isRelation
      ? compareRows((a[field] as Row) ?? {}, (b[field] as Row) ?? {}, [spec as Record<string, OrderSpec>])
      : compareValues(a[field], b[field], spec);
    if (result !== 0) return result;
  }
  return 0;
}

export function createInMemoryPrismaTable(rows: Row[]) {
  const filter = (where?: Record<string, unknown>) => rows.filter((row) => matchesWhere(row, where));
  return {
    async findMany(args: { where?: Record<string, unknown>; orderBy?: Record<string, OrderSpec> | Record<string, OrderSpec>[]; skip?: number; take?: number }) {
      const orderBy = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : [];
      const sorted = [...filter(args.where)].sort((a, b) => compareRows(a, b, orderBy));
      const skip = args.skip ?? 0;
      return sorted.slice(skip, args.take === undefined ? undefined : skip + args.take);
    },
    async count(args: { where?: Record<string, unknown> } = {}) {
      return filter(args.where).length;
    },
  };
}
