import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { ScrollReveal } from "@/components/layout/ScrollReveal";
import { PwaProvider } from "@/components/pwa/PwaProvider";
import { ToastProvider } from "@/components/ui/Toast";

import "./globals.css";
import "leaflet/dist/leaflet.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Bundleen",
  description: "Your neighbourhood. Your power. Your price.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Bundleen",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F8FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1926" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={inter.variable}
    >
      <body>
        <ClerkProvider>
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem("bundleen.theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}`,
            }}
          />
          <ScrollReveal />
          <PwaProvider />
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
