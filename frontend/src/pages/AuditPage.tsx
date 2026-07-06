import { useEffect, useState } from "react";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { DataTable } from "../components/ui/DataTable";
import { auditApiService } from "../services/api/auditApiService";
import type { AuditEntry } from "../types";
import { formatPeriodLabel } from "../utils/period";

const entityLabels: Record<string, string> = {
  Employee: "Legajo",
  EmployeeFieldHistory: "Historial de legajo",
  FinnegansExport: "Exportación a Finnegans",
  Novelty: "Novedad",
  TimeEntry: "Carga horaria",
  Document: "Documento",
  Position: "Puesto",
  User: "Usuario",
};

const actionLabels: Record<string, string> = {
  Alta: "Alta",
  Modificacion: "Modificación",
  Eliminacion: "Eliminación",
  Activacion: "Activación",
  Inactivacion: "Inactivación",
  Aprobacion: "Aprobación",
  Rechazo: "Rechazo",
  Devolucion: "Devolución",
  Exportacion: "Exportación",
  Ingreso: "Ingreso",
};

function polishText(value: string) {
  return value
    .replace(/\baprobo\b/gi, "aprobó")
    .replace(/\bactualizo\b/gi, "actualizó")
    .replace(/\benvio\b/gi, "envió")
    .replace(/\brechazo\b/gi, "rechazó")
    .replace(/\bdevolvio\b/gi, "devolvió")
    .replace(/\bcargo\b/gi, "cargó")
    .replace(/\bpreparo\b/gi, "preparó")
    .replace(/\bcreo\b/gi, "creó")
    .replace(/\bexportacion\b/gi, "exportación")
    .replace(/\bauditoria\b/gi, "auditoría");
}

function cleanAuditValue(value: string) {
  if (!value || value === "-") return "";
  return polishText(value)
    .replace(/\s*\|\s*Id:\s*[a-f0-9-]{20,}/gi, "")
    .replace(/\bDate:\s*(\d{4})-(\d{2})-(\d{2})T[^\s|]+/gi, "Fecha: $3/$2/$1")
    .replace(/\bDay:\s*/gi, "Día: ")
    .replace(/\bHours:\s*/gi, "Horas: ")
    .replace(/\bPeriod:\s*(\d{4}-\d{2})\b/gi, (_, period) => `Periodo: ${formatPeriodLabel(period)}`)
    .replace(/\bEstado:\s*EN_REVISION\b/g, "Estado: en revisión")
    .replace(/\bEstado:\s*APROBADO\b/g, "Estado: aprobado")
    .replace(/\bStatus:\s*APROBADO\b/g, "Estado: aprobado")
    .replace(/\bInclude Pending:\s*(true|false)\b/gi, (_, included) => `Incluye pendientes: ${included === "true" ? "sí" : "no"}`)
    .replace(/\bTotal Rows:\s*(\d+)\b/gi, (_, total) => `${total} registro${total === "1" ? "" : "s"}`)
    .replace(/\bQuery:\s*/gi, "")
    .replace(/\bField:\s*/gi, "Campo: ")
    .replace(/\bSection:\s*/gi, "Sección: ")
    .replace(/\bNew value:\s*/gi, "Valor nuevo: ")
    .replace(/\bOld value:\s*/gi, "Valor anterior: ")
    .replace(/\s+\|\s+/g, " · ");
}

function auditDescription(audit: AuditEntry) {
  const description = audit.reason && audit.reason !== "-" ? audit.reason : audit.next;
  return cleanAuditValue(description) || "Movimiento registrado en el sistema.";
}

function auditChange(audit: AuditEntry) {
  const previous = cleanAuditValue(audit.previous);
  const next = cleanAuditValue(audit.next);
  if (previous && next) return `Antes: ${previous} · Después: ${next}`;
  if (next) return next;
  if (previous) return `Antes: ${previous}`;
  return "Sin cambios de valores visibles.";
}

export function AuditPage() {
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    setStatus("loading");
    auditApiService
      .getAll({ take: 200 })
      .then((items) => {
        if (!mounted) return;
        setAudits(items);
        setStatus("success");
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, [retry]);

  return (
    <>
      <PageHeader
        eyebrow="TRAZABILIDAD"
        title="Auditoría"
        description="Registro central de movimientos generados por la operación del sistema."
      />

      <Section title="Historial de actividad" subtitle={`${audits.length} eventos registrados`}>
        <DataTable
          status={status === "loading" ? "loading" : status === "error" ? "error" : audits.length === 0 ? "empty" : "ready"}
          minWidth={1040}
          emptyText="Todavía no hay eventos de auditoría registrados."
          errorMessage="No se pudo cargar el historial de auditoría."
          onRetry={() => setRetry((value) => value + 1)}
        >
          <table className="audit-readable-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Evento</th>
                <th>Registro</th>
                <th>Descripción</th>
                <th>Cambio registrado</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((audit) => (
                <tr key={audit.id}>
                  <td>
                    {audit.date} · {audit.time}
                  </td>
                  <td>
                    <b>{audit.user}</b>
                    <span className="table-sub">{audit.role}</span>
                  </td>
                  <td>
                    {actionLabels[audit.action] || audit.action}
                  </td>
                  <td>
                    <OverflowCell value={entityLabels[audit.entity] || audit.entity} />
                    {audit.field && <span className="table-sub">{audit.field}</span>}
                  </td>
                  <td>
                    <OverflowCell value={auditDescription(audit)} lines={3} />
                  </td>
                  <td>
                    <OverflowCell value={auditChange(audit)} lines={3} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Section>
    </>
  );
}
