import { useEffect, useState } from "react";
import { salaryCategoryApiService } from "../../services/api/salaryCategoryApiService";
import { salaryRangeMockService, type SalaryGroup } from "../../services/salaryRangeMockService";
import type { Position } from "../../types/position.types";

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Edita la relacion real PositionSalaryCategory (fuente oficial desde el
 * saneamiento de Puestos, 2026-08-18). La UI sigue trabajando con nombres
 * (agrupados por familia, con relleno de rango entre dos puntas) porque
 * SalaryCategory.name es unico en la base real; la conversion nombre<->id
 * pasa por el catalogo real cargado abajo, nunca por salaryRangeCategories.
 */
export function PuestoSalaryRangeTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const [groups, setGroups] = useState<SalaryGroup[]>([]);
  const [catalog, setCatalog] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let mounted = true;
    salaryCategoryApiService.getAll()
      .then((items) => {
        if (!mounted) return;
        setCatalog(items.map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => {});
    salaryCategoryApiService.getGroups()
      .then((apiGroups) => {
        if (mounted && apiGroups.length) {
          salaryRangeMockService.setApiGroups(apiGroups);
          setGroups(apiGroups);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const idByName = new Map(catalog.map((item) => [item.name, item.id] as const));
  const nameById = new Map(catalog.map((item) => [item.id, item.name] as const));
  const selectedIds = position.salaryCategoryIds || [];
  const selected = uniqueSorted(selectedIds.map((id) => nameById.get(id)).filter((name): name is string => Boolean(name)));

  const setSelected = (names: string[]) => {
    const salaryCategoryIds = uniqueSorted(names).map((name) => idByName.get(name)).filter((id): id is string => Boolean(id));
    setPosition({ ...position, salaryCategoryIds });
  };
  const clear = () => setSelected([]);
  const selectGroup = (group: SalaryGroup) => setSelected(uniqueSorted([...selected, ...group.categories]));
  const clearGroup = (group: SalaryGroup) => setSelected(selected.filter((category) => !group.categories.includes(category)));
  const toggleCategory = (group: SalaryGroup, category: string) => setSelected(salaryRangeMockService.rangeBetween(group.categories, selected, category));

  return <div className="position-tab-pad salary-range-tab">
    <div className="salary-range-head">
      <div><h3>Rango salarial</h3><p>Selecciona una familia para traer todos sus niveles, o marca dos puntas para completar automaticamente el rango intermedio. Despues podes desmarcar cualquier categoria puntual.</p></div>
      {!disabled && <div className="table-actions"><button type="button" className="button subtle" onClick={clear}>Limpiar todo</button></div>}
    </div>
    <div className="salary-range-layout">
      {groups.map((group) => {
        const selectedInGroup = group.categories.filter((category) => selected.includes(category));
        return <section className={`salary-family-card ${selectedInGroup.length ? "active" : ""}`} key={group.id}>
          <div className="salary-family-head">
            <div><small>{selectedInGroup.length}/{group.categories.length}</small><h4>{group.label}</h4><p>{group.description}</p></div>
            {!disabled && <div className="salary-family-actions"><button type="button" onClick={() => selectGroup(group)}>Todo</button><button type="button" onClick={() => clearGroup(group)}>Quitar</button></div>}
          </div>
          <div className="salary-range-line">
            {group.categories.map((category, index) => {
              const checked = selected.includes(category);
              return <button type="button" disabled={disabled} className={checked ? "selected" : ""} key={category} onClick={() => toggleCategory(group, category)}>
                <span>{index + 1}</span><b>{category}</b>
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
    <div className="salary-selected-summary">
      <b>{selected.length ? `${selected.length} categorias seleccionadas` : "Sin categorias seleccionadas"}</b>
      <span>{selected.length ? selected.join(", ") : "Elegí una familia completa o arma un rango por categorias."}</span>
    </div>
  </div>;
}
