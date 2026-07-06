export function Pagination({ page, pageSize, total, hasMore, onPageChange, itemLabel = "resultados" }: { page: number; pageSize: number; total: number; hasMore?: boolean; onPageChange: (page: number) => void; itemLabel?: string }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const disableNext = hasMore === undefined ? page >= totalPages : !hasMore;

  return (
    <div className="form-actions inline-actions">
      <button className="button subtle" type="button" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>Anterior</button>
      <span className="muted small">Página {page} de {totalPages} · {total} {itemLabel}</span>
      <button className="button subtle" type="button" disabled={disableNext} onClick={() => onPageChange(page + 1)}>Siguiente</button>
    </div>
  );
}
