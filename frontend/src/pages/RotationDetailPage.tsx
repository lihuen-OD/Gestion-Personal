import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/ErrorState";
import { LoadingState } from "../components/ui/LoadingState";
import { Section } from "../components/ui/Section";
import { Tabs, tabPanelProps } from "../components/ui/Tabs";
import { RotationCrewsPanel } from "../components/rotations/RotationCrewsPanel";
import { RotationGridPanel } from "../components/rotations/RotationGridPanel";
import { RotationMembersPanel } from "../components/rotations/RotationMembersPanel";
import { RotationFormModal } from "../components/rotations/RotationFormModal";
import { RotationIssuesPanel } from "../components/rotations/RotationIssuesPanel";
import { useShiftGroupsCatalog } from "../components/shifts/useShiftGroupsCatalog";
import { useAuth } from "../context/AuthContext";
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import { shiftRotationApiService, type ShiftRotation } from "../services/api/shiftRotationApiService";
import { confirmAction } from "../services/appDialog";
import { argentinaDateKey } from "../utils/argentinaDateKey";
import { formatInstantDate } from "../utils/date";
import { roleLevel } from "../utils/roles";
import {
  canDeleteRotation,
  countLabel,
  humanizeRotationMessage,
  referenceVersion,
  rotationCycleLabel,
  rotationHealth,
  rotationState,
  rotationVersionStatus,
} from "../utils/shiftRotation";
import { TOAST_SUCCESS_MS } from "../utils/toast";

export const ROTATIONS_LIST_PATH = "/configuracion/turnos?vista=rotaciones";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

type DetailView = "resumen" | "equipos" | "personas";
const DETAIL_VIEWS: Array<{ key: DetailView; label: string }> = [
  { key: "resumen", label: "Resumen" },
  { key: "equipos", label: "Equipos y grilla" },
  { key: "personas", label: "Personas" },
];
const DETAIL_TABS_ID = "rotation-detail";

function viewFromParam(value: string | null): DetailView {
  return value === "equipos" || value === "personas" ? value : "resumen";
}

function stateNote(rotation: ShiftRotation): string | null {
  if (rotation.finalized) return "La rotación está finalizada: ya no tiene grilla ni personas desde hoy. Se conserva para consulta.";
  if (rotation.status === "INACTIVO") return "La rotación está inactiva: todavía no genera horarios ni obligaciones para nadie. Podés configurarla sin afectar la asistencia.";
  return null;
}

/**
 * Detalle de una rotación (R4.8A): datos, resumen de configuración y
 * diagnóstico. Equipos y grilla (R4.8B), personas (R4.8C), vista previa
 * (R4.8D) y activación/finalización (R4.8E) se agregan en sus subetapas.
 */
