import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MountainMadness",
  description: "Log mountain trips and see your routes drawn on the real mountain, in 3D.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">
        <header className="border-b border-slate-800">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3.5">
            <a href="/" className="font-semibold tracking-tight text-slate-100">
              Mountain<span className="text-orange-400">Madness</span>
            </a>
            <div className="ml-auto flex gap-5 text-sm text-slate-400">
              <a href="/" className="hover:text-slate-100">Trips</a>
              <a href="/peaks" className="hover:text-slate-100">Peaks</a>
              <a href="/trips/new" className="hover:text-slate-100">Upload</a>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-7">{children}</main>
      </body>
    </html>
  );
}
