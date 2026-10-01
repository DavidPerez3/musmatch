import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MusMatch",
    short_name: "MusMatch",
    description: "Encuentra pareja y rivales para jugar al mus 2vs2.",
    start_url: "/",
    display: "standalone",
    background_color: "#083B2A",
    theme_color: "#083B2A",
    lang: "es",
    icons: [
      {
        src: "/brand/musmatch-logo2.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/musmatch-logo3.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
