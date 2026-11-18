import type { ClockEmployee } from "../../services/api/timeClockApiService";

/**
 * §33 del plan del fichador: caché de búsquedas SÓLO en memoria (nunca
 * localStorage, sessionStorage ni IndexedDB; el DNI no se persiste). Evita
 * pedirle al backend una búsqueda cuyo resultado ya se conoce con certeza:
 *
 * 1. la MISMA consulta para el backend (los mismos dígitos de DNI, o el mismo
 *    nombre sin distinguir mayúsculas), dentro del TTL;
 * 2. una consulta MÁS ESPECÍFICA que una anterior COMPLETA del mismo tipo:
 *    el resultado del backend es un subconjunto del anterior, así que se
 *    obtiene filtrándolo con la MISMA regla del backend y en su mismo orden.
 *
 * Una respuesta es completa sólo si trae menos de SEARCH_RESULT_LIMIT
 * resultados: con el máximo pudo haber quedado gente afuera, y nunca se
 * reutiliza para otra consulta (no hay falsos negativos).
 *
 * Regla del backend (timeEntries.repository.ts → searchEmployeesForClock y
 * clockDniSearchDigits), replicada acá:
 * - DNI: sólo dígitos y separadores (puntos, espacios, guiones) con al menos
 *   2 dígitos. Coincide si el DNI sin lo que no es dígito contiene esos
 *   dígitos. "301" ⊂ "30" porque contener "301" implica contener "30".
 * - Nombre: el texto contenido (sin distinguir mayúsculas) en el nombre o en
 *   el apellido, o, con 2+ palabras, cada palabra en el nombre o el apellido.
 *   Si la consulta anterior está contenida en la nueva, todo lo que coincide
 *   con la nueva coincidía con la anterior.
 *
 * Equivalencia exacta con PostgreSQL (ILIKE): el filtrado local sólo se usa
 * cuando no depende de la configuración regional de la base:
 * - la consulta es ASCII y sin los comodines de LIKE (`%`, `_`, `\`);
 * - los nombres candidatos sólo tienen ASCII o letras latinas acentuadas
 *   habituales (áéíóúüñ…), cuyas minúsculas nunca son ASCII en ninguna
 *   configuración: una consulta ASCII sólo puede coincidir en las posiciones
 *   ASCII, y ahí A-Z → a-z es igual en PostgreSQL y en JavaScript.
 * Fuera de eso (p. ej. "Muñ" o un nombre con caracteres raros) se consulta
 * al backend como siempre.
 */

/** Máximo de resultados del backend (CLOCK_SEARCH_LIMIT). */
export const SEARCH_RESULT_LIMIT = 12;
/** Vigencia de una respuesta: la persona que busca, no el padrón del día. */
export const SEARCH_CACHE_TTL_MS = 60_000;
/** Mínimo de dígitos de una búsqueda por DNI (CLOCK_SEARCH_MIN_LENGTH). */
const MIN_DNI_DIGITS = 2;
const MAX_ENTRIES = 30;

