import "./globals.css";
import Navbar from "@/components/Navbar";
import PwaRegister from "@/components/PwaRegister";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "MusMatch",
  description: "Encuentra pareja y rivales para jugar al mus 2vs2.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#083B2A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-mm-bg">
        <PwaRegister />
        <Navbar />
        <main className="mx-auto max-w-5xl px-4 py-6 pt-24">{children}</main>
      </body>
    </html>
  );
}
