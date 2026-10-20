"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { currentPushSubscription } from "@/lib/push";
import NavIcon from "./NavIcon";
export default function NotificationBell({
  userId,
}: {
  userId: string | null;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null);
      if (active && !error) setCount(count || 0);
    };
    void load();
    void currentPushSubscription()
      .then((sub) => {
        if (sub && active)
          return supabase.rpc("get_push_subscription_status", {
            p_endpoint: sub.endpoint,
          });
      })
      .catch(() => {});
    const timer = setInterval(() => void load(), 30000);
    const refresh = () => void load();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("musmatch-notifications", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("musmatch-notifications", refresh);
    };
  }, [userId]);
  if (!userId) return null;
  return (
    <Link
      href="/notifications"
      className="mm-notification-bell"
      aria-label={`Avisos${count ? `, ${count} sin leer` : ""}`}
    >
      <NavIcon name="bell" />
      {count > 0 && (
        <span className="mm-badge">{count > 99 ? "99+" : count}</span>
      )}
    </Link>
  );
}
