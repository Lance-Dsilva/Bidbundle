"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function MobileSheet({ open, onClose, title, children }: MobileSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-label={title ?? "Menu"}>
        <div className="sheet-handle" aria-hidden />
        {title ? (
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 17,
              fontWeight: 600,
              color: "var(--ink-900)",
              padding: "0 4px 10px",
            }}
          >
            {title}
          </div>
        ) : null}
        {children}
      </div>
    </>
  );
}
