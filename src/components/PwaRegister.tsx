"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silent fail: PWA is optional in dev and unsupported browsers.
    });
  }, []);

  return null;
}
