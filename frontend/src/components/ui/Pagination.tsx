import { Button } from "./Button";

export function Pagination({ page, pageSize, total, hasMore, onPageChange, itemLabel = "resultados" }: { page: number; pageSize: number; total: number; hasMore?: boolean; onPageChange: (page: number) => void; itemLabel?: string }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const disableNext = hasMore === undefined ? page >= totalPages : !hasMore;

  return (
    <div className="form-actions inline-actions">
      <Button variant="subtle" type="button" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>Anterior</Button>
      <span className="muted small">Página {page} de {totalPages} · {total} {itemLabel}</span>
      <Button variant="subtle" type="button" disabled={disableNext} onClick={() => onPageChange(page + 1)}>Siguiente</Button>
    </div>
  );
}
