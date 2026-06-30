import { useEffect, useState } from "react";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { TableShell } from "../components/ui/TableShell";
import { auditApiService } from "../services/api/auditApiService";
import type { AuditEntry } from "../types";

export function AuditPage() {
  const [audits, setAudits] = useState<AuditEntry[]>([]);

  useEffect(() => {
    let mounted = true;
    auditApiService
      .getAll({ take: 200 })
      .then((items) => {
        if (mounted) setAudits(items);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="TRAZABILIDAD"
        title="Auditoría"
        description="Registro central de movimientos generados por la operación del sistema."
      />

      <Section title="Historial de actividad" subtitle={`${audits.length} eventos registrados`}>
        <TableShell minWidth={1280}>
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
        </TableShell>
      </Section>
    </>
  );
}