/** Igual que clockDniSearchDigits del backend (mismo código, mismo motor de expresiones). */
export function dniSearchDigits(search: string): string | null {
  const trimmed = search.trim();
  if (!/^[\d.\s-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= MIN_DNI_DIGITS ? digits : null;
}

// Letras latinas acentuadas habituales en nombres (mayúsculas y minúsculas).
const SAFE_NAME = /^[\x20-\x7EáéíóúüñàèìòùâêîôûäëïöçãõÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇÃÕ]*$/;
const SAFE_QUERY = /^[\x20-\x7E]*$/;
const LIKE_WILDCARDS = /[%_\\]/;

const asciiLower = (value: string) => value.replace(/[A-Z]/g, (char) => char.toLowerCase());

type Query =
  | { kind: "dni"; text: string; digits: string }
  | { kind: "name"; text: string; folded: string; localSafe: boolean };

/**
 * Lo que el backend realmente consulta: los dígitos de un DNI ("33" y "33."
 * son la misma consulta) y, para un nombre ASCII sin comodines, el texto sin
 * distinguir mayúsculas ("Ana" y "ana"). Dos consultas con la misma clave
 * tienen la misma respuesta, aunque haya venido con el máximo de resultados.
 */
function exactKey(query: Query) {
  if (query.kind === "dni") return `dni:${query.digits}`;
  return query.localSafe ? `name:${query.folded}` : `raw:${query.text}`;
}

function parseQuery(search: string): Query {
  const text = search.trim();
  const digits = dniSearchDigits(text);
  if (digits) return { kind: "dni", text, digits };
  return { kind: "name", text, folded: asciiLower(text), localSafe: SAFE_QUERY.test(text) && !LIKE_WILDCARDS.test(text) };
}

/** Regla de nombre del backend sobre una consulta ASCII (ver arriba). */
function nameMatches(employee: ClockEmployee, query: string) {
  const firstName = asciiLower(employee.firstName);
  const lastName = asciiLower(employee.lastName);
  const folded = asciiLower(query);
  if (firstName.includes(folded) || lastName.includes(folded)) return true;
  const words = query.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((word) => {
    const foldedWord = asciiLower(word);
    return firstName.includes(foldedWord) || lastName.includes(foldedWord);
  });
}

function dniMatches(employee: ClockEmployee, digits: string) {
  return employee.dni !== null && employee.dni.replace(/[^0-9]/g, "").includes(digits);
}

type Entry = {
  query: Query;
  items: ClockEmployee[];
  storedAt: number;
  /** Menos del máximo: es el conjunto completo de coincidencias. */
  complete: boolean;
  /** Todos los nombres admiten el filtrado local exacto. */
  namesSafe: boolean;
};

function refines(next: Query, base: Entry): boolean {
  if (!base.complete) return false;
  if (next.kind === "dni" && base.query.kind === "dni") return next.digits.includes(base.query.digits);
  if (next.kind === "name" && base.query.kind === "name") {
    return next.localSafe && base.query.localSafe && base.namesSafe && next.folded.includes(base.query.folded);
  }
  return false;
}

export type EmployeeSearchCache = {
  /** El resultado que daría el backend, si se conoce con certeza. */
  lookup(search: string): ClockEmployee[] | undefined;
  /** Guarda la respuesta de una consulta, salvo que se haya limpiado después de pedirla. */
  store(search: string, items: ClockEmployee[], generation: number): void;
  /** Generación vigente: una respuesta pedida antes de `clear()` no se guarda. */
  generation(): number;
  clear(): void;
};

export function createEmployeeSearchCache(now: () => number = Date.now): EmployeeSearchCache {
  let entries: Entry[] = [];
  let currentGeneration = 0;

  const fresh = () => {
    const limit = now() - SEARCH_CACHE_TTL_MS;
    entries = entries.filter((entry) => entry.storedAt > limit);
    return entries;
  };

  return {
    lookup(search) {
      const query = parseQuery(search);
      const candidates = fresh();
      const key = exactKey(query);
      const exact = candidates.find((entry) => exactKey(entry.query) === key);
      if (exact) return exact.items;
      // La base más específica que sirve: la de menos resultados.
      const base = candidates.filter((entry) => refines(query, entry)).sort((a, b) => a.items.length - b.items.length)[0];
      if (!base) return undefined;
      return query.kind === "dni"
        ? base.items.filter((employee) => dniMatches(employee, query.digits))
        : base.items.filter((employee) => nameMatches(employee, query.text));
    },
    store(search, items, generation) {
      if (generation !== currentGeneration) return;
      const query = parseQuery(search);
      const kept = fresh().filter((entry) => exactKey(entry.query) !== exactKey(query));
      kept.push({
        query,
        items,
        storedAt: now(),
        complete: items.length < SEARCH_RESULT_LIMIT,
        namesSafe: items.every((employee) => SAFE_NAME.test(employee.firstName) && SAFE_NAME.test(employee.lastName)),
      });
      entries = kept.slice(-MAX_ENTRIES);
    },
    generation: () => currentGeneration,
    clear() {
      entries = [];
      currentGeneration += 1;
    },
  };
}
