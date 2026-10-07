import { useEffect, useState } from "react";

// Figma breakpoints: Mobile < 768 · Tablet 768–1023 · Small laptop 1024–1279 · Laptop/Desktop ≥ 1280
export function useMedia(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, [query]);
  return match;
}

export const useIsMobile = () => useMedia("(max-width: 767px)");
export const useIsCompact = () => useMedia("(max-width: 1023px)"); // tablet + mobile
export const useIsRail = () => useMedia("(min-width: 1024px) and (max-width: 1279px)");
