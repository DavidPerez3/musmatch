import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { assetPath } from "@/lib/paths";
export const dynamic = "force-static";
export default function robots(): MetadataRoute.Robots {
  // On project Pages this is served under /musmatch/, not at the host root.
  // Never block private HTML here: crawlers must read its noindex directive.
  return {rules:{userAgent:"*",allow:assetPath("/")},sitemap:new URL("sitemap.xml",siteUrl).href};
}
