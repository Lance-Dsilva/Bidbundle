"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "bidbundle_install_dismissed";

export function PwaProvider() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failure is non-fatal */
      });
    }
  }, []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      if (localStorage.getItem(DISMISS_KEY)) return;
      setInstallEvent(event as BeforeInstallPromptEvent);
      setShowBanner(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (!showBanner || !installEvent) return null;

  const install = async () => {
    setShowBanner(false);
    await installEvent.prompt();
    setInstallEvent(null);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setShowBanner(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install BidBundle"
      className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-4 right-4 z-[60] flex items-center gap-3 md:bottom-6 md:left-auto md:right-6 md:w-[420px]"
      style={{
        padding: "12px 14px",
        borderRadius: 16,
        background: "var(--bg-sidebar, #16181D)",
        color: "#FAF6F0",
        boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          background: "linear-gradient(135deg, #fbbf24, #E8623F)",
          display: "grid",
          placeItems: "center",
          color: "#fffaf4",
          fontWeight: 700,
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        B
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Install BidBundle</div>
        <div style={{ fontSize: 12, color: "#B8BBC1" }}>Add to your home screen for the full app experience</div>
      </div>
      <button
        onClick={install}
        style={{
          border: "none",
          borderRadius: 999,
          height: 36,
          padding: "0 16px",
          background: "var(--terracotta-600, #E8623F)",
          color: "white",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Install
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        style={{
          border: "none",
          background: "transparent",
          color: "#8A8E96",
          fontSize: 18,
          cursor: "pointer",
          padding: 4,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
