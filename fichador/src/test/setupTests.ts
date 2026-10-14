import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// F9: el Gate manda heartbeats en segundo plano. Ningún test unitario sale a
// la red: un fetch que el test no stubbeó falla como "sin conexión" (igual que
// un backend apagado) en vez de llegar a un backend real en localhost. Un test
// que necesita respuestas propias hace su propio vi.stubGlobal("fetch", ...).
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch sin stub en un test unitario"))));
});

afterEach(() => {
  cleanup();
});
