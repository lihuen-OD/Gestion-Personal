import { describe, expect, it } from "vitest";
import { runInBatches } from "./runInBatches";

describe("runInBatches — Etapa 14E.1", () => {
  it("devuelve los resultados en el mismo orden que las tareas, sin importar el orden de resolución real", async () => {
    const tasks = [
      () => new Promise<number>((resolve) => setTimeout(() => resolve(1), 30)),
      () => new Promise<number>((resolve) => setTimeout(() => resolve(2), 10)),
      () => new Promise<number>((resolve) => setTimeout(() => resolve(3), 20)),
    ];

    const results = await runInBatches(tasks, 3);

    expect(results).toEqual([1, 2, 3]);
  });

  it("nunca corre más de `batchSize` tareas en simultáneo", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const makeTask = (value: number) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return value;
    };
    const tasks = Array.from({ length: 14 }, (_, index) => makeTask(index));

    const results = await runInBatches(tasks, 5);

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(results).toEqual(Array.from({ length: 14 }, (_, index) => index));
  });

  it("no arranca el siguiente lote hasta que el anterior termine (concurrencia real, no sólo un límite nominal)", async () => {
    const order: string[] = [];
    const tasks = [
      async () => { order.push("a-start"); await new Promise((r) => setTimeout(r, 20)); order.push("a-end"); return "a"; },
      async () => { order.push("b-start"); await new Promise((r) => setTimeout(r, 20)); order.push("b-end"); return "b"; },
      async () => { order.push("c-start"); await new Promise((r) => setTimeout(r, 5)); order.push("c-end"); return "c"; },
    ];

    await runInBatches(tasks, 2);

    // Lote 1 = [a, b] corre junto; "c" (lote 2) no debe arrancar hasta que
    // termine el lote 1 completo (a-end y b-end antes que c-start).
    expect(order.indexOf("c-start")).toBeGreaterThan(order.indexOf("a-end"));
    expect(order.indexOf("c-start")).toBeGreaterThan(order.indexOf("b-end"));
  });

  it("si una tarea rechaza, el error se propaga (no se traga silenciosamente)", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.reject(new Error("boom")),
      () => Promise.resolve(3),
    ];

    await expect(runInBatches(tasks, 2)).rejects.toThrow("boom");
  });

  it("con batchSize mayor o igual a la cantidad de tareas, se comporta igual que Promise.all", async () => {
    const tasks = [() => Promise.resolve("x"), () => Promise.resolve("y")];

    const results = await runInBatches(tasks, 10);

    expect(results).toEqual(["x", "y"]);
  });

  it("array vacío devuelve array vacío sin ejecutar nada", async () => {
    const results = await runInBatches([], 5);
    expect(results).toEqual([]);
  });

  it.each([0, -1, -5])("batchSize=%i lanza un error claro en vez de colgarse en un loop infinito", async (batchSize) => {
    await expect(runInBatches([() => Promise.resolve(1)], batchSize)).rejects.toThrow(/batchSize debe ser un entero positivo/);
  });

  it("batchSize no entero (2.5) lanza el mismo error explícito", async () => {
    await expect(runInBatches([() => Promise.resolve(1)], 2.5)).rejects.toThrow(/batchSize debe ser un entero positivo/);
  });

  it("batchSize inválido con array vacío también lanza (no depende de la cantidad de tareas)", async () => {
    await expect(runInBatches([], 0)).rejects.toThrow(/batchSize debe ser un entero positivo/);
  });
});
