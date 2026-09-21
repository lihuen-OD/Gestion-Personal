import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { roleLevel } from "../utils/roles";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { DataTable } from "../components/ui/DataTable";
import { Pagination } from "../components/ui/Pagination";
import { auditApiService } from "../services/api/auditApiService";
import type { AuditEntry } from "../types";
import { auditActionLabel, auditEntityLabel, auditRoleLabel, auditChange, auditDescription } from "../utils/auditLabels";

const pageSize = 25;

export function AuditPage() {
  const { user } = useAuth();
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });

  useEffect(() => {
    let mounted = true;
    // Etapa 9B: sólo mostrar el skeleton de carga completo cuando todavía no
    // hay eventos en pantalla — cambiar de página no debe blanquear la tabla
    // ya poblada (mismo patrón de EmployeesPage).
    if (!audits.length) setStatus("loading");
    auditApiService
      .list({ page, take: pageSize })
      .then((result) => {
        if (!mounted) return;
        setAudits(result.items);
        setMeta(result.meta);
        setStatus("success");
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, [page, retry]);

  if (roleLevel(user!.role) !== 1) return <Navigate to="/" />;

  return (
    <>
      <PageHeader
        eyebrow="TRAZABILIDAD"
        title="Auditoría"
        description="Registro central de movimientos generados por la operación del sistema."
      />

      <Section title="Historial de actividad" subtitle={`${meta.total} eventos registrados`}>
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
                    <span className="table-sub">{auditRoleLabel(audit.role)}</span>
                  </td>
                  <td>
                    {auditActionLabel(audit.action)}
                  </td>
                  <td>
                    <OverflowCell value={auditEntityLabel(audit.entity)} />
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
        {audits.length ? <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="eventos" /> : null}
      </Section>
    </>
  );
}
