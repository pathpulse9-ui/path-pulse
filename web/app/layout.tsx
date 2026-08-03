import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SessionProvider } from "./lib/session";

export const metadata: Metadata = {
  title: "PathPulse",
  description: "Stellar wallet integration and transaction management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <SessionProvider>
          <nav className="border-b border-gray-200 px-8 py-3 flex items-center gap-6 text-sm">
            <Link href="/" className="font-semibold">PathPulse</Link>
            <Link href="/" className="text-gray-600 hover:text-black">Wallet</Link>
            <Link href="/settlement" className="text-gray-600 hover:text-black">Settlement Explorer</Link>
            <Link href="/offramp" className="text-gray-600 hover:text-black">Off-ramp</Link>
          </nav>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
