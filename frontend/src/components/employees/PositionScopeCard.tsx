import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import type { OrgStructureCatalog } from "../../types/orgStructure.types";
import type { Position } from "../../types/position.types";
import { orgNodeTypeLabels } from "../org-structure/orgStructureTree";
import { orgScopePathNames } from "../org-structure/orgScopePath";

/**
 * A6 (ORG_LOCATION_REORGANIZATION.md §3.3, bloque A): el alcance
 * organizacional del legajo se LEE del puesto. Sólo consulta: no se copia ni
 * se edita en el legajo, y no se deriva ni exige un sector único.
 */
export function PositionScopeCard({ position, hasPositionId }: { position?: Position; hasPositionId: boolean }) {
  const [catalog, setCatalog] = useState<OrgStructureCatalog | null>(null);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService.getCatalog()
      .then((data) => { if (mounted) setCatalog(data); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!hasPositionId) {
    return (
      <div className="position-scope-summary neutral">
        <small>Alcance organizacional del puesto</small>
        <p>Sin puesto asignado. El alcance organizacional se obtiene del puesto: asigná uno con alcance cargado.</p>
      </div>
    );
  }
  if (!position) {
    return (
      <div className="position-scope-summary neutral">
        <small>Alcance organizacional del puesto</small>
        <p>Cargando alcance del puesto...</p>
      </div>
    );
  }

  const scopes = position.orgScopes || [];
  return (
    <div className={`position-scope-summary ${scopes.length ? "ready" : "pending"}`}>
      <div className="position-scope-summary-head">
        <small>Alcance organizacional del puesto</small>
        <Link to={`/puestos/${position.id}`}>Ver puesto</Link>
      </div>
      {scopes.length ? (
        <ul className="org-scope-path-list">
          {scopes.map((scope) => {
            const path = catalog ? orgScopePathNames(catalog, scope) : [];
            return (
              <li key={`${scope.level}:${scope.nodeId}`}>
                <span className="org-scope-level">{orgNodeTypeLabels[scope.level]}</span>
                <span className="org-scope-path" title={(path.length ? path : [scope.name]).join(" › ")}>
                  {(path.length ? path : [scope.name]).map((name, index, all) => (
                    <span key={`${name}-${index}`} className={index === all.length - 1 ? "current" : undefined}>{name}</span>
                  ))}
                </span>
                {scope.status && scope.status !== "ACTIVO" ? <span className="org-scope-inactive">Inactivo</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>
          <b>Pendiente de recarga.</b> “{position.name}” todavía no tiene alcance organizacional
          {position.derivedSectorName ? ` y conserva su sector anterior (${position.derivedSectorName})` : ""}. No se convierte
          automáticamente: el alcance se carga en Puestos.
        </p>
      )}
      <p className="muted">
        Cada alcance incluye todos sus niveles inferiores. Se define en el puesto, lo comparten todos los legajos con ese puesto y no se
        edita desde el legajo.
      </p>
    </div>
  );
}
