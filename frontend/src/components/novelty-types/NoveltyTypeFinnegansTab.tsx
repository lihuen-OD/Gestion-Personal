import { Plus, Trash2 } from "lucide-react";
import { noveltyTypeMockService } from "../../services/noveltyTypeMockService";
import type { FinnegansNoveltyLink, NoveltyType } from "../../types/noveltyType.types";

export function NoveltyTypeFinnegansTab({ item, setItem, disabled }: { item: NoveltyType; setItem: (item: NoveltyType) => void; disabled?: boolean }) {
  const update = (linkId: string, patch: Partial<FinnegansNoveltyLink>) => setItem({ ...item, finnegansLinks: item.finnegansLinks.map((link) => link.id === linkId ? { ...link, ...patch } : link) });
  return <div className="catalog-finnegans">
    <div className="info-note"><b>Vinculación Finnegans</b><p>Una novedad interna puede tener una o varias equivalencias externas. Esto prepara la integración futura sin depender de textos cargados a mano.</p></div>
    <div className="form-actions inline-actions">{!disabled && <button type="button" className="button primary" onClick={() => setItem(noveltyTypeMockService.addFinnegansLink(item))}><Plus size={15} /> Agregar vínculo Finnegans</button>}</div>
    {item.finnegansLinks.length ? <div className="catalog-link-list">{item.finnegansLinks.map((link) => <div className="catalog-link-row" key={link.id}>
      <label>Código Finnegans<input disabled={disabled} value={link.code} onChange={(event) => update(link.id, { code: event.target.value })} /></label>
      <label>Nombre Finnegans<input disabled={disabled} value={link.name} onChange={(event) => update(link.id, { name: event.target.value })} /></label>
      <label>Concepto liquidable<input disabled={disabled} value={link.settlementConcept} onChange={(event) => update(link.id, { settlementConcept: event.target.value })} /></label>
      <label>Prioridad<input type="number" min="1" disabled={disabled} value={link.priority} onChange={(event) => update(link.id, { priority: Number(event.target.value) || 1 })} /></label>
      <label>Estado<select disabled={disabled} value={link.status} onChange={(event) => update(link.id, { status: event.target.value as FinnegansNoveltyLink["status"] })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
      <label>Observación<input disabled={disabled} value={link.notes || ""} onChange={(event) => update(link.id, { notes: event.target.value })} /></label>
      {!disabled && <button type="button" className="icon-button danger-link" onClick={() => setItem(noveltyTypeMockService.removeFinnegansLink(item, link.id))}><Trash2 size={18} /></button>}
    </div>)}</div> : <div className="empty">Todavía no hay equivalencias Finnegans cargadas.</div>}
  </div>;
}
