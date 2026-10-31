"use client";

import { useEffect } from "react";

/** The homepage's only client behavior: its phone and tablet navigation. */
export function LandingInteractions() {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".landing-shell");
    const menuButton = shell?.querySelector<HTMLButtonElement>("[data-menu-button]");
    const menu = shell?.querySelector<HTMLElement>("[data-mobile-menu]");
    if (!menuButton || !menu) return;

    const setOpen = (open: boolean) => {
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.hidden = !open;
    };

    const onToggle = () => setOpen(menuButton.getAttribute("aria-expanded") !== "true");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || menu.hidden) return;
      setOpen(false);
      menuButton.focus();
    };
    const onMenuClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
    };

    // A menu opened on a tablet must not reappear after crossing desktop width.
    const desktop = window.matchMedia("(min-width: 981px)");
    const onDesktopChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    menuButton.addEventListener("click", onToggle);
    menu.addEventListener("click", onMenuClick);
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onDesktopChange);

    return () => {
      menuButton.removeEventListener("click", onToggle);
      menu.removeEventListener("click", onMenuClick);
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onDesktopChange);
    };
  }, []);

  return null;
}
