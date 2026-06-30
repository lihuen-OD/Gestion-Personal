import { useEffect, useState } from "react";
import { salaryCategoryApiService } from "../../services/api/salaryCategoryApiService";
import { salaryRangeMockService, type SalaryGroup } from "../../services/salaryRangeMockService";
import type { Position } from "../../types/position.types";

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
}

export function PuestoSalaryRangeTab({ position, setPosition, disabled = false }: { position: Position; setPosition: (position: Position) => void; disabled?: boolean }) {
  const selected = position.salaryRangeCategories || [];
  const [groups, setGroups] = useState<SalaryGroup[]>([]);
  useEffect(() => {
    let mounted = true;
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
  const setSelected = (salaryRangeCategories: string[]) => setPosition({ ...position, salaryRangeCategories });
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
