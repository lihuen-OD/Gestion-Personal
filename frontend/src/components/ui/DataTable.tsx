import type { ReactNode } from "react";
import { TableShell } from "./TableShell";
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";

type DataTableStatus = "loading" | "error" | "empty" | "ready";

export function DataTable({
  status,
  minWidth,
  loadingRows = 5,
  loadingColumns = 6,
  errorMessage,
  onRetry,
  emptyText = "No hay registros para mostrar.",
  children,
}: {
  status: DataTableStatus;
  minWidth?: number | string;
  loadingRows?: number;
  loadingColumns?: number;
  errorMessage?: string;
  onRetry?: () => void;
  emptyText?: string;
  children: ReactNode;
}) {
  if (status === "loading") return <LoadingState variant="table" rows={loadingRows} columns={loadingColumns} />;
  if (status === "error") return <ErrorState message={errorMessage} onRetry={onRetry} />;
  if (status === "empty") return <EmptyState text={emptyText} />;

  return <TableShell minWidth={minWidth}>{children}</TableShell>;
}
