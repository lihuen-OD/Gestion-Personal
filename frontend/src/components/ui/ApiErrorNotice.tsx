import { useEffect, useState } from "react";
import { API_ERROR_EVENT } from "../../services/api/apiClient";

type ApiErrorEvent = CustomEvent<{ message: string }>;

export function ApiErrorNotice() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const showError = (event: Event) => {
      const detail = (event as ApiErrorEvent).detail;
      if (!detail?.message) return;
      setMessage(detail.message);
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => setMessage(""), 6000);
    };
    window.addEventListener(API_ERROR_EVENT, showError);
    return () => {
      window.removeEventListener(API_ERROR_EVENT, showError);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return message ? (
    <div className="toast api-error-toast" role="alert" aria-live="assertive">
      {message}
    </div>
  ) : null;
}
