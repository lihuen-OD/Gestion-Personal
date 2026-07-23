import { Power } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ShiftTemplateFormFields, shiftTemplateFormToInput, shiftTemplateToFormValue, type ShiftTemplateFormValue } from "../components/shifts/ShiftTemplateFormFields";
import { ShiftEmployeesPanel } from "../components/shifts/ShiftEmployeesPanel";
import { useAuth } from "../context/AuthContext";
import { workforceApiService, type ShiftTemplate } from "../services/api/workforceApiService";
import { confirmAction } from "../services/appDialog";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

const tabItems = [
  { key: "0", label: "1. Datos del turno" },
  { key: "1", label: "2. Personas asociadas" },
];

export function ShiftDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation() as { state?: { created?: boolean } };
  const canEdit = roleLevel(user!.role) === 1;
  const [source, setSource] = useState<ShiftTemplate | undefined>(undefined);
  const [value, setValue] = useState<ShiftTemplateFormValue | undefined>(undefined);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadRetry, setLoadRetry] = useState(0);
  const [tab, setTab] = useState(0);
  const [notice, setNotice] = useState(location.state?.created ? "Turno creado correctamente." : "");

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setLoadStatus("loading");
    workforceApiService
      .shiftTemplates()
      .then((items) => {
        if (!alive) return;
        const found = items.find((item) => item.id === id);
        if (!found) {
          setLoadStatus("error");
          return;
        }
        setSource(found);
        setValue(shiftTemplateToFormValue(found));
        setLoadStatus("success");
      })
      .catch(() => {
        if (alive) setLoadStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [id, loadRetry]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!id || !value) return;
    if (!value.code.trim() || !value.name.trim()) return setNotice("Completá código y nombre del turno.");
    try {
      const saved = await workforceApiService.updateShiftTemplate(id, shiftTemplateFormToInput(value));
      setSource(saved);
      setValue(shiftTemplateToFormValue(saved));
      setNotice("Cambios guardados correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos guardar el turno.");
    }
  });

  const toggleStatus = async () => {
    if (!id || !source) return;
    const activating = source.status !== "ACTIVO";
    if (!(await confirmAction(`¿Querés ${activating ? "activar" : "inactivar"} el turno "${source.name}"?`, { title: `${activating ? "Activar" : "Inactivar"} turno`, confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" }))) return;
    try {
      const saved = await workforceApiService.updateShiftTemplate(id, { status: activating ? "ACTIVO" : "INACTIVO" });
      setSource(saved);
      setValue(shiftTemplateToFormValue(saved));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos cambiar el estado del turno.");
    }
  };

  if (loadStatus === "loading") return <Section title="Turno"><LoadingState text="Cargando turno..." /></Section>;
  if (loadStatus === "error" || !source || !value) return <Section title="Turno"><ErrorState message="No se pudo cargar el turno solicitado." onRetry={() => setLoadRetry((v) => v + 1)} /></Section>;

  return (
    <>
      <div className="detail-hero catalog-hero">
        <Link to="/configuracion/turnos" className="back-link">← Volver a turnos</Link>
        <div>
          <div className="avatar">{source.code.slice(0, 2).toUpperCase()}</div>
          <div>
            <p className="eyebrow">{source.code} · {source.categoryName || "Sin categoría"}</p>
            <h1>{source.name}</h1>
            <p>{source.startTime}–{source.endTime}{source.crossesMidnight ? " (cruza medianoche)" : ""}</p>
          </div>
        </div>
        <div className="hero-actions">
          <Badge tone={source.status === "ACTIVO" ? "success" : "neutral"}>{source.status === "ACTIVO" ? "Activo" : "Inactivo"}</Badge>
          {canEdit ? (
            <button className="table-icon-action" title={source.status === "ACTIVO" ? "Inactivar" : "Activar"} aria-label={source.status === "ACTIVO" ? "Inactivar" : "Activar"} onClick={() => void toggleStatus()}>
              <Power size={14} /><span>{source.status === "ACTIVO" ? "Inactivar" : "Activar"}</span>
            </button>
          ) : null}
        </div>
      </div>
      {notice ? <div className="toast">{notice}</div> : null}
      <Tabs tabs={tabItems} active={String(tab)} onChange={(key) => setTab(Number(key))} />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{tabItems[tab]!.label}</h3>
            <p>{tab === 0 ? "Horario, tolerancias y reglas de control del turno." : "Empleados con este turno habilitado o deshabilitado."}</p>
          </div>
          {tab === 0 && canEdit ? <Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar cambios"}</Button> : null}
        </div>
        <div className="panel-body">
          {tab === 0 ? <ShiftTemplateFormFields value={value} onChange={setValue} disabled={!canEdit} /> : <ShiftEmployeesPanel shiftTemplateId={source.id} canEdit={canEdit} />}
        </div>
      </section>
    </>
  );
}
