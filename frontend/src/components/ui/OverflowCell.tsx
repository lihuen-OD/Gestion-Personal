import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type OverflowCellProps = {
  value?: string | null;
  className?: string;
  lines?: 1 | 2 | 3;
  emptyLabel?: string;
};

type PopoverPosition = {
  left: number;
  top: number;
  maxWidth: number;
};

const VIEWPORT_PADDING = 16;
const POPOVER_GAP = 10;
const DEFAULT_MAX_WIDTH = 420;

export function OverflowCell({
  value,
  className = "",
  lines = 2,
  emptyLabel = "-",
}: OverflowCellProps) {
  const text = useMemo(() => (value || "").trim(), [value]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const closeSoon = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  const keepOpen = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  };

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const maxWidth = Math.min(DEFAULT_MAX_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      window.innerWidth - maxWidth - VIEWPORT_PADDING,
    );
    const fitsBelow = window.innerHeight - rect.bottom > 180;
    const top = fitsBelow ? rect.bottom + POPOVER_GAP : Math.max(VIEWPORT_PADDING, rect.top - 120);
    setPosition({ left, top, maxWidth });
  };

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    const onPointerDown = (event: MouseEvent) => {
      if (!triggerRef.current) return;
      if (!triggerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, text]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  if (!text) return <span className="overflow-cell-empty">{emptyLabel}</span>;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`overflow-cell-trigger lines-${lines} ${className}`.trim()}
        onMouseEnter={() => {
          keepOpen();
          setOpen(true);
        }}
        onMouseLeave={closeSoon}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        aria-label={text}
        title={text}
      >
        <span>{text}</span>
      </button>
      {open && position
        ? createPortal(
            <div
              className="overflow-cell-popover"
              style={{ left: `${position.left}px`, top: `${position.top}px`, maxWidth: `${position.maxWidth}px` }}
              onMouseEnter={keepOpen}
              onMouseLeave={closeSoon}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
