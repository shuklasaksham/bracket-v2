import { useEffect, useState } from "react";
import { v2 } from "./api2";

/* Account-level state shared across the app: billing (plan, trial, payment
   status) and connectivity. Module-level caches + subscribers so every banner,
   settings page and paywall reads the same value. */

let _billing = null;
const _bSubs = new Set();
export async function loadBilling(force = false) {
  if (_billing && !force) return _billing;
  try {
    _billing = await v2.billing();
  } catch {
    _billing = _billing || null;
  }
  _bSubs.forEach((fn) => fn(_billing));
  return _billing;
}
export function setBilling(b) {
  _billing = b;
  _bSubs.forEach((fn) => fn(_billing));
}
export function useBilling() {
  const [b, setB] = useState(_billing);
  useEffect(() => {
    _bSubs.add(setB);
    loadBilling().then(setB);
    return () => _bSubs.delete(setB);
  }, []);
  return { billing: b, reload: () => loadBilling(true) };
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("bk:offline", down);
    window.addEventListener("bk:online", up);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("bk:offline", down);
      window.removeEventListener("bk:online", up);
    };
  }, []);
  return online;
}

export const money = (amount, currency = "inr") =>
  currency === "usd" ? `$${Number(amount).toFixed(amount % 1 ? 2 : 0)}` : `₹${Number(amount).toLocaleString("en-IN")}`;
