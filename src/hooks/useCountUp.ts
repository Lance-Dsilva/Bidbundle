"use client";

import { useEffect, useRef, useState } from "react";

/** Animates a number from 0 to `target` once on mount / when target first becomes non-zero. */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const animated = useRef(false);

  useEffect(() => {
    if (animated.current || target === 0) {
      setValue(target);
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      animated.current = true;
      return;
    }
    animated.current = true;
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
