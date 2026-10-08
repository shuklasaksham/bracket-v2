import React, { useEffect, useState } from "react";
import * as RDialog from "@radix-ui/react-dialog";
import { api } from "../../lib/api";
import { Button, GoogleG } from "../ui/primitives";

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
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  return (
    <RDialog.Root open={open} onOpenChange={() => {}}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
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
      </RDialog.Portal>
    </RDialog.Root>
  );
}
