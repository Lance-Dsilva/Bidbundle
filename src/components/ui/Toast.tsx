"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const toneStyles: Record<ToastTone, { bg: string; color: string; icon: string }> = {
  success: { bg: "var(--sage-700)", color: "#FFF", icon: "✓" },
  error: { bg: "var(--danger-600)", color: "#FFF", icon: "✕" },
  info: { bg: "var(--bg-sidebar)", color: "#FAF6F0", icon: "·" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="toast-stack pointer-events-none fixed left-0 right-0 z-[80] flex flex-col items-center gap-2"
        style={{ bottom: "calc(88px + var(--safe-bottom))" }}
      >
        <style>{`
          @keyframes toast-in { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
          @media (min-width: 768px) { .toast-stack { bottom: 28px !important; } }
        `}</style>
        {toasts.map((toast) => {
          const tone = toneStyles[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                maxWidth: "calc(100vw - 48px)",
                padding: "10px 18px",
                borderRadius: 999,
                background: tone.bg,
                color: tone.color,
                fontSize: 14,
                fontWeight: 600,
                boxShadow: "0 12px 32px rgba(31,26,20,0.28)",
                animation: "toast-in 0.3s cubic-bezier(0.16,1,0.3,1) both",
              }}
            >
              <span aria-hidden style={{ fontSize: 13 }}>{tone.icon}</span>
              {toast.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
