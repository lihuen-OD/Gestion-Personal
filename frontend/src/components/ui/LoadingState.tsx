type LoadingStateVariant = "block" | "table" | "inline";

export function LoadingState({ variant = "block", rows = 5, columns = 6, text = "Cargando..." }: { variant?: LoadingStateVariant; rows?: number; columns?: number; text?: string }) {
  if (variant === "inline") return <span className="loading-inline"><span className="skeleton-bar" style={{ width: 16, height: 16, borderRadius: 999 }} />{text}</span>;

  if (variant === "table") {
    return (
      <div className="loading-table">
        {Array.from({ length: rows }).map((_, row) => (
          <div className="loading-table-row" key={row}>
            {Array.from({ length: columns }).map((_, col) => (
              <span className="skeleton-bar" key={col} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return <div className="empty"><span className="skeleton-bar" style={{ width: 120, height: 12 }} /><span>{text}</span></div>;
}
