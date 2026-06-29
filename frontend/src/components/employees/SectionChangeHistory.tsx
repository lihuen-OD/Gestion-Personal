import { employeeChangeLogService } from "../../services/employeeChangeLogService";
import { EmptyState } from "../ui/EmptyState";
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
  employeeId: string;
  section: EmployeeDetailTabSection;
  title: string;
  maxItems?: number;
};

export function SectionChangeHistory({
  employeeId,
  section,
  title,
  maxItems = 5,
}: SectionChangeHistoryProps) {
  const contactFields = new Set([
    "phone",
    "mobile",
    "email",
    "emergencyContact",
    "emergencyRelation",
    "emergencyPhone",
  ]);
  const rows = employeeChangeLogService
    .getByEmployeeAndSection(employeeId, section)
    .filter((row) => section !== "CONTACTO_DOMICILIO" || contactFields.has(row.field))
    .slice(0, maxItems);

  return (
    <Section title={title} subtitle="Cambios detectados al guardar la ficha">
      <div className="section-history">
        {rows.length ? (
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
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString("es-AR")}</td>
                    <td>{row.userName}</td>
                    <td>
                      <OverflowCell value={row.fieldLabel} />
                    </td>
                    <td>
                      <OverflowCell value={row.oldValue} />
                    </td>
                    <td>
                      <OverflowCell value={row.newValue} />
                    </td>
                    <td>
                      <OverflowCell value={row.reason || "-"} />
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
