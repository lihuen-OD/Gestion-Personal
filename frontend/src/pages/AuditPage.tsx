import { useEffect, useState } from "react";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { DataTable } from "../components/ui/DataTable";
import { auditApiService } from "../services/api/auditApiService";
import type { AuditEntry } from "../types";

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
          minWidth={1280}
          emptyText="Todavía no hay eventos de auditoría registrados."
          errorMessage="No se pudo cargar el historial de auditoría."
          onRetry={() => setRetry((value) => value + 1)}
        >
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>Campo</th>
                <th>Valor anterior</th>
                <th>Valor nuevo</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((audit) => (
                <tr key={audit.id}>
                  <td>
                    {audit.date} · {audit.time}
                  </td>
                  <td>{audit.user}</td>
                  <td>
                    <OverflowCell value={audit.role} />
                  </td>
                  <td>{audit.action}</td>
                  <td>
                    <OverflowCell value={audit.entity} />
                  </td>
                  <td>
                    <OverflowCell value={audit.field || "-"} />
                  </td>
                  <td>
                    <OverflowCell value={audit.previous} />
                  </td>
                  <td>
                    <OverflowCell value={audit.next} />
                  </td>
                  <td>
                    <OverflowCell value={audit.reason} />
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
