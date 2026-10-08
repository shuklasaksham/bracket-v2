import React, { useEffect, useState } from "react";
import * as RDialog from "@radix-ui/react-dialog";
import { api } from "../../lib/api";
import { Button, GoogleG } from "../ui/primitives";
import { useIsMobile } from "../lib/useMedia";

/* Session expired — re-auth without losing context (Figma › Overview · Session
   expired). Any 401 from the API opens this over the dimmed app; selections and
   drafts stay in memory because the page is never unmounted. */
let installed = false;
function installInterceptor() {
  if (installed) return;
  installed = true;
  api.interceptors.response.use(
    (r) => r,
    (error) => {
      const s = error?.response?.status;
      const url = error?.config?.url || "";
      if (s === 401 && !url.startsWith("/auth/")) window.dispatchEvent(new CustomEvent("bk:session-expired"));
      return Promise.reject(error);
    },
  );
}

export default function SessionExpired() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    installInterceptor();
    const on = () => setOpen(true);
    window.addEventListener("bk:session-expired", on);
    return () => window.removeEventListener("bk:session-expired", on);
  }, []);
  const mobile = useIsMobile();
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  return (
    <RDialog.Root open={open} onOpenChange={() => {}}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
        {mobile ? (
          /* Figma › Overview · Session expired — Mobile 390 (153:824): bottom sheet */
          <RDialog.Content className="bk fixed inset-x-0 bottom-0 z-50 rounded-t-xl border-t border-line-strong bg-raised px-4 pb-8 pt-2 shadow-overlay data-[state=open]:animate-slide-up focus:outline-none">
            <div className="mx-auto mb-5 h-1 w-9 rounded-full bg-white/20" aria-hidden="true" />
            <RDialog.Title className="text-title-m text-fg">Session expired</RDialog.Title>
            <RDialog.Description className="mt-3 text-body-s text-fg-secondary">Sign in again to continue — nothing was lost.</RDialog.Description>
            <Button variant="primary" className="mt-5 h-11 w-full" onClick={() => { window.location.href = `/login?next=${next}`; }}>Sign in</Button>
          </RDialog.Content>
        ) : (
        <RDialog.Content className="bk fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-strong bg-raised p-5 shadow-overlay data-[state=open]:animate-scale-in focus:outline-none">
          <RDialog.Title className="text-body-l font-medium text-fg">Sign in again to continue</RDialog.Title>
          <RDialog.Description className="mt-3 text-body-m text-fg-secondary">
            For your security, sessions end after 12 hours. Your selections and drafts are saved.
          </RDialog.Description>
          <Button variant="secondary" size="l" className="mt-5 w-full" onClick={() => { window.location.href = `/login?next=${next}&google=1`; }}>
            <GoogleG />
            Continue with Google
          </Button>
          <Button variant="ghost" size="m" className="mt-2 w-full" onClick={() => { window.location.href = `/login?next=${next}`; }}>Use email instead</Button>
        </RDialog.Content>
        )}
      </RDialog.Portal>
    </RDialog.Root>
  );
}
