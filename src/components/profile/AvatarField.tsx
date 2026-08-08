"use client";

import { useRef, useState, type CSSProperties } from "react";

import { ALLOWED_AVATAR_TYPES } from "@/lib/validation/profile";

/**
 * Profile photo with upload, progress, and removal.
 *
 * Shared by both account screens so the accepted types, the progress ring, and
 * the "no photo yet" fallback stay identical for homeowners and providers.
 */

type AvatarFieldProps = {
  /** `null` renders initials rather than a stock face. */
  url: string | null;
  /** Falls back to a neutral glyph when the name is empty. */
  name: string;
  size?: number;
  /** `0`–`100` while uploading, otherwise `null`. */
  progress: number | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
};

function initialsOf(name: string): string {
  const letters = name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return letters.toUpperCase() || "·";
}

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  padding: "0 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  border: "1px solid var(--border-warm-strong)",
  color: "var(--ink-700)",
  fontFamily: "var(--font-body)",
};

export function AvatarField({
  url,
  name,
  size = 76,
  progress,
  onSelect,
  onRemove,
  disabled = false,
}: AvatarFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const uploading = progress !== null;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            overflow: "hidden",
            background: "linear-gradient(135deg, var(--orange-500), var(--orange-600))",
            display: "grid",
            placeItems: "center",
            color: "white",
            fontSize: Math.round(size / 3),
            fontWeight: 600,
            border: "4px solid var(--bg-card)",
            boxShadow: "var(--shadow-warm-md)",
          }}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- Blob host is
            // not in the next/image remote allow-list; the file is already
            // size-capped at upload.
            <img
              src={url}
              alt=""
              width={size}
              height={size}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            initialsOf(name)
          )}
        </div>

        {uploading ? (
          <div
            aria-live="polite"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "rgba(20,16,12,0.55)",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {progress}%
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4 }}>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_AVATAR_TYPES.join(",")}
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so re-picking the same file fires `change` again.
            event.target.value = "";
            if (file) onSelect(file);
          }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            style={buttonStyle}
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : url ? "Change photo" : "Add photo"}
          </button>
          {url && !uploading ? (
            confirmingRemove ? (
              <>
                <button
                  type="button"
                  style={{ ...buttonStyle, color: "var(--danger-600)", borderColor: "rgba(182,68,48,0.3)" }}
                  onClick={() => {
                    setConfirmingRemove(false);
                    onRemove();
                  }}
                >
                  Confirm remove
                </button>
                <button type="button" style={buttonStyle} onClick={() => setConfirmingRemove(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" style={buttonStyle} onClick={() => setConfirmingRemove(true)}>
                Remove
              </button>
            )
          ) : null}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-400)" }}>JPEG, PNG, or WebP · up to 4MB</span>
      </div>
    </div>
  );
}
