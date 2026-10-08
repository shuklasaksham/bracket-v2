import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { v2 } from "../lib/api2";
import { Button } from "../ui/primitives";
import { Logo } from "../shell/Logo";
import { loadBilling } from "../lib/account";
import { fetchProjects } from "../lib/workspace";

/* /__states — mock API only. Switch the mock into any edge-case state from the
   Figma file and jump to where it shows. Not linked anywhere in the product. */
const LINKS = [
  ["Overview", "/w/p1"], ["Review", "/w/p1/review/r1"], ["Memory", "/w/p1/memory/commitment"], ["People", "/w/p1/memory/person"],
  ["Conversations", "/w/p1/conversations/t1"], ["Ask", "/w/p1/ask"], ["Timeline", "/w/p1/timeline"], ["Sources", "/w/p1/sources"],
  ["Gmail source", "/w/p1/sources/s_gmail"], ["Files", "/w/p1/files"], ["Settings", "/w/p1/settings/profile"], ["Members", "/w/p1/settings/members"],
  ["Billing", "/w/p1/settings/billing"], ["404", "/w/p1/nope"], ["Sign in", "/login"], ["Sign up", "/signup"], ["Forgot password", "/forgot-password"],
  ["Accept invite", "/invite/abc"], ["Invite expired", "/invite/expired"], ["Landing", "/"], ["Pricing", "/pricing"], ["Onboarding", "/welcome"],
];

export default function MockStates() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { v2.scenario().then(setData).catch(() => setErr("The mock API isn’t running — start it with `node mock/server.js`.")); }, []);
  const pick = async (name, to) => {
    await v2.setScenario(name);
    await Promise.all([loadBilling(true), fetchProjects(true)]);
    setData((d) => ({ ...d, current: name }));
    if (to) navigate(to);
  };
  return (
    <div className="bk min-h-[100dvh] bg-app px-4 py-10">
      <div className="mx-auto max-w-[880px]">
        <Logo />
        <h1 className="mt-8 text-title-l text-fg">Mock states</h1>
        <p className="mt-1 text-body-m text-fg-tertiary">Switch the mock API into any state from the Figma file. Resets data each time.</p>
        {err && <p className="mt-6 text-body-m text-danger">{err}</p>}
        {data && (
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {Object.entries(data.scenarios).map(([k, label]) => (
              <button key={k} onClick={() => pick(k, k === "signed_out" ? "/login" : "/w/p1")}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors duration-fast ${data.current === k ? "border-line-strong bg-selected" : "border-line hover:bg-hover"}`}>
                <span><span className="block text-body-m text-fg">{label}</span><span className="block font-mono text-[12px] text-fg-tertiary">{k}</span></span>
                {data.current === k && <span className="text-body-s text-success">active</span>}
              </button>
            ))}
            <button onClick={() => { window.dispatchEvent(new Event("bk:offline")); navigate("/w/p1"); }} className="rounded-lg border border-line px-4 py-3 text-left hover:bg-hover">
              <span className="block text-body-m text-fg">Offline (browser)</span><span className="block font-mono text-[12px] text-fg-tertiary">fires an offline event</span>
            </button>
          </div>
        )}
        <h2 className="mt-10 eyebrow">Jump to</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {LINKS.map(([l, to]) => <Button key={to} size="s" onClick={() => navigate(to)}>{l}</Button>)}
        </div>
      </div>
    </div>
  );
}
