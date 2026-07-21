import type { AuditEntry } from "../../types";
import { ErrorState } from "../ui/ErrorState";
import { EmptyState } from "../ui/EmptyState";
import { LoadingState } from "../ui/LoadingState";
import { OverflowCell } from "../ui/OverflowCell";
import { Section } from "../ui/Section";
import { TableShell } from "../ui/TableShell";

export const employeeDetailTabSections = [
  "INFORMACION_GENERAL",
  "CONTACTO_DOMICILIO",
  "DATOS_LABORALES",
  "RESPONSABLES",
  "TRANSPORTE",
  "CONFIGURACION_HORARIA",
  "NOVEDADES",
  "DOCUMENTACION",
] as const;

type EmployeeDetailTabSection = (typeof employeeDetailTabSections)[number];

type SectionChangeHistoryProps = {
  section: EmployeeDetailTabSection;
  title: string;
  maxItems?: number;
  audits: AuditEntry[];
  status: "loading" | "success" | "error";
  onRetry: () => void;
};

export function SectionChangeHistory({
  section,
  title,
  maxItems = 5,
  audits,
  status,
  onRetry,
}: SectionChangeHistoryProps) {
  const contactFields = new Set([
    "phone",
    "mobile",
    "email",
    "emergencyContact",
    "emergencyRelation",
    "emergencyPhone",
  ]);
  const generalFields = new Set(["legajo", "legajoFinnegans", "lastName", "firstName", "dni", "cuil", "birthDate", "gender", "civilStatus", "nationality"]);
  const rows = audits.flatMap((audit) => (audit.changes || []).map((change) => ({ ...change, audit })))
    .filter((row) => section === "INFORMACION_GENERAL" ? generalFields.has(row.field) : contactFields.has(row.field))
    .slice(0, maxItems);

  return (
    <Section title={title} subtitle="Cambios detectados al guardar la ficha">
      <div className="section-history">
        {status === "loading" ? (
          <LoadingState text="Cargando historial..." />
        ) : status === "error" ? (
          <ErrorState message="No pudimos cargar el historial de esta sección." onRetry={onRetry} />
        ) : rows.length ? (
          <TableShell minWidth={980}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Campo</th>
                  <th>Valor anterior</th>
                  <th>Valor nuevo</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.audit.id}-${row.field}`}>
                    <td>{row.audit.date} {row.audit.time}</td>
                    <td>{row.audit.user}</td>
                    <td>
                      <OverflowCell value={row.label} />
                    </td>
                    <td>
                      <OverflowCell value={row.previous} />
                    </td>
                    <td>
                      <OverflowCell value={row.next} />
                    </td>
                    <td>
                      <OverflowCell value={row.audit.reason || "-"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState text="Todavía no hay cambios registrados en esta sección." />
        )}
      </div>
    </Section>
  );
}
