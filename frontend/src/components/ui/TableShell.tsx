import type { CSSProperties, ReactNode } from "react";

export function TableShell({
  children,
  className = "",
  minWidth,
}: {
  children: ReactNode;
  className?: string;
  minWidth?: number | string;
}) {
  const style = minWidth
    ? ({ "--table-min-width": typeof minWidth === "number" ? `${minWidth}px` : minWidth } as CSSProperties)
    : undefined;

  return (
    <div className={`table-shell ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
