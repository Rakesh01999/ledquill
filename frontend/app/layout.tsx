import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "@/components/providers";
import { getQueryClient, prefetch } from "@/lib/query/server";
import { statsOptions } from "@/lib/query/options";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Every page reads live data, so nothing is prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "LedQuill", template: "%s · LedQuill" },
  description: "Read, extract and verify invoices.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e1a" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The review count in the sidebar is in the first paint; the browser keeps it fresh afterwards.
  // Pages hydrate what they prefetch with their own HydrationBoundary: this one is dehydrated
  // before they run.
  await prefetch(statsOptions);
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <Providers>
          <HydrationBoundary state={dehydrate(getQueryClient())}>
            <AppShell>{children}</AppShell>
          </HydrationBoundary>
        </Providers>
      </body>
    </html>
  );
}
