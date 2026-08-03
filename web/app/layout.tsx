import type { Metadata } from "next";
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
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
