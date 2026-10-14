"use client";
import { assetPath } from "@/lib/paths";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register(assetPath("/sw.js"), { scope: assetPath("/"), updateViaCache: "none" }).catch(() => {
      // Silent fail: PWA is optional in dev and unsupported browsers.
    });
  }, []);

  return null;
}
