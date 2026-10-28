import { assetPath } from "@/lib/paths";
import "./globals.css";
import SiteFooter from "@/components/SiteFooter";
import { siteUrl } from "@/lib/site";
import Navbar from "@/components/Navbar";
import PwaRegister from "@/components/PwaRegister";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "MusMatch", template: "%s · MusMatch" },
  robots: { index: false, follow: false },
  openGraph: { title: "MusMatch", description: "Organiza partidas de mus en persona. Reúne a cuatro y acuerda las reglas.", siteName: "MusMatch", locale: "es_ES", type: "website" },
  description: "Encuentra pareja y rivales para jugar al mus 2vs2.",
  manifest: assetPath("/manifest.webmanifest"),
  appleWebApp: { capable: true, title: "MusMatch", statusBarStyle: "default" },
  icons: { apple: assetPath("/icons/apple-touch-icon.png") },
};

export const viewport: Viewport = {
  themeColor: "#083B2A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-mm-bg">
        <a href="#contenido" className="mm-skip-link">Saltar al contenido</a>
        <PwaRegister />
        <Navbar />
        <div id="contenido" tabIndex={-1} className="mm-shell">{children}<SiteFooter /></div>
      </body>
    </html>
  );
}
