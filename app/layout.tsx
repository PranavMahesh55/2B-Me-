import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "2Bᵐᵉ — Behavioral Dashboard",
  description: "See the habits, rhythms, and signals shaping your momentum.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
