import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { emptyNoveltyType } from "../components/novelty-types/NoveltyTypeFields";
import { NoveltyTypeForm } from "../components/novelty-types/NoveltyTypeForm";
import { useAuth } from "../context/AuthContext";
import { getUserErrorMessage } from "../services/api/apiClient";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import { MISSING_DATA_MESSAGE, noveltyTypeIssues } from "../utils/noveltyTypeCoverage";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";

export function NoveltyTypeCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [item, setItem] = useState<NoveltyType>({ ...emptyNoveltyType(), id: crypto.randomUUID(), code: "" });
  const [error, setError] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [focusIssuesRequest, setFocusIssuesRequest] = useState(0);

  const issues = noveltyTypeIssues(item);

  const { isRunning: isSaving, run: save } = useAsyncAction(async (event: FormEvent) => {
    event.preventDefault();
    if (issues.length) {
      setError("");
      setShowIssues(true);
      return setFocusIssuesRequest((value) => value + 1);
    }
    setError("");
    try {
      const created = await noveltyTypeApiService.create(item);
      navigate(`/configuracion/tipos-novedades/${created.id}`, { state: { created: true, usesApi: true } });
    } catch (saveError) {
      // El backend explica en lenguaje de negocio por qué rechaza una configuración.
      setError(getUserErrorMessage(saveError, "No pudimos guardar el tipo de novedad. Intentá nuevamente."));
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;

  return (
    <form onSubmit={save} noValidate>
      <PageHeader eyebrow="TIPOS DE NOVEDADES" title="Crear tipo de novedad" description="Definí cómo se comporta la novedad: qué tiempo cubre, cuándo cuenta y cómo se carga." />
      <NoveltyTypeForm
        item={item}
        setItem={setItem}
        issues={showIssues ? issues : undefined}
        focusIssuesRequest={focusIssuesRequest}
        error={showIssues && issues.length ? MISSING_DATA_MESSAGE : error}
        actions={<>
          <Button to="/configuracion/tipos-novedades" variant="subtle">Cancelar</Button>
          <Button variant="primary" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar tipo"}</Button>
        </>}
      />
    </form>
  );
}
