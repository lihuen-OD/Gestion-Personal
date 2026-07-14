import { useEffect, useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { DocumentUploadModal } from "../components/documents/DocumentUploadModal";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { DataTable } from "../components/ui/DataTable";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { documentApiService } from "../services/api/documentApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import type { DocumentMock, Employee } from "../types";
import { statusTone } from "../utils/status";
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
  const [listStatus, setListStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    let mounted = true;
    setListStatus("loading");
    documentApiService
      .list({ page, take: pageSize, search: debouncedSearch })
      .then((result) => {
        if (!mounted) return;
        setDocs(result.items);
        setMeta(result.meta);
        setListStatus("success");
      })
      .catch(() => {
        if (!mounted) return;
        setDocs([]);
        setMeta({ total: 0, page, pageSize, hasMore: false });
        setListStatus("error");
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
          <Button variant="primary" icon={Plus} onClick={openUpload} disabled={loadingEmployees}>
            {loadingEmployees ? "Cargando..." : "Agregar documento"}
          </Button>
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
        <DataTable
          status={listStatus === "loading" ? "loading" : listStatus === "error" ? "error" : docs.length === 0 ? "empty" : "ready"}
          minWidth={1200}
          emptyText="Todavia no hay documentos cargados."
          errorMessage="No se pudieron cargar los documentos."
          onRetry={() => setRefresh((value) => value + 1)}
        >
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
                      <Badge tone={statusTone(doc.status)}>{doc.status}</Badge>
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
        </DataTable>
        {listStatus === "success" && docs.length > 0 && (
          <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} hasMore={meta.hasMore} onPageChange={setPage} itemLabel="documentos" />
        )}
      </Section>

      {open ? (
        <DocumentUploadModal
          employees={employees}
          user={user!}
          close={() => setOpen(false)}
          saved={(employee, createdDocuments) => {
            const created = createdDocuments?.[0];
            if (created && employee && page === 1 && !debouncedSearch) {
              setDocs((current) => [{ ...created, employeeLegajo: employee.legajoInterno || employee.legajo, employeeName: `${employee.lastName}, ${employee.firstName}` }, ...current].slice(0, pageSize));
              setMeta((current) => ({ ...current, total: current.total + 1, hasMore: current.total + 1 > current.pageSize }));
            } else {
              setPage(1);
              setRefresh((value) => value + 1);
            }
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
