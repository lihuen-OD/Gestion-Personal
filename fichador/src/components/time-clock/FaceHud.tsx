import { Check } from "lucide-react";
import { FACE_MESH, meshFrame, type ViewBox } from "./faceOverlay";

/**
 * «Biometric Future» — capa visual del visor. Todo es decorativo (aria-hidden)
 * y sale del estado REAL de la captura: la fase de la cámara, si el detector
 * ya confirmó un rostro válido y la caja del único rostro detectado. Nunca
 * afirma una identidad: el sistema detecta un rostro y toma una foto.
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

function hudLabel(phase: CapturePhase, valid: boolean) {
  if (phase === "preparing") return "Iniciando";
  if (phase === "submitting") return "Foto tomada";
  if (phase === "off") return "";
  return valid ? "En posición" : "Escaneando";
}

export function FaceHud({ phase, valid, view }: { phase: CapturePhase; valid: boolean; view: ViewBox | null }) {
  const label = hudLabel(phase, valid);
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
      {label ? (
        <span className="face-hud-label" aria-hidden="true"><span className="face-hud-dot" />{label}</span>
      ) : null}
      {phase === "submitting" ? <span className="face-busy" aria-hidden="true"><span /></span> : null}
    </>
  );
}

type CheckState = "ok" | "active" | "todo" | "bad";
const CHECK_TEXT: Record<CheckState, string> = { ok: "listo", active: "en curso", todo: "pendiente", bad: "revisar" };

/**
 * Controles de la captura derivados del estado real del detector (no agrega
 * reglas): la luz se mide antes de detectar; con NO_FACE o FACE_TOO_SMALL el
 * rostro no está en posición; con MULTIPLE_FACES hay más de uno.
 */
export function captureChecks(phase: CapturePhase, status: string): { label: string; state: CheckState }[] {
  const camera: CheckState = phase === "preparing" ? "active" : phase === "off" ? "bad" : "ok";
  const live = phase === "live" || phase === "submitting";
  const detected = live && status !== "LOADING";
  const light: CheckState = !live ? "todo" : status === "LOW_LIGHT" ? "bad" : detected ? "ok" : "active";
  const measured = detected && status !== "LOW_LIGHT";
  const single: CheckState = !measured ? "todo" : status === "MULTIPLE_FACES" ? "bad" : status === "NO_FACE" ? "active" : "ok";
  const placed: CheckState = !measured ? "todo" : status === "VALID" ? "ok" : status === "MULTIPLE_FACES" ? "todo" : "bad";
  return [
    { label: "Cámara lista", state: camera },
    { label: "Buena luz", state: light },
    { label: "Un solo rostro", state: single },
    { label: "Rostro en el recuadro", state: placed },
  ];
}

export function CaptureChecks({ phase, status }: { phase: CapturePhase; status: string }) {
  return (
    <ul className="face-checks" aria-label="Controles de la captura">
      {captureChecks(phase, status).map((item) => (
        <li key={item.label} className={`face-check is-${item.state}`}>
          <span className="face-check-mark" aria-hidden="true">
            {item.state === "ok" ? <Check size={14} strokeWidth={2.5} /> : item.state === "bad" ? "!" : null}
          </span>
          <span>{item.label}</span>
          <span className="sr-only">: {CHECK_TEXT[item.state]}</span>
        </li>
      ))}
    </ul>
  );
}