export function RotationDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { created?: boolean } };
  const canEdit = roleLevel(user!.role) === 1;
  const [rotation, setRotation] = useState<ShiftRotation | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error" | "not-found">("loading");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(location.state?.created ? "Rotación creada." : "");
  const [actionError, setActionError] = useState("");
  const { groups, status: groupsStatus } = useShiftGroupsCatalog();
  const todayKey = argentinaDateKey(new Date());
  const [searchParams, setSearchParams] = useSearchParams();
  const view = viewFromParam(searchParams.get("vista"));
  const [teamsVisited, setTeamsVisited] = useState(view === "equipos");
  if (view === "equipos" && !teamsVisited) setTeamsVisited(true);
  // Cambios de equipos: se relee el detalle (conteos, diagnóstico) y la grilla, sin blanquear la pantalla.
  const [gridReload, setGridReload] = useState(0);
  const refreshAfterCrewChange = () => {
    setReload((value) => value + 1);
    setGridReload((value) => value + 1);
  };

  useEffect(() => {
    if (!id) return;
    let alive = true;
    if (!rotation) setLoadStatus("loading");
    shiftRotationApiService
      .detail(id)
      .then((data) => {
        if (!alive) return;
        setRotation(data);
        setLoadStatus("success");
      })
      .catch((reason) => {
        if (alive) setLoadStatus(reason instanceof ApiError && reason.status === 404 ? "not-found" : "error");
      });
    return () => {
      alive = false;
    };
  }, [id, reload]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  const remove = async () => {
    if (!rotation || deleting) return;
    const confirmed = await confirmAction(`¿Querés eliminar la rotación «${rotation.name}»? Se borran también sus equipos y versiones de grilla. Esta acción no se puede deshacer.`, { title: "Eliminar rotación", confirmLabel: "Eliminar", tone: "danger" });
    if (!confirmed) return;
    setDeleting(true);
    setActionError("");
    try {
      await shiftRotationApiService.remove(rotation.id);
      navigate(ROTATIONS_LIST_PATH, { state: { notice: "Rotación eliminada." } });
    } catch (reason) {
      setActionError(humanizeRotationMessage(getUserErrorMessage(reason, "No pudimos eliminar la rotación.")));
      setDeleting(false);
    }
  };

  const backLink = <Link to={ROTATIONS_LIST_PATH} className="back-link">← Volver a rotaciones</Link>;

  if (loadStatus === "loading") return <Section title="Rotación"><LoadingState text="Cargando rotación..." /></Section>;
  if (loadStatus === "not-found") {
    return (
      <Section title="Rotación" action={<Link to={ROTATIONS_LIST_PATH} className="button subtle">Volver a rotaciones</Link>}>
        <ErrorState message="No encontramos la rotación. Puede haber sido eliminada." />
      </Section>
    );
  }
  if (loadStatus === "error" || !rotation) return <Section title="Rotación"><ErrorState message="No pudimos cargar la rotación." onRetry={() => setReload((value) => value + 1)} /></Section>;

  const state = rotationState(rotation);
  const health = rotationHealth(rotation.health);
  const version = rotationVersionStatus(rotation.versions, todayKey);
  const cycleVersion = referenceVersion(rotation.versions, todayKey);
  const activeCrews = rotation.crews.filter((crew) => crew.status === "ACTIVO").length;
  const note = stateNote(rotation);
  const deletable = canDeleteRotation(rotation);

  return (
    <>
      <div className="detail-hero catalog-hero rotation-hero">
        {backLink}
        <div>
          <div className="avatar" aria-hidden="true">{rotation.code.slice(0, 2).toUpperCase()}</div>
          <div>
            <p className="eyebrow">Rotación · {rotation.code}</p>
            <h1>{rotation.name}</h1>
            <p className="shift-detail-classification"><span>Grupo: <b>{rotation.shiftGroup.name}</b>{rotation.shiftGroup.status === "ACTIVO" ? "" : " (inactivo)"}</span></p>
          </div>
        </div>
        <div className="hero-actions">
          <Badge tone={state.tone}>{state.label}</Badge>
          <Badge tone={health.tone}>{health.label}</Badge>
          {canEdit ? (
            <>
              <Button variant="subtle" icon={Pencil} onClick={() => setEditing(true)}>Editar datos</Button>
              {deletable ? (
                <button type="button" className="table-icon-action danger-link" title="Eliminar rotación" aria-label="Eliminar rotación" onClick={() => void remove()} disabled={deleting}>
                  <Trash2 size={14} aria-hidden="true" /><span>Eliminar rotación</span>
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      {actionError ? <p className="error rotation-action-error" role="alert">{actionError}</p> : null}
      {note ? <div className="info-note rotation-state-note" role="note"><p>{note}</p></div> : null}

      <Tabs
        ariaLabel="Secciones de la rotación"
        idBase={DETAIL_TABS_ID}
        tabs={DETAIL_VIEWS}
        active={view}
        onChange={(key) => setSearchParams(key === "resumen" ? {} : { vista: key }, { replace: true })}
      />
      {/* La pestaña de equipos, una vez abierta, queda montada (oculta) para no perder un borrador de grilla al cambiar de pestaña. */}
      {teamsVisited ? (
        <div {...tabPanelProps(DETAIL_TABS_ID, "equipos")} hidden={view !== "equipos"}>
          <RotationCrewsPanel rotation={rotation} canEdit={canEdit} onChanged={refreshAfterCrewChange} />
          <RotationGridPanel rotation={rotation} reloadToken={gridReload} canEdit={canEdit} onVersionsChanged={() => setReload((value) => value + 1)} />
        </div>
      ) : null}
      {view === "personas" ? (
        <div {...tabPanelProps(DETAIL_TABS_ID, "personas")}>
          <RotationMembersPanel rotation={rotation} canEdit={canEdit} onChanged={() => setReload((value) => value + 1)} />
        </div>
      ) : null}
      <div {...tabPanelProps(DETAIL_TABS_ID, "resumen")} hidden={view !== "resumen"}>
        <div className="rotation-summary-grid">
          <Section title="Datos de la rotación" subtitle="Identificación y lugar de trabajo.">
            <dl className="rotation-facts">
              <Fact label="Código">{rotation.code}</Fact>
              <Fact label="Nombre">{rotation.name}</Fact>
              <Fact label="Grupo (lugar)">{rotation.shiftGroup.name}{rotation.shiftGroup.status === "ACTIVO" ? "" : " (inactivo)"}</Fact>
              <Fact label="Estado">{state.label}</Fact>
              <Fact label="Creada">{formatInstantDate(rotation.createdAt)}</Fact>
              <Fact label="Última modificación">{formatInstantDate(rotation.updatedAt)}</Fact>
              <div className="rotation-fact-wide"><dt>Observación</dt><dd>{rotation.observation || "Sin observaciones."}</dd></div>
            </dl>
          </Section>
          <Section title="Configuración" subtitle="Resumen de equipos, grilla y personas.">
            <dl className="rotation-facts">
              <Fact label="Equipos activos">{rotation.crews.length ? `${activeCrews} de ${rotation.crews.length}` : "Sin equipos"}</Fact>
              <Fact label="Ciclo">{cycleVersion ? rotationCycleLabel(cycleVersion.cycleLengthWeeks) : rotation.versions.length ? "Sin grilla vigente" : "Sin grilla configurada"}</Fact>
              <Fact label="Versión de la grilla">
                {version.label}
                {version.detail ? <span className="rotation-fact-detail">{version.detail}</span> : null}
              </Fact>
              <Fact label="Versiones registradas">{countLabel(rotation.versions.length, "versión", "versiones")}</Fact>
              <Fact label="Personas asignadas">
                {countLabel(rotation.members.length, "persona", "personas")}
                <span className="rotation-fact-detail">Vigentes o con inicio futuro.</span>
              </Fact>
            </dl>
          </Section>
        </div>

        <Section title="Diagnóstico" subtitle="Revisión automática de la configuración guardada." className="rotation-diagnostics">
          <RotationIssuesPanel issues={rotation.issues} inactive={rotation.status === "INACTIVO"} />
        </Section>
      </div>

      {editing ? (
        <RotationFormModal
          rotation={rotation}
          groups={groups}
          groupsUnavailable={groupsStatus === "error"}
          close={() => setEditing(false)}
          onSaved={(saved) => {
            setRotation(saved);
            setEditing(false);
            setNotice("Cambios guardados.");
          }}
        />
      ) : null}
    </>
  );
}
