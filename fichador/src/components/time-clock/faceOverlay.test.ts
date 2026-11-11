import { describe, expect, it } from "vitest";
import { FACE_MESH, faceBoxToView, meshFrame, normalizedFaceBox } from "./faceOverlay";

const box = (originX: number, originY: number, width: number, height: number) => ({ boundingBox: { originX, originY, width, height } });

describe("normalizedFaceBox", () => {
  it("sólo devuelve caja con exactamente un rostro", () => {
    expect(normalizedFaceBox([], 1280, 720)).toBeNull();
    expect(normalizedFaceBox([box(0, 0, 10, 10), box(20, 20, 10, 10)], 1280, 720)).toBeNull();
    expect(normalizedFaceBox([{}], 1280, 720)).toBeNull();
    expect(normalizedFaceBox([box(0, 0, 10, 10)], 0, 720)).toBeNull();
  });

  it("expresa la caja en fracciones del frame", () => {
    expect(normalizedFaceBox([box(320, 180, 640, 360)], 1280, 720)).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });
});

describe("faceBoxToView (object-fit: cover + espejo)", () => {
  it("sin recorte y sin espejo, la caja se conserva", () => {
    const view = faceBoxToView({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { width: 400, height: 300 }, { width: 800, height: 600 }, false);
    expect(view?.left).toBeCloseTo(10);
    expect(view?.top).toBeCloseTo(20);
    expect(view?.width).toBeCloseTo(30);
    expect(view?.height).toBeCloseTo(40);
  });

  it("el espejo refleja la posición horizontal", () => {
    const view = faceBoxToView({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { width: 400, height: 300 }, { width: 800, height: 600 });
    expect(view?.left).toBeCloseTo(60);
    expect(view?.top).toBeCloseTo(20);
  });

  it("video 16:9 en visor 4:3: compensa el recorte lateral", () => {
    // 1280×720 en 800×600: escala 600/720, ancho mostrado 1066,7 → 133,3 px recortados por lado.
    const view = faceBoxToView({ x: 0.5, y: 0.5, width: 0, height: 0 }, { width: 1280, height: 720 }, { width: 800, height: 600 }, false);
    expect(view?.left).toBeCloseTo(50);
    expect(view?.top).toBeCloseTo(50);
    const edge = faceBoxToView({ x: 0.125, y: 0, width: 0.75, height: 1 }, { width: 1280, height: 720 }, { width: 800, height: 600 }, false);
    expect(edge?.left).toBeCloseTo(0);
    expect(edge?.width).toBeCloseTo(100);
    expect(edge?.height).toBeCloseTo(100);
  });

  it("sin medidas no devuelve nada", () => {
    expect(faceBoxToView({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 0 }, { width: 10, height: 10 })).toBeNull();
  });
});

describe("malla decorativa", () => {
  it("se extiende hacia la frente y queda centrada en la caja", () => {
    const frame = meshFrame({ left: 40, top: 30, width: 20, height: 30 });
    expect(frame.left + frame.width / 2).toBeCloseTo(50);
    expect(frame.top).toBeLessThan(30);
    expect(frame.height).toBeGreaterThan(30);
  });

  it("tiene puntos dentro de 0–100 y aristas válidas", () => {
    expect(FACE_MESH.points.length).toBeGreaterThan(80);
    for (const [x, y] of FACE_MESH.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
    for (const [a, b] of FACE_MESH.edges) {
      expect(FACE_MESH.points[a]).toBeDefined();
      expect(FACE_MESH.points[b]).toBeDefined();
    }
  });
});
