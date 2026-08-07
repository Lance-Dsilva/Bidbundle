"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 32);
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/6 bg-[#07111e]/95 backdrop-blur-lg"
          : "bg-transparent"
      }`}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 lg:px-10"
      >
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg transition-transform duration-200 group-hover:scale-105">
            <span className="font-display text-sm font-bold italic text-white">B</span>
          </div>
          <span className="font-display text-[17px] font-semibold italic text-white">
            Bundleen
          </span>
        </Link>

        {/* Center nav links */}
        <div className="hidden items-center gap-8 lg:flex">
          {[
            { href: "#how-it-works", label: "How it works" },
            { href: "#for-providers", label: "For Providers" },
            { href: "#savings", label: "Group Savings" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13px] font-medium text-white/55 transition-colors duration-150 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Right CTAs */}
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden h-9 items-center px-4 text-[13px] font-medium text-white/60 transition-colors hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link href="/get-started">
            <Button
              as="span"
              variant="amber"
              className="h-9 px-5 text-[13px] shadow-lg shadow-amber-900/20"
            >
              Get started free
            </Button>
          </Link>
        </div>
      </nav>
    </header>
  );
}
