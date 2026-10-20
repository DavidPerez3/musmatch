import { supabase } from "@/lib/supabaseClient";
import { assetPath } from "@/lib/paths";
export function supportsPush() {
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
export function needsInstalledIos() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return (
    ios &&
    !window.matchMedia("(display-mode: standalone)").matches &&
    !(navigator as Navigator & { standalone?: boolean }).standalone
  );
}
export async function currentPushSubscription() {
  if (!supportsPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration(
    assetPath("/"),
  );
  return registration?.pushManager.getSubscription() || null;
}
export async function activatePush(
  permission: Promise<NotificationPermission>,
) {
  if ((await permission) !== "granted")
    throw new Error(
      "No se ha concedido permiso. Puedes cambiarlo en los ajustes del navegador.",
    );
  const { data: key, error } = await supabase.rpc("get_push_public_key");
  if (error || !key)
    throw new Error(
      "El servicio push aún no está disponible. Inténtalo en unos minutos.",
    );
  await navigator.serviceWorker.register(assetPath("/sw.js"), {
    scope: assetPath("/"),
    updateViaCache: "none",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "No se pudo preparar la aplicación. Recarga y vuelve a intentarlo.",
            ),
          ),
        10000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const bytes = Uint8Array.from(
    atob(key.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  let subscription = await registration.pushManager.getSubscription();
  const created = !subscription;
  subscription ||= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
  const result = await supabase.rpc("register_push_subscription", {
    p_subscription: subscription.toJSON(),
    p_device_name: /Android/.test(navigator.userAgent)
      ? "Android"
      : needsInstalledIos() || /iPhone|iPad/.test(navigator.userAgent)
        ? "iPhone / iPad"
        : "Navegador",
  });
  if (result.error) {
    if (created) await subscription.unsubscribe();
    throw new Error(result.error.message);
  }
  return result.data as string;
}
export async function removeCurrentPush() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  // Remove the server binding while still authenticated; unsubscribe locally even when offline.
  try {
    const { error } = await supabase
      .rpc("remove_push_subscription", { p_endpoint: subscription.endpoint })
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw new Error(error.message);
  } finally {
    await subscription.unsubscribe();
  }
}
