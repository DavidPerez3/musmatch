import type { Metadata } from "next";
import { assetPath } from "./paths";

export const siteUrl = `https://davidperez3.github.io${assetPath("/")}`;
export function publicMetadata(title: string, description: string, route: string): Metadata {
  const url = new URL(route, siteUrl).href;
  return {
    title, description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { title: `${title} · MusMatch`, description, url, siteName: "MusMatch", locale: "es_ES", type: "website" },
    twitter: { card: "summary", title: `${title} · MusMatch`, description },
  };
}
