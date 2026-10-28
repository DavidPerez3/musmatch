import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  // Deliberately omit account routes, parameterized matches and provisional legal texts.
  return ["", "help/"].map(path=>({url:new URL(path,siteUrl).href}));
}
