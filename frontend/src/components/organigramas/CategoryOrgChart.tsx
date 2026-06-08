import { useRef, useState, type MouseEvent, type ReactNode, type WheelEvent } from "react";
import type { Employee } from "../../types";
import type { OrgChartModel } from "../../types/organizationChart.types";
import { EmployeeOrgNode } from "./EmployeeOrgNode";
import { EmployeeOrgPopover } from "./EmployeeOrgPopover";
import { OrgChartLegend } from "./OrgChartLegend";

export function CategoryOrgChart({ model, onExport, filterControls }: { model: OrgChartModel; onExport: () => void; filterControls?: ReactNode }) {
  const [zoom, setZoom] = useState(0.9);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const wheelRef = useRef<{ x: number; y: number; frame: number | null }>({ x: 0, y: 0, frame: null });
  const center = () => { const viewport = viewportRef.current; if (!viewport) return; viewport.scrollTo({ left: Math.max(0, (model.width * zoom - viewport.clientWidth) / 2), top: Math.max(0, 220 * zoom), behavior: "smooth" }); };
  const fit = () => { const viewport = viewportRef.current; const nextZoom = viewport ? Math.max(0.56, Math.min(0.9, Math.min((viewport.clientWidth - 40) / model.width, (viewport.clientHeight - 40) / model.height))) : 0.62; setZoom(nextZoom); requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" })); };
  const readable = () => { setZoom(0.92); requestAnimationFrame(center); };
  const startPan = (event: MouseEvent<HTMLDivElement>) => { const viewport = viewportRef.current; if (!viewport || event.button !== 0) return; dragRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.classList.add("panning"); };
  const pan = (event: MouseEvent<HTMLDivElement>) => { const drag = dragRef.current, viewport = viewportRef.current; if (!drag || !viewport) return; viewport.scrollLeft = drag.left - (event.clientX - drag.x); viewport.scrollTop = drag.top - (event.clientY - drag.y); };
  const stopPan = () => { dragRef.current = null; viewportRef.current?.classList.remove("panning"); };
  const wheelDelta = (value: number, mode: number) => value * (mode === 1 ? 16 : mode === 2 ? 120 : 1);
  const limitDelta = (value: number) => Math.sign(value) * Math.min(Math.abs(value), 34);
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    wheelRef.current.x += limitDelta(wheelDelta(event.deltaX, event.deltaMode)) * 0.72;
    wheelRef.current.y += limitDelta(wheelDelta(event.deltaY, event.deltaMode)) * 0.72;
    if (wheelRef.current.frame) return;
    wheelRef.current.frame = requestAnimationFrame(() => {
      const current = wheelRef.current;
      viewport.scrollLeft += current.x;
      viewport.scrollTop += current.y;
      current.x = 0;
      current.y = 0;
      current.frame = null;
    });
  };
  return <section className={`org-module-card ${fullscreen ? "fullscreen" : ""} ${zoom < 0.58 ? "compact-map" : ""}`}>
    <div className="org-toolbar"><b>{model.nodes.length} empleados activos visibles</b><button className="button subtle" onClick={() => setZoom((value) => Math.max(0.38, value - 0.1))}>Zoom -</button><button className="button subtle" onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))}>Zoom +</button><button className="button subtle" onClick={fit}>Ver completo</button><button className="button subtle" onClick={readable}>Vista legible</button><button className="button subtle" onClick={center}>Centrar</button><button className="button subtle" onClick={() => setFullscreen(!fullscreen)}>{fullscreen ? "Salir pantalla completa" : "Pantalla completa"}</button><button className="button subtle" onClick={onExport}>Exportar imagen</button><button className="button subtle" onClick={onExport}>Exportar PDF</button></div>
    {fullscreen && <div className="org-floating-toolbar"><button className="button subtle" onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}</button><button className="button subtle" onClick={fit}>Ver completo</button><button className="button subtle" onClick={readable}>Vista legible</button><button className="button primary" onClick={() => setFullscreen(false)}>Salir</button></div>}
    {fullscreen && filtersOpen && filterControls && <div className="org-fullscreen-filters">{filterControls}</div>}
    <OrgChartLegend categories={model.categories} />
    {model.nodes.length ? <div ref={viewportRef} className="org-viewport" onWheel={handleWheel} onMouseDown={startPan} onMouseMove={pan} onMouseUp={stopPan} onMouseLeave={stopPan}><div className="org-category-canvas" style={{ width: model.width * zoom, height: model.height * zoom }}><div className="org-canvas-scale" style={{ width: model.width, height: model.height, transform: `scale(${zoom})` }}>
      {model.categories.map((category, index) => <div className="org-category-band" key={category.id} style={{ left: index * 210, background: category.backgroundColor }}><span>{category.label}</span></div>)}
      <svg className="org-edges" width={model.width} height={model.height}>{model.edges.map((edge) => <path key={edge.id} d={edge.path} />)}</svg>
      {model.nodes.map((node) => <div className="org-positioned-node" key={node.id} style={{ left: node.x, top: node.y }} onMouseDown={(event) => event.stopPropagation()}><EmployeeOrgNode employee={node.employee} category={node.category} orphan={node.orphan} onClick={() => setSelected(node.employee)} /></div>)}
    </div></div></div> : <div className="empty"><span>No hay empleados para los filtros seleccionados.</span></div>}
    {selected && <EmployeeOrgPopover employee={selected} onClose={() => setSelected(null)} />}
  </section>;
}
