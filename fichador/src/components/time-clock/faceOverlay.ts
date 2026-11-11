/**
 * «Biometric Future» — geometría de la capa visual de la captura. Sólo
 * presentación: no decide nada de la fichada ni de la validez del rostro (eso
 * sigue en statusForDetection(), con sus mismos umbrales).
 *
 * - `normalizedFaceBox`: caja del ÚNICO rostro que ya devolvió el detector,
 *   en fracciones del frame del video.
 * - `faceBoxToView`: lleva esa caja al visor, que muestra el video con
 *   `object-fit: cover` y espejado (scaleX(-1)), en % del visor.
 * - `FACE_MESH`: malla decorativa (puntos y aristas) en coordenadas 0–100 de
 *   la caja. No representa landmarks ni identidad: BlazeFace sólo entrega la
 *   caja y unos pocos puntos, y el sistema no reconoce personas.
 */

export type FaceBox = { x: number; y: number; width: number; height: number };
export type ViewBox = { left: number; top: number; width: number; height: number };

type DetectionLike = { boundingBox?: { originX: number; originY: number; width: number; height: number } };

export function normalizedFaceBox(detections: DetectionLike[], videoWidth: number, videoHeight: number): FaceBox | null {
  if (detections.length !== 1 || !videoWidth || !videoHeight) return null;
  const box = detections[0].boundingBox;
  if (!box || box.width <= 0 || box.height <= 0) return null;
  return { x: box.originX / videoWidth, y: box.originY / videoHeight, width: box.width / videoWidth, height: box.height / videoHeight };
}

export function faceBoxToView(box: FaceBox, video: { width: number; height: number }, view: { width: number; height: number }, mirrored = true): ViewBox | null {
  if (!video.width || !video.height || !view.width || !view.height) return null;
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const shownWidth = video.width * scale;
  const shownHeight = video.height * scale;
  const offsetX = (view.width - shownWidth) / 2;
  const offsetY = (view.height - shownHeight) / 2;
  const width = box.width * shownWidth;
  const height = box.height * shownHeight;
  const rawLeft = offsetX + box.x * shownWidth;
  const left = mirrored ? view.width - rawLeft - width : rawLeft;
  const top = offsetY + box.y * shownHeight;
  return {
    left: (left / view.width) * 100,
    top: (top / view.height) * 100,
    width: (width / view.width) * 100,
    height: (height / view.height) * 100,
  };
}

/**
 * La caja de BlazeFace va de las cejas al mentón: la malla se estira un poco
 * hacia la frente para cubrir el rostro completo.
 */
export function meshFrame(view: ViewBox): ViewBox {
  const width = view.width * 1.08;
  const height = view.height * 1.26;
  return { left: view.left - (width - view.width) / 2, top: view.top - view.height * 0.2, width, height };
}

type Point = [number, number];

function buildMesh() {
  const points: Point[] = [];
  const edges: [number, number][] = [];
  const cx = 50;
  const cy = 52;
  const rx = 48;
  const ry = 48;
  const rings = [
    { k: 0.2, n: 8 },
    { k: 0.42, n: 12 },
    { k: 0.62, n: 16 },
    { k: 0.8, n: 20 },
    { k: 0.96, n: 24 },
  ];
  const starts: { start: number; n: number }[] = [];
  rings.forEach((ring, ringIndex) => {
    const start = points.length;
    const offset = ringIndex % 2 ? Math.PI / ring.n : 0;
    for (let i = 0; i < ring.n; i += 1) {
      const angle = offset + (i / ring.n) * Math.PI * 2;
      const bulge = (1 - ring.k) * 0.06;
      points.push([cx + rx * ring.k * Math.cos(angle), cy + ry * ring.k * Math.sin(angle) - ry * bulge]);
    }
    for (let i = 0; i < ring.n; i += 1) edges.push([start + i, start + ((i + 1) % ring.n)]);
    starts.push({ start, n: ring.n });
  });
  for (let r = 0; r < starts.length - 1; r += 1) {
    const inner = starts[r];
    const outer = starts[r + 1];
    for (let i = 0; i < inner.n; i += 1) {
      const p = points[inner.start + i];
      const nearest = Array.from({ length: outer.n }, (_, j) => {
        const q = points[outer.start + j];
        return [Math.hypot(p[0] - q[0], p[1] - q[1]), outer.start + j] as const;
      }).sort((a, b) => a[0] - b[0]);
      edges.push([inner.start + i, nearest[0][1]], [inner.start + i, nearest[1][1]]);
    }
  }
  const feature = (fx: number, fy: number, frx: number, fry: number, n: number) => {
    const start = points.length;
    for (let i = 0; i < n; i += 1) {
      const angle = (i / n) * Math.PI * 2;
      points.push([cx + rx * fx + rx * frx * Math.cos(angle), cy + ry * fy + ry * fry * Math.sin(angle)]);
    }
    for (let i = 0; i < n; i += 1) edges.push([start + i, start + ((i + 1) % n)]);
  };
  feature(-0.36, -0.14, 0.15, 0.06, 6);
  feature(0.36, -0.14, 0.15, 0.06, 6);
  feature(0, 0.44, 0.26, 0.06, 8);
  const nose = points.length;
  ([[0, -0.12], [0, 0.04], [-0.1, 0.2], [0.1, 0.2]] as Point[]).forEach(([x, y]) => points.push([cx + rx * x, cy + ry * y]));
  edges.push([nose, nose + 1], [nose + 1, nose + 2], [nose + 1, nose + 3], [nose + 2, nose + 3]);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    points: points.map(([x, y]) => [round(x), round(y)] as Point),
    edges,
  };
}

export const FACE_MESH = buildMesh();
