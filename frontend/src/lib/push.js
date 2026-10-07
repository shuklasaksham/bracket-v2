import { api } from "./api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Register the service worker and subscribe this device to Web Push.
 * Safe to call on every authenticated page load — it no-ops when
 * unsupported, denied, or already subscribed.
 */
export async function enablePushNotifications() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    const reg = await navigator.serviceWorker.register("/sw.js");

    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { data } = await api.get("/push/vapid-public-key");
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.public_key),
      });
    }
    await api.post("/push/subscribe", { subscription: sub.toJSON() });
  } catch {
    /* push is best-effort — never surface errors */
  }
}
