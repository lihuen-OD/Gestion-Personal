import { describe, expect, it } from "vitest";
import type { ClockEmployee } from "../../services/api/timeClockApiService";
import { SEARCH_CACHE_TTL_MS, SEARCH_RESULT_LIMIT, createEmployeeSearchCache, dniSearchDigits } from "./employeeSearchCache";

const person = (id: string, lastName: string, firstName: string, dni: string | null): ClockEmployee => ({
  id,
  dni,
  firstName,
  lastName,
  name: `${lastName}, ${firstName}`,
});

const GOMEZ = person("1", "Gomez", "Ana", "30.123.456");
const GONZALEZ = person("2", "Gonzalez", "Juan Pablo", "12330999");
const DE_LA_FUENTE = person("3", "De la Fuente", "Ana María", "30 124 000");
const PEREZ = person("4", "Pérez", "Ana", "28-301-555");
const LAGOS = person("5", "Lagos", "Ana", "40000001");

function cacheWith(search: string, items: ClockEmployee[], clock = { now: 0 }) {
  const cache = createEmployeeSearchCache(() => clock.now);
  cache.store(search, items, cache.generation());
  return cache;
}

const ids = (items: ClockEmployee[] | undefined) => items?.map((item) => item.id);

describe("dniSearchDigits: mismo criterio que el backend", () => {
  it.each([
    ["30", "30"],
    ["32.401.118", "32401118"],
    ["30 12", "3012"],
    ["30-12", "3012"],
    ["  301 ", "301"],
  ])("%s → %s", (search, digits) => expect(dniSearchDigits(search)).toBe(digits));

  it.each(["3", "1.", "a30", "30a", "Gomez", "-."])("%s no es una búsqueda por DNI", (search) => expect(dniSearchDigits(search)).toBeNull());
});

describe("misma consulta", () => {
  it("se reutiliza tal cual, también recortando espacios y aunque haya venido con el máximo", () => {
    const full = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, index) => person(String(index), `Apellido${index}`, "Ana", String(30_000_000 + index)));
    const cache = cacheWith("ana", full);
    expect(cache.lookup("ana")).toBe(full);
    expect(cache.lookup("ana ")).toBe(full);
    expect(cache.lookup(" ana")).toBe(full);
  });

  it("DNI: separadores distintos con los mismos dígitos son la misma consulta, aunque haya venido con el máximo", () => {
    const full = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, index) => person(String(index), `Apellido${index}`, "Ana", `33.${index}00.000`));
    const cache = cacheWith("33", full);
    expect(cache.lookup("33.")).toBe(full);
    expect(cache.lookup("3-3")).toBe(full);
    expect(cache.lookup("33.3")).toBeUndefined();
  });

  it("nombre ASCII: mayúsculas distintas son la misma consulta; con comodines o no ASCII, sólo el texto idéntico", () => {
    const full = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, index) => person(String(index), `Gomez${index}`, "Ana", String(index)));
    const cache = cacheWith("Gom", full);
    expect(cache.lookup("gom")).toBe(full);
    expect(cache.lookup("GOM")).toBe(full);
    const wildcard = cacheWith("a_b", []);
    expect(wildcard.lookup("A_B")).toBeUndefined();
    expect(wildcard.lookup("a_b")).toEqual([]);
  });

  it("una consulta no ASCII también se reutiliza, pero sólo exacta", () => {
    const cache = cacheWith("Muñ", [person("9", "Muñoz", "Ana", "1")]);
    expect(ids(cache.lookup("Muñ"))).toEqual(["9"]);
    expect(cache.lookup("Muño")).toBeUndefined();
  });
});

