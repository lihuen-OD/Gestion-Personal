import { FACE_MESH, meshFrame, type ViewBox } from "./faceOverlay";

/**
 * «Biometric Future» — capa visual del visor. Todo es decorativo (aria-hidden)
 * y sin texto: la única señal escrita del estado es el panel de estado de la
 * captura. Sale del estado REAL: la fase de la cámara, si el detector ya
 * confirmó un rostro válido y la caja del único rostro detectado. Nunca afirma
 * una identidad: el sistema detecta un rostro y toma una foto.
 *
 * La geometría de marcos, marcas y barrido usa las mismas variables que
 * .face-guide (screens/capture.css), así que acompaña la región que valida
 * statusForDetection() sin duplicarla.
 */
export type CapturePhase = "preparing" | "live" | "off" | "submitting";

// La malla se arma una sola vez: sólo se mueve su contenedor.
const MESH_SVG = (
  <svg className="face-mesh-svg" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
    <g className="face-mesh-lines">
      {FACE_MESH.edges.map(([a, b], index) => (
        <line key={index} x1={FACE_MESH.points[a][0]} y1={FACE_MESH.points[a][1]} x2={FACE_MESH.points[b][0]} y2={FACE_MESH.points[b][1]} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
    <g className="face-mesh-dots">
      {FACE_MESH.points.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r={0.75} />
      ))}
    </g>
  </svg>
);


export function FaceHud({ phase, view }: { phase: CapturePhase; view: ViewBox | null }) {
  const mesh = view ? meshFrame(view) : null;
  return (
    <>
      <div className="face-hud" aria-hidden="true">
        <svg className="face-hud-ticks" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <ellipse cx="50" cy="50" rx="56" ry="54" pathLength={96} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="face-hud-scan"><span className="face-hud-sweep" /></span>
        <span className="face-hud-corner is-tl" />
        <span className="face-hud-corner is-tr" />
        <span className="face-hud-corner is-bl" />
        <span className="face-hud-corner is-br" />
      </div>
      {mesh ? (
        // Posición calculada en cada detección (≈ 220 ms); se aplica por CSSOM, compatible con la CSP.
        <div className="face-mesh" aria-hidden="true" style={{ left: `${mesh.left}%`, top: `${mesh.top}%`, width: `${mesh.width}%`, height: `${mesh.height}%` }}>
          {MESH_SVG}
        </div>
      ) : null}
      {phase === "submitting" ? <span className="face-busy" aria-hidden="true"><span /></span> : null}
    </>
  );
}
