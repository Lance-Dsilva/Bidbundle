"use client";

import { useEffect } from "react";

/**
 * The homepage's only client-side behaviour: the mobile menu.
 *
 * The animated counters, the `[data-scroll-to]` buttons, and the scroll-spy for
 * `.ld-mobile-bottom-nav` are gone — the first two belonged to the proof band
 * and dashboard mockup this page no longer has, and the third targeted a nav
 * that never existed on this page at all.
 *
 * Nothing here reveals content. The reveal classes resolve to their visible
 * state in CSS, so the page is complete before this component runs and complete
 * if it never runs.
 */
export function LandingInteractions() {
  useEffect(() => {
    const menuButton = document.querySelector<HTMLButtonElement>("[data-menu-button]");
    const menu = document.querySelector<HTMLElement>("[data-mobile-menu]");
    if (!menuButton || !menu) return;

    const setOpen = (open: boolean) => {
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.hidden = !open;
    };

    const onToggle = () => setOpen(menuButton.getAttribute("aria-expanded") !== "true");

    /** Escape closes the menu and returns focus to the control that opened it. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || menu.hidden) return;
      setOpen(false);
      menuButton.focus();
    };

    // Following a link should not leave the menu covering the destination.
    const onMenuClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("a")) setOpen(false);
    };

    menuButton.addEventListener("click", onToggle);
    menu.addEventListener("click", onMenuClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      menuButton.removeEventListener("click", onToggle);
      menu.removeEventListener("click", onMenuClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
