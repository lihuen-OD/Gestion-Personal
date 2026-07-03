import { useCallback, useRef, useState } from "react";

export function useAsyncAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void>,
) {
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);

  const run = useCallback(
    async (...args: TArgs) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      setIsRunning(true);
      try {
        await action(...args);
      } finally {
        isRunningRef.current = false;
        setIsRunning(false);
      }
    },
    [action],
  );

  return { isRunning, run };
}
