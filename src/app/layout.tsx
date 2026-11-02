import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { getViewer, isDemoEnabled } from "@/lib/server/session";
import { Avatar } from "@/components/ui";
import { SignOutButton } from "@/components/SignOut";

export const metadata: Metadata = {
  title: { default: "Roomsplit — fair room & cost sharing for group stays", template: "%s · Roomsplit" },
  description: "Decide who gets which bedroom and what everyone pays — transparently, to the cent.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f2ec" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const demo = isDemoEnabled();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2">
          Skip to content
        </a>
        <header className="no-print sticky top-0 z-30 border-b border-sand-200/80 bg-sand-100/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2" aria-label="Roomsplit home">
              <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
                <rect width="28" height="28" rx="8" fill="#235e55" />
                <path d="M7 15 L14 8 L21 15 V21 H7Z" fill="#f6f2ec" />
                <rect x="13.2" y="13" width="1.6" height="8" fill="#235e55" />
              </svg>
              <span className="hidden font-display text-lg text-ink-900 min-[400px]:inline">Roomsplit</span>
            </Link>
            <nav className="flex items-center gap-0.5 whitespace-nowrap text-sm sm:gap-2">
              {viewer && (
                <Link href="/trips" className="rounded-full px-2 py-2 text-ink-700 hover:bg-sand-200/60 sm:px-3">
                  My trips
                </Link>
              )}
              {demo && (
                <Link href="/demo" className="rounded-full px-2 py-2 text-ink-700 hover:bg-sand-200/60 sm:px-3" data-testid="nav-demo">
                  Personas
                </Link>
              )}
              {viewer ? (
                <span className="ml-1 flex items-center gap-1 sm:gap-2">
                  <Avatar name={viewer.display_name} size={30} />
                  <span className="hidden max-w-[10rem] truncate text-ink-700 sm:inline" data-testid="viewer-name">
                    {viewer.display_name}
                  </span>
                  <SignOutButton />
                </span>
              ) : (
                <Link href="/create" className="rounded-full bg-pine-600 px-4 py-2 font-medium text-white hover:bg-pine-700">
                  Start a group
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
          {children}
        </main>
        <footer className="no-print border-t border-sand-200 py-8 text-center text-xs text-ink-400">
          Roomsplit · Prices are calculated deterministically in integer cents. No payments are processed.
        </footer>
      </body>
    </html>
  );
}