describe("consulta más específica que una completa (nombre)", () => {
  it("filtra con la regla del backend, sin distinguir mayúsculas y conservando el orden", () => {
    const cache = cacheWith("go", [GOMEZ, GONZALEZ, LAGOS]);
    expect(ids(cache.lookup("gom"))).toEqual(["1"]);
    expect(ids(cache.lookup("GON"))).toEqual(["2"]);
    expect(ids(cache.lookup("gos"))).toEqual(["5"]);
    expect(ids(cache.lookup("goz"))).toEqual([]);
  });

  it("varias palabras: cada palabra en el nombre o el apellido, en cualquier orden", () => {
    const cache = cacheWith("ana", [GOMEZ, DE_LA_FUENTE, PEREZ, LAGOS]);
    expect(ids(cache.lookup("ana gom"))).toEqual(["1"]);
    expect(ids(cache.lookup("gomez ana"))).toEqual(["1"]);
    expect(ids(cache.lookup("ana mar"))).toEqual(["3"]);
    expect(ids(cache.lookup("ana mar fuen"))).toEqual(["3"]);
    expect(ids(cache.lookup("ana  lagos"))).toEqual(["5"]);
  });

  it("apellidos y nombres compuestos: el texto entero o cada palabra", () => {
    const cache = cacheWith("de", [DE_LA_FUENTE]);
    expect(ids(cache.lookup("de la f"))).toEqual(["3"]);
    expect(ids(cache.lookup("de la fuente"))).toEqual(["3"]);
    expect(ids(cache.lookup("de ana"))).toEqual(["3"]);
    const juanPablo = cacheWith("pab", [GONZALEZ]);
    expect(ids(juanPablo.lookup("juan pab"))).toEqual(["2"]);
  });

  it("las tildes cuentan igual que en ILIKE: 'per' no encuentra 'Pérez' y 'pér' va al backend", () => {
    const cache = cacheWith("pe", [PEREZ]);
    expect(ids(cache.lookup("per"))).toEqual([]);
    expect(cache.lookup("pér")).toBeUndefined();
    // "rez" no contiene a "pe": no es más específica, va al backend.
    expect(cache.lookup("rez")).toBeUndefined();
  });

  it("también sirve una consulta que contiene a la anterior en otro lugar", () => {
    const cache = cacheWith("ez", [GOMEZ, GONZALEZ, PEREZ]);
    expect(ids(cache.lookup("mez"))).toEqual(["1"]);
    expect(ids(cache.lookup("alez"))).toEqual(["2"]);
  });

  it("una respuesta con el máximo de resultados pudo ser incompleta: nunca se filtra", () => {
    const full = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, index) => person(String(index), `Gomez${index}`, "Ana", String(index)));
    expect(cacheWith("go", full).lookup("gom")).toBeUndefined();
    expect(cacheWith("go", full.slice(1)).lookup("gom")).toHaveLength(SEARCH_RESULT_LIMIT - 1);
  });

  it("una consulta menos específica o distinta va al backend", () => {
    const cache = cacheWith("gom", [GOMEZ]);
    expect(cache.lookup("go")).toBeUndefined();
    expect(cache.lookup("gon")).toBeUndefined();
    expect(cache.lookup("go m")).toBeUndefined();
  });

  it("comodines de LIKE en la consulta: siempre al backend", () => {
    const cache = cacheWith("a", [GOMEZ, LAGOS]);
    expect(cache.lookup("a_")).toBeUndefined();
    expect(cache.lookup("a%")).toBeUndefined();
    expect(cache.lookup("a\\")).toBeUndefined();
  });

  it("un candidato con caracteres fuera de los habituales anula el filtrado local", () => {
    // K (signo Kelvin, U+212A) y nombres en NFD: su minúscula o su forma
    // dependen de la configuración regional de la base.
    expect(cacheWith("an", [GOMEZ, person("8", "Kaplan", "Ana", "1")]).lookup("ana")).toBeUndefined();
    expect(cacheWith("jo", [person("7", "Paz", "José", "2")]).lookup("jos")).toBeUndefined();
    expect(cacheWith("an", [GOMEZ, PEREZ]).lookup("ana")).toHaveLength(2);
  });
});

describe("consulta más específica que una completa (DNI)", () => {
  it("dígitos que contienen a los anteriores, con o sin separadores en lo escrito y en lo guardado", () => {
    const cache = cacheWith("30", [GOMEZ, GONZALEZ, DE_LA_FUENTE, PEREZ, LAGOS]);
    // 30123456, 12330999, 30124000, 28301555, 40000001
    expect(ids(cache.lookup("301"))).toEqual(["1", "3", "4"]);
    expect(ids(cache.lookup("30.12"))).toEqual(["1", "3"]);
    expect(ids(cache.lookup("30 124"))).toEqual(["3"]);
    expect(ids(cache.lookup("2330"))).toEqual(["2"]);
    expect(ids(cache.lookup("8-30"))).toEqual(["4"]);
    expect(ids(cache.lookup("300"))).toEqual([]);
    // No contiene "30": va al backend.
    expect(cache.lookup("4000")).toBeUndefined();
  });

  it("subcadena en cualquier posición del DNI", () => {
    const cache = cacheWith("23", [GOMEZ, GONZALEZ]);
    expect(ids(cache.lookup("1234"))).toEqual(["1"]);
    expect(ids(cache.lookup("233"))).toEqual(["2"]);
  });

  it("no mezcla DNI con nombre", () => {
    const dni = cacheWith("30", [GOMEZ]);
    expect(dni.lookup("30a")).toBeUndefined();
    const name = cacheWith("1.", []);
    expect(name.lookup("1.2")).toBeUndefined();
  });

  it("un DNI nulo (contrato anterior) nunca coincide", () => {
    expect(ids(cacheWith("30", [person("6", "Sin", "Dni", null), GOMEZ]).lookup("301"))).toEqual(["1"]);
  });
});

describe("vigencia y reinicio", () => {
  it("vence a los 60 s", () => {
    const clock = { now: 0 };
    const cache = cacheWith("go", [GOMEZ], clock);
    clock.now = SEARCH_CACHE_TTL_MS - 1;
    expect(cache.lookup("gom")).toBeDefined();
    clock.now = SEARCH_CACHE_TTL_MS;
    expect(cache.lookup("gom")).toBeUndefined();
    expect(cache.lookup("go")).toBeUndefined();
  });

  it("clear() lo vacía y descarta respuestas pedidas antes de limpiar", () => {
    const cache = createEmployeeSearchCache(() => 0);
    const before = cache.generation();
    cache.store("go", [GOMEZ], before);
    cache.clear();
    expect(cache.lookup("go")).toBeUndefined();
    cache.store("go", [GOMEZ], before);
    expect(cache.lookup("go")).toBeUndefined();
    cache.store("go", [GOMEZ], cache.generation());
    expect(cache.lookup("go")).toBeDefined();
  });
});
