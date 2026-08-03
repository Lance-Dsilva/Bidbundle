"use client";

import { useEffect } from "react";

export function LandingInteractions() {
  useEffect(() => {
    /* ── Mobile menu ── */
    const menuButton = document.querySelector<HTMLButtonElement>("[data-menu-button]");
    const menu = document.querySelector<HTMLElement>("[data-mobile-menu]");
    const onMenuClick = () => {
      const isOpen = menuButton?.getAttribute("aria-expanded") === "true";
      menuButton?.setAttribute("aria-expanded", String(!isOpen));
      if (menu) menu.hidden = isOpen;
    };
    menuButton?.addEventListener("click", onMenuClick);

    /* ── Scroll-to buttons ── */
    const scrollButtons = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-to]"));
    const onScrollButtonClick = (event: MouseEvent) => {
      const button = event.currentTarget as HTMLElement;
      const selector = button.dataset.scrollTo;
      if (!selector) return;
      document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    scrollButtons.forEach((button) => button.addEventListener("click", onScrollButtonClick));

    /* ── Close mobile menu on link click ── */
    const menuLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>(".ld-mobile-menu a"));
    const onMenuLinkClick = () => {
      if (menu) menu.hidden = true;
      menuButton?.setAttribute("aria-expanded", "false");
    };
    menuLinks.forEach((link) => link.addEventListener("click", onMenuLinkClick));

    /* ── Scroll reveal ── */
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("ld-is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14 }
    );
    const revealEls = Array.from(document.querySelectorAll<HTMLElement>(".ld-reveal-up, .ld-reveal-scale"));
    revealEls.forEach((el) => revealObserver.observe(el));

    /* ── Animated counters ── */
    const formatValue = (element: HTMLElement, value: number) => {
      if (element.classList.contains("currency")) return `$${Math.round(value).toLocaleString()}`;
      if (element.classList.contains("ld-savings-percent")) return `${Math.round(value)}%`;
      const target = Number(element.dataset.count || 0);
      return target === 98 ? `${Math.round(value)}%` : Math.round(value).toLocaleString();
    };
    const animateCount = (element: HTMLElement) => {
      const target = Number(element.dataset.count || 0);
      const duration = 1100;
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = formatValue(element, target * eased);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const countObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCount(entry.target as HTMLElement);
            countObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.55 }
    );
    const countEls = Array.from(document.querySelectorAll<HTMLElement>("[data-count]"));
    countEls.forEach((el) => countObserver.observe(el));

    /* ── Scroll-spy for mobile bottom nav ── */
    const sections = Array.from(document.querySelectorAll<HTMLElement>("main section[id], main[id]"));
    const mobileLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>(".ld-mobile-bottom-nav a"));
    const updateMobileNav = () => {
      const y = window.scrollY + 180;
      let current = "#home";
      sections.forEach((section) => {
        if (section.offsetTop <= y) current = `#${section.id}`;
      });
      mobileLinks.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === current));
    };
    window.addEventListener("scroll", updateMobileNav, { passive: true });
    updateMobileNav();

    return () => {
      menuButton?.removeEventListener("click", onMenuClick);
      scrollButtons.forEach((button) => button.removeEventListener("click", onScrollButtonClick));
      menuLinks.forEach((link) => link.removeEventListener("click", onMenuLinkClick));
      revealObserver.disconnect();
      countObserver.disconnect();
      window.removeEventListener("scroll", updateMobileNav);
    };
  }, []);

  return null;
}
