import { assetPath } from "@/lib/paths";
export const dynamic = "force-static";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MusMatch",
    short_name: "MusMatch",
    description: "Encuentra pareja y rivales para jugar al mus 2vs2.",
    id: assetPath("/"),
    scope: assetPath("/"),
    start_url: assetPath("/"),
    display: "standalone",
    background_color: "#083B2A",
    theme_color: "#083B2A",
    lang: "es",
    icons: [
      {
        src: assetPath("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: assetPath("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
