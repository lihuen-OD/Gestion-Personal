export const APP_DIALOG_EVENT = "app:dialog";

export type AppDialogRequest = {
  kind: "confirm" | "prompt";
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: "primary" | "danger";
  inputLabel?: string;
  defaultValue?: string;
  resolve: (value: boolean | string | null) => void;
};

type DialogOptions = Partial<Pick<AppDialogRequest, "title" | "confirmLabel" | "cancelLabel" | "tone">>;

function dispatchDialog(request: AppDialogRequest) {
  if (typeof window === "undefined") {
    request.resolve(request.kind === "confirm" ? false : null);
    return;
  }
  window.dispatchEvent(new CustomEvent<AppDialogRequest>(APP_DIALOG_EVENT, { detail: request }));
}

export function confirmAction(message: string, options: DialogOptions = {}) {
  return new Promise<boolean>((resolve) => dispatchDialog({
    kind: "confirm",
    title: options.title || "Confirmar acción",
    message,
    confirmLabel: options.confirmLabel || "Confirmar",
    cancelLabel: options.cancelLabel || "Cancelar",
    tone: options.tone || "primary",
    resolve: (value) => resolve(value === true),
  }));
}

export function requestText(message: string, options: DialogOptions & { inputLabel?: string; defaultValue?: string } = {}) {
  return new Promise<string | null>((resolve) => dispatchDialog({
    kind: "prompt",
    title: options.title || "Ingresar información",
    message,
    confirmLabel: options.confirmLabel || "Continuar",
    cancelLabel: options.cancelLabel || "Cancelar",
    tone: options.tone || "primary",
    inputLabel: options.inputLabel || "Detalle",
    defaultValue: options.defaultValue || "",
    resolve: (value) => resolve(typeof value === "string" ? value : null),
  }));
}
