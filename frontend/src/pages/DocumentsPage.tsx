import { useEffect, useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { DocumentUploadModal } from "../components/documents/DocumentUploadModal";
import { EmptyState } from "../components/ui/EmptyState";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { TableShell } from "../components/ui/TableShell";
import { documentApiService } from "../services/api/documentApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import type { DocumentMock, Employee } from "../types";
import { statusClass } from "../utils/status";
import { useDebouncedValue } from "../utils/useDebouncedValue";

const pageSize = 25;

export function DocumentsPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [docs, setDocs] = useState<DocumentMock[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    documentApiService
      .list({ page, take: pageSize, search: debouncedSearch })
      .then((result) => {
        if (!mounted) return;
        setDocs(result.items);
        setMeta(result.meta);
      })
      .catch(() => {
        if (!mounted) return;
        setDocs([]);
        setMeta({ total: 0, page, pageSize, hasMore: false });
      });
    return () => {
      mounted = false;
    };
  }, [debouncedSearch, page, refresh]);

  const openUpload = async () => {
    setError("");
    setLoadingEmployees(true);
    try {
      if (!employees.length) {
        const result = await employeeApiService.getOptions({ take: 1000 });
        setEmployees(result.items);
      }
      setOpen(true);
    } catch (loadError) {
      setError("No se pudieron cargar los legajos para subir documentación.");
    } finally {
      setLoadingEmployees(false);
    }
  };

  const download = async (doc: DocumentMock) => {
    setError("");
    try {
      await documentApiService.download(doc);
    } catch (downloadError) {
      setError("No se pudo abrir el archivo. Verifica que exista en el backend o que Cloudinary este configurado.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="GESTION DOCUMENTAL"
        title="Documentacion"
        description="Seguimiento de documentacion laboral, certificados y vencimientos."
        action={
          <button className="button primary" onClick={openUpload} disabled={loadingEmployees}>
            <Plus size={16} /> {loadingEmployees ? "Cargando..." : "Agregar documento"}
          </button>
        }
      />

      {error ? <div className="form-error">{error}</div> : null}

      <Section title="Documentos del personal" subtitle={`${meta.total} documentos registrados`}>
        <div className="filters">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Buscar por legajo, CUIL, DNI, empleado, categoria o archivo"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        {docs.length ? (
          <TableShell minWidth={1200}>
            <table>
              <thead>
                <tr>
                  <th>Legajo</th>
                  <th>Empleado</th>
                  <th>Categoria</th>
                  <th>Archivo</th>
                  <th>Fecha carga</th>
                  <th>Vencimiento</th>
                  <th>Estado</th>
                  <th>Observacion</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => {
                  const employeeLegajo = doc.employeeLegajo || "-";
                  const employeeName = doc.employeeName || "-";
                  return (
                    <tr key={doc.id}>
                      <td>{employeeLegajo}</td>
                      <td>
                        <OverflowCell value={employeeName} />
                      </td>
                      <td>
                        <OverflowCell value={doc.category} />
                      </td>
                      <td>
                        <OverflowCell value={doc.fileName} />
                      </td>
                      <td>{doc.uploadedAt}</td>
                      <td>{doc.expiresAt || "-"}</td>
                      <td>
                        <span className={statusClass(doc.status)}>{doc.status}</span>
                      </td>
                      <td>
                        <OverflowCell value={doc.notes || "-"} />
                      </td>
                      <td>
                        <button
                          className="table-link table-icon-action"
                          type="button"
                          title="Abrir archivo"
                          aria-label="Abrir archivo"
                          onClick={() => download(doc)}
                        >
                          <Download size={14} />
                          <span>Abrir</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState text="Todavia no hay documentos cargados." />
        )}
        <div className="form-actions inline-actions">
          <button className="button subtle" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            Anterior
          </button>
          <span className="muted small">Pagina {meta.page} de {Math.max(1, Math.ceil(meta.total / meta.pageSize))}</span>
          <button className="button subtle" type="button" disabled={!meta.hasMore} onClick={() => setPage((value) => value + 1)}>
            Siguiente
          </button>
        </div>
      </Section>

      {open ? (
        <DocumentUploadModal
          employees={employees}
          user={user!}
          close={() => setOpen(false)}
          saved={() => {
            setRefresh((value) => value + 1);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
